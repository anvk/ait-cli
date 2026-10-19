// The startup half of self-update. Reads one small file, and either applies an update the
// last background check found or starts the next check and gets out of the way.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import pc from "picocolors";
import { runAllowFailure, spawnDetached } from "../core/process.js";
import {
  CHILD_ENV,
  MAIN_BRANCH,
  checkoutBlockers,
  describeVersion,
  environmentBlockers,
  resolveInstall,
  resolveInstallPaths,
  type InstallPaths
} from "./install.js";
import { updatePlugins } from "../plugins/install.js";
import { acquireLock, readState, writeState } from "./state.js";
import { errorMessage } from "../core/util.js";

const BUILD_TIMEOUT_MS = 180_000;

export interface UpdateOutcome {
  status: "updated" | "current" | "skipped" | "failed";
  to?: string;
  reason?: string;
}

// Progress goes to stderr so `lane list | grep` never sees it.
function note(message: string): void {
  process.stderr.write(`${message}\n`);
}

function git(info: InstallPaths, args: string[], timeout = 60_000) {
  return runAllowFailure("git", args, {
    cwd: info.gitRoot ?? info.packageRoot,
    timeout,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
  });
}

export function updateIsPending(info: InstallPaths): boolean {
  const { remoteSha } = readState();
  return Boolean(remoteSha && info.sha && remoteSha !== info.sha);
}

// A commit we already tried and could not build is not worth trying again until the remote
// has moved on from it.
function updateAlreadyFailed(): boolean {
  const { remoteSha, failedSha } = readState();
  return Boolean(failedSha && remoteSha && failedSha === remoteSha);
}

// Asks the remote where main points. Used by the detached check and by `lane update`,
// which must never answer from the cache.
export function probeRemote(info: InstallPaths): string | null {
  if (!info.gitRoot) {
    return null;
  }
  const result = runAllowFailure("git", ["ls-remote", "origin", `refs/heads/${MAIN_BRANCH}`], {
    cwd: info.gitRoot,
    timeout: 20_000,
    // Never let a stale credential turn a silent check into a process hung on a prompt.
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
  });
  if (result.status !== 0) {
    return null;
  }
  // "<sha>\trefs/heads/main" — run() trims the whole string, so split rather than slice.
  const sha = result.stdout.split(/\s+/)[0];
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

function startBackgroundCheck(info: InstallPaths): void {
  if (!fs.existsSync(info.checkEntry)) {
    return;
  }
  spawnDetached(process.execPath, [info.checkEntry], { ...process.env, [CHILD_ENV]: "" });
}

// Whether the package's dependencies changed between `from` and HEAD. The package sits
// in a subfolder of the checkout, so the diff is run from there: run from the git root,
// the bare file names would name files that do not exist and the diff would be empty.
export function npmInstallNeeded(info: Pick<InstallPaths, "packageRoot">, from: string): boolean {
  const changed = runAllowFailure("git", ["diff", "--name-only", from, "HEAD", "--", "package-lock.json", "package.json"], {
    cwd: info.packageRoot,
    timeout: 60_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
  });
  return changed.status !== 0 || changed.stdout.length > 0;
}

// Builds into a scratch directory and only swaps it in once it has been proved to load.
// tsconfig sets no noEmitOnError, so a type error emits JavaScript *and* reports failure —
// building in place would install broken code and then tell us it failed.
function buildAndSwap(info: InstallPaths): string | null {
  const root = info.packageRoot;
  const next = path.join(root, "dist.next");
  const prev = path.join(root, "dist.prev");
  const dist = path.join(root, "dist");
  fs.rmSync(next, { recursive: true, force: true });

  const tsc = path.join(root, "node_modules", ".bin", "tsc");
  if (!fs.existsSync(tsc)) {
    return "TypeScript is not installed in the checkout";
  }
  const compiled = runAllowFailure(tsc, ["-p", "tsconfig.json", "--outDir", next], {
    cwd: root,
    timeout: BUILD_TIMEOUT_MS
  });
  if (compiled.status !== 0) {
    fs.rmSync(next, { recursive: true, force: true });
    return compiled.stdout.split("\n")[0] || compiled.stderr.split("\n")[0] || "the build failed";
  }

  runAllowFailure(process.execPath, [path.join(root, "tools", "build-clonedir.mjs")], {
    cwd: root,
    timeout: BUILD_TIMEOUT_MS,
    env: { ...process.env, LANE_BUILD_OUTDIR: next }
  });

  // tsc writes 644; npm is what normally makes a bin entry executable, and it does not run
  // here. Without this the swapped-in lane is "permission denied".
  const marked = runAllowFailure(process.execPath, [path.join(root, "tools", "build-bin-mode.mjs")], {
    cwd: root,
    timeout: 30_000,
    env: { ...process.env, LANE_BUILD_OUTDIR: next }
  });
  if (marked.status !== 0) {
    fs.rmSync(next, { recursive: true, force: true });
    return marked.stderr.split("\n")[0] || "could not make the new build executable";
  }

  // lane imports its whole module graph eagerly, so loading the new entry point is a
  // complete smoke test of the build for the price of one process start.
  const smoke = runAllowFailure(path.join(next, "bin", "lane.js"), ["--version"], {
    cwd: root,
    timeout: 30_000,
    env: { ...process.env, [CHILD_ENV]: "1", LANE_NO_AUTO_UPDATE: "1" }
  });
  if (smoke.status !== 0) {
    fs.rmSync(next, { recursive: true, force: true });
    return "the new build does not start";
  }

  // Two renames with no work between them, so another process sees either the whole old
  // build or the whole new one.
  fs.rmSync(prev, { recursive: true, force: true });
  if (fs.existsSync(dist)) {
    fs.renameSync(dist, prev);
  }
  fs.renameSync(next, dist);
  fs.rmSync(prev, { recursive: true, force: true });
  return null;
}

function rollback(info: InstallPaths, to: string): void {
  git(info, ["reset", "--hard", to]);
  buildAndSwap(info);
}

export function applyUpdate(info: InstallPaths): UpdateOutcome {
  const release = acquireLock();
  if (!release) {
    return { status: "skipped", reason: "another lane is already updating" };
  }

  // Ctrl-C between here and the end would be far worse than a failed build: a half-pruned
  // node_modules leaves lane unable to load at all, and lane is what you would fix it with.
  const ignoreSigint = () => {};
  process.on("SIGINT", ignoreSigint);

  const from = info.sha ?? "";
  try {
    const fetched = git(info, ["fetch", "--depth", "1", "origin", MAIN_BRANCH], 120_000);
    if (fetched.status !== 0) {
      return { status: "failed", reason: fetched.stderr.split("\n")[0] || "could not reach the remote" };
    }
    const reset = git(info, ["reset", "--hard", "FETCH_HEAD"]);
    if (reset.status !== 0) {
      return { status: "failed", reason: "could not move the checkout" };
    }
    const target = git(info, ["rev-parse", "HEAD"]).stdout;
    if (target && target === from) {
      // The fetch landed on the commit we already had, so there is nothing to rebuild.
      writeState({ remoteSha: target, checkedAt: Date.now() });
      return { status: "current" };
    }

    if (npmInstallNeeded(info, from)) {
      const installed = runAllowFailure("npm", ["install", "--silent"], {
        cwd: info.packageRoot,
        timeout: BUILD_TIMEOUT_MS
      });
      if (installed.status !== 0) {
        rollback(info, from);
        writeState({ failedSha: target });
        return { status: "failed", reason: "npm install failed; rolled back" };
      }
    }

    const buildError = buildAndSwap(info);
    if (buildError) {
      rollback(info, from);
      writeState({ failedSha: target });
      return { status: "failed", reason: `${buildError}; rolled back` };
    }

    const after = resolveInstall();
    writeState({ remoteSha: after.sha ?? undefined, checkedAt: Date.now(), failedSha: undefined });
    return { status: "updated", to: describeVersion(after) };
  } catch (error) {
    rollback(info, from);
    return { status: "failed", reason: `${errorMessage(error)}; rolled back` };
  } finally {
    process.off("SIGINT", ignoreSigint);
    release();
  }
}

export function recoveryHint(): string {
  return 'Reinstall with: sh -c "$(curl -fsSL https://raw.githubusercontent.com/anvk/lane-cli/main/tools/install.sh)"';
}

// Installed plugins move with lane: a plugin from lane's own checkout has just been moved,
// and a cloned one is pulled. A plugin that fails stays on its previous build.
export function updatePluginsQuietly(): string[] {
  try {
    return updatePlugins().map((line) => `plugin ${line}`);
  } catch (error) {
    return [`plugins: ${errorMessage(error)}`];
  }
}

// Runs the user's original command on the new build, then exits with whatever it did.
function reexec(info: InstallPaths, updatedTo: string): never {
  if (!fs.existsSync(info.distEntry)) {
    note(pc.red(`lane updated but ${info.distEntry} is missing.`));
    note(recoveryHint());
    process.exit(1);
  }
  // The parent is blocked inside spawnSync and cannot run a handler until it returns, so
  // without this the default disposition kills us while the child still owns the terminal.
  const ignoreSigint = () => {};
  process.on("SIGINT", ignoreSigint);
  const child = spawnSync(process.execPath, [info.distEntry, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, [CHILD_ENV]: "1" }
  });
  process.off("SIGINT", ignoreSigint);

  // Printed after the child so a full-screen picker cannot scroll it away.
  note(pc.dim(`lane updated to ${updatedTo}`));

  if (child.signal) {
    process.kill(process.pid, child.signal);
  }
  process.exit(child.status ?? 1);
}

// Called first thing in main(). Never throws, and returns quickly unless there is an update
// waiting from the last run.
export function maybeAutoUpdate(argv: string[]): void {
  try {
    if (environmentBlockers(argv).length > 0) {
      return;
    }
    const paths = resolveInstallPaths();
    if (!paths.managed) {
      return;
    }
    if (!updateIsPending(paths) || updateAlreadyFailed()) {
      startBackgroundCheck(paths);
      return;
    }
    if (checkoutBlockers(paths).length > 0) {
      return;
    }

    note(pc.dim(`Updating lane from ${describeVersion(resolveInstall())}…`));
    const outcome = applyUpdate(paths);
    if (outcome.status === "updated" && outcome.to) {
      for (const line of updatePluginsQuietly()) {
        note(pc.dim(line));
      }
      reexec(paths, outcome.to);
    }
    if (outcome.status === "failed") {
      note(pc.yellow(`lane could not update: ${outcome.reason}`));
      note(pc.dim(recoveryHint()));
    }
  } catch {
    // An update is a convenience. It must never stop the command the user asked for.
  }
}
