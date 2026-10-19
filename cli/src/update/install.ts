// Answers two questions with no network and no side effects: what am I running, and is it
// safe to update it in place.
//
// Everything the startup path needs is read straight off the filesystem — no git
// subprocesses — because lanes starts in about 0.05s and five spawns would double that.
// Shelling out to git is reserved for the display strings and the guards, which only run
// once there is actually an update waiting.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAllowFailure } from "../core/process.js";
import { findUp } from "../core/util.js";
import { readInstallMarker } from "./state.js";

export interface InstallPaths {
  packageRoot: string;
  gitRoot: string | null;
  distEntry: string;
  checkEntry: string;
  managed: boolean;
  branch: string | null;
  sha: string | null;
}

export interface InstallInfo extends InstallPaths {
  shortSha: string | null;
  commitDate: string | null;
}

export const MAIN_BRANCH = "main";
export const CHILD_ENV = "LANES_SELF_UPDATE_CHILD";

function git(cwd: string, args: string[]): string | null {
  const result = runAllowFailure("git", args, { cwd, timeout: 10_000 });
  return result.status === 0 ? result.stdout : null;
}

// The directory holding `marker`, looking a few levels up at most.
function findDirUp(startDir: string, marker: string): string | null {
  const found = findUp(startDir, marker, 8);
  return found ? path.dirname(found) : null;
}

// `.git/HEAD` is "ref: refs/heads/main" on a normal checkout, or a bare sha when detached.
function readHead(gitRoot: string): { branch: string | null; sha: string | null } {
  try {
    const head = fs.readFileSync(path.join(gitRoot, ".git", "HEAD"), "utf8").trim();
    const ref = /^ref:\s*(\S+)$/.exec(head);
    if (!ref) {
      return { branch: null, sha: /^[0-9a-f]{40}$/.test(head) ? head : null };
    }
    const branch = ref[1].replace(/^refs\/heads\//, "");
    try {
      const sha = fs.readFileSync(path.join(gitRoot, ".git", ref[1]), "utf8").trim();
      return { branch, sha: /^[0-9a-f]{40}$/.test(sha) ? sha : null };
    } catch {
      // A packed ref has no loose file; ask git rather than parse packed-refs ourselves.
      return { branch, sha: git(gitRoot, ["rev-parse", "HEAD"]) };
    }
  } catch {
    return { branch: null, sha: null };
  }
}

// The npm global bin is a symlink, so realpath is what tells us where the code actually
// lives. process.argv[1] would point at the symlink instead.
export function resolveInstallPaths(): InstallPaths {
  const here = path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)));
  const packageRoot = findDirUp(here, "package.json") ?? path.resolve(here, "../..");
  const gitRoot = findDirUp(packageRoot, ".git");
  const marker = readInstallMarker().installDir;
  const expected = marker ?? path.join(os.homedir(), ".lanes-cli", "cli");

  let managed = false;
  try {
    managed = fs.realpathSync(expected) === packageRoot;
  } catch {
    managed = false;
  }

  const head = gitRoot ? readHead(gitRoot) : { branch: null, sha: null };
  return {
    packageRoot,
    gitRoot,
    distEntry: path.join(packageRoot, "dist", "bin", "lanes.js"),
    checkEntry: path.join(packageRoot, "dist", "selfupdate", "check.js"),
    managed,
    branch: head.branch,
    sha: head.sha
  };
}

// The same, plus the strings only needed when a version is actually printed.
export function resolveInstall(): InstallInfo {
  const paths = resolveInstallPaths();
  return {
    ...paths,
    shortSha: paths.sha ? paths.sha.slice(0, 7) : null,
    commitDate: paths.gitRoot ? git(paths.gitRoot, ["show", "-s", "--format=%cs", "HEAD"]) : null
  };
}

export function packageVersion(packageRoot: string): string {
  try {
    const raw = fs.readFileSync(path.join(packageRoot, "package.json"), "utf8");
    return (JSON.parse(raw) as { version?: string }).version ?? "unknown";
  } catch {
    return "unknown";
  }
}

// The commit date is what makes two installs comparable at a glance; the sha is what
// identifies one exactly. package.json's version has never been bumped, so it is only the
// fallback for a checkout that is no longer a git repo.
export function describeVersion(info: InstallInfo): string {
  if (info.commitDate && info.shortSha) {
    return `${info.commitDate} (${info.shortSha})`;
  }
  return packageVersion(info.packageRoot);
}

const SKIP_COMMANDS = new Set(["update", "version", "doctor", "status", "help"]);

// Settings that rule out updating, even when asked for with `lanes update`.
export function settingBlockers(): string[] {
  const blockers: string[] = [];
  if (process.env.LANES_NO_AUTO_UPDATE) {
    blockers.push("LANES_NO_AUTO_UPDATE is set");
  }
  if (process.env[CHILD_ENV]) {
    blockers.push("already running as the re-executed child");
  }
  return blockers;
}

// Reasons not to update automatically that cost nothing to check: no filesystem, no git.
// Checked first so an ordinary command does no work at all.
export function environmentBlockers(argv: string[]): string[] {
  const blockers = settingBlockers();
  if (!process.stdout.isTTY) {
    blockers.push("output is not a terminal");
  }

  const args = argv.slice(2);
  if (args.some((a) => a === "--version" || a === "-v" || a === "--help" || a === "-h")) {
    blockers.push("showing version or help");
  }
  const first = args.find((a) => !a.startsWith("-"));
  if (first && SKIP_COMMANDS.has(first)) {
    blockers.push(`running '${first}'`);
  }
  return blockers;
}

// Reasons the checkout itself is not safe to move. Only worth asking once an update is
// actually waiting, because the last three shell out to git.
export function checkoutBlockers(info: InstallPaths): string[] {
  const blockers: string[] = [];
  if (!info.gitRoot) {
    blockers.push("not a git checkout");
    return blockers;
  }
  if (!info.managed) {
    blockers.push(`linked from ${info.packageRoot}, which is not the managed install`);
  }
  if (info.branch !== MAIN_BRANCH) {
    blockers.push(`checkout is on '${info.branch ?? "a detached HEAD"}', not ${MAIN_BRANCH}`);
  }
  if (fs.existsSync(path.join(info.gitRoot, ".git", "index.lock"))) {
    blockers.push("another git process is running in the checkout");
  }

  // Untracked files are ignored on purpose: `git reset --hard` leaves them alone, so they
  // are no reason to refuse an update.
  if (git(info.gitRoot, ["diff", "--cached", "--name-only"]) || git(info.gitRoot, ["diff", "--name-only"])) {
    blockers.push("the checkout has uncommitted changes");
  }
  // There is deliberately no "does this checkout have local commits" guard. The managed
  // install is a --depth 1 clone, so `origin/main..HEAD` reports the shallow boundary itself
  // as a local commit and the check is unanswerable here. What it was protecting against is
  // already covered: a developer's own checkout fails the managed test above, and edited
  // files fail the one right before this.
  return blockers;
}
