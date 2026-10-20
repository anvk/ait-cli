// Installing, updating and removing plugins: `lanes plugin install|uninstall|update|list`.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { runAllowFailure } from "../core/process.js";
import { resolveInstallPaths } from "../update/install.js";
import { isDirectory } from "../core/util.js";
import { importPlugin } from "./load.js";
import {
  pluginLink,
  pluginPackage,
  pluginsRoot,
  readInstalled,
  reposRoot,
  writeInstalled,
  type InstalledPlugin,
  type PluginKind
} from "./state.js";

const BUILD_TIMEOUT_MS = 180_000;
const GIT_TIMEOUT_MS = 120_000;

export interface PluginSource {
  kind: "git" | "path";
  // The URL without its `#subdir`, or the absolute path.
  location: string;
  // Folder inside the repository holding the plugin package, for a URL.
  subdir: string;
}

// `https://host/x/y.git#plugins/warp`, `git@host:x/y.git`, or a folder on disk.
export function parseSource(input: string): PluginSource {
  const value = input.trim();
  if (!value) {
    throw new Error("Give a git URL (optionally with #<subdir>) or a path to a plugin folder.");
  }
  const looksLikeGit = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^[\w.-]+@[\w.-]+:/.test(value);
  if (looksLikeGit) {
    const hash = value.indexOf("#");
    const location = hash === -1 ? value : value.slice(0, hash);
    const subdir = hash === -1 ? "" : value.slice(hash + 1).replace(/^\/+|\/+$/g, "");
    return { kind: "git", location, subdir };
  }
  const location = path.resolve(value.startsWith("~/") ? path.join(process.env.HOME ?? "", value.slice(2)) : value);
  if (!isDirectory(location)) {
    throw new Error(`${location} is not a folder. Give a git URL or a path to a plugin folder.`);
  }
  return { kind: "path", location, subdir: "" };
}

function git(cwd: string, args: string[]) {
  return runAllowFailure("git", args, { cwd, timeout: GIT_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
}

function normalizeGitUrl(url: string): string {
  return url
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/^ssh:\/\/git@/, "https://")
    .toLowerCase();
}

// the lanes repository, when it runs from a managed checkout: a plugin from the same URL
// can use that checkout instead of a second clone, and then moves when lanes updates.
function lanesCheckoutFor(url: string): string | null {
  const paths = resolveInstallPaths();
  if (!paths.gitRoot || !paths.managed) {
    return null;
  }
  const origin = git(paths.gitRoot, ["remote", "get-url", "origin"]);
  return origin.status === 0 && normalizeGitUrl(origin.stdout) === normalizeGitUrl(url) ? paths.gitRoot : null;
}

// Installs the plugin's dependencies and runs its build script, in the plugin folder.
// Returns a reason on failure. A previous build is kept aside and restored if the new one
// fails. With a lockfile it is `npm ci`, which installs exactly that and leaves a cloned
// plugin's checkout clean for the next update; a plugin without one gets `npm install`.
function buildPlugin(dir: string): string | null {
  const pkg = pluginPackage(dir);
  const verb = fs.existsSync(path.join(dir, "package-lock.json")) ? "ci" : "install";
  const installed = runAllowFailure("npm", [verb, "--no-audit", "--no-fund", "--silent"], { cwd: dir, timeout: BUILD_TIMEOUT_MS });
  if (installed.status !== 0) {
    return `npm ${verb} failed: ${(installed.stderr || installed.stdout).split("\n").find(Boolean) ?? "no output"}`;
  }
  if (!pkg.scripts?.build) {
    return null;
  }
  const dist = path.join(dir, path.dirname(pkg.main ?? "dist/index.js"));
  const prev = `${dist}.prev`;
  fs.rmSync(prev, { recursive: true, force: true });
  if (fs.existsSync(dist)) {
    fs.renameSync(dist, prev);
  }
  const built = runAllowFailure("npm", ["run", "build", "--silent"], { cwd: dir, timeout: BUILD_TIMEOUT_MS });
  if (built.status !== 0) {
    fs.rmSync(dist, { recursive: true, force: true });
    if (fs.existsSync(prev)) {
      fs.renameSync(prev, dist);
    }
    return `build failed: ${(built.stderr || built.stdout).split("\n").find(Boolean) ?? "no output"}`;
  }
  fs.rmSync(prev, { recursive: true, force: true });
  return null;
}

function declaredName(dir: string): string {
  let pkg: ReturnType<typeof pluginPackage>;
  try {
    pkg = pluginPackage(dir);
  } catch {
    throw new Error(`${dir} has no readable package.json.`);
  }
  const name = pkg.lanes?.name;
  if (typeof name !== "string" || !/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error(`${dir}/package.json must declare "lanes": { "name": "<plugin>", "api": 1 }.`);
  }
  return name;
}

function link(name: string, dir: string): void {
  fs.mkdirSync(pluginsRoot(), { recursive: true });
  const linkPath = pluginLink(name);
  fs.rmSync(linkPath, { recursive: true, force: true });
  fs.symlinkSync(dir, linkPath);
}

// Installs (or reinstalls) a plugin and returns its record. Prints progress.
export async function installPlugin(input: string): Promise<InstalledPlugin> {
  const source = parseSource(input);
  let dir: string;
  let kind: PluginKind;
  let repo: string | undefined;

  if (source.kind === "path") {
    dir = source.location;
    kind = "path";
  } else if (lanesCheckoutFor(source.location)) {
    dir = path.join(lanesCheckoutFor(source.location)!, source.subdir);
    kind = "lanes";
    if (!isDirectory(dir)) {
      throw new Error(`The lanes checkout has no folder ${source.subdir}.`);
    }
  } else {
    repo = path.join(reposRoot(), createHash("sha256").update(normalizeGitUrl(source.location)).digest("hex").slice(0, 12));
    kind = "git";
    if (isDirectory(path.join(repo, ".git"))) {
      console.log(pc.cyan(`Updating ${source.location}...`));
      const pulled = pullRepo(repo);
      if (pulled) {
        throw new Error(pulled);
      }
    } else {
      console.log(pc.cyan(`Cloning ${source.location}...`));
      fs.rmSync(repo, { recursive: true, force: true });
      fs.mkdirSync(reposRoot(), { recursive: true });
      const cloned = git(reposRoot(), ["clone", "--quiet", "--depth", "1", source.location, repo]);
      if (cloned.status !== 0) {
        fs.rmSync(repo, { recursive: true, force: true });
        throw new Error(`Could not clone ${source.location}: ${cloned.stderr.split("\n").find(Boolean) ?? "git failed"}`);
      }
    }
    dir = path.join(repo, source.subdir);
    if (!isDirectory(dir)) {
      throw new Error(`${source.location} has no folder ${source.subdir || "(root)"}.`);
    }
  }

  const name = declaredName(dir);
  const existing = readInstalled().find((plugin) => plugin.name === name);
  if (existing && existing.source !== input.trim()) {
    throw new Error(`A plugin named '${name}' is already installed from ${existing.source}. Run \`lanes plugin uninstall ${name}\` first.`);
  }

  console.log(pc.cyan(`Building plugin '${name}'...`));
  const buildError = buildPlugin(dir);
  if (buildError) {
    throw new Error(`Plugin '${name}' could not be built: ${buildError}`);
  }
  await importPlugin(dir, name);

  link(name, dir);
  const record: InstalledPlugin = { name, source: input.trim(), kind, dir, ...(repo ? { repo } : {}) };
  writeInstalled([...readInstalled().filter((plugin) => plugin.name !== name), record]);
  console.log(pc.green(`Installed plugin '${name}' (${describeKind(record)}).`));
  return record;
}

function pullRepo(repo: string): string | null {
  const fetched = git(repo, ["fetch", "--quiet", "--depth", "1", "origin", "HEAD"]);
  if (fetched.status !== 0) {
    return `could not fetch: ${fetched.stderr.split("\n").find(Boolean) ?? "git failed"}`;
  }
  const reset = git(repo, ["reset", "--quiet", "--hard", "FETCH_HEAD"]);
  return reset.status === 0 ? null : "could not move the checkout";
}

export function uninstallPlugin(name: string): void {
  const installed = readInstalled();
  const record = installed.find((plugin) => plugin.name === name);
  if (!record) {
    throw new Error(`No plugin named '${name}' is installed. See \`lanes plugin list\`.`);
  }
  fs.rmSync(pluginLink(name), { recursive: true, force: true });
  if (record.kind === "git" && record.repo && !installed.some((other) => other !== record && other.repo === record.repo)) {
    fs.rmSync(record.repo, { recursive: true, force: true });
  }
  writeInstalled(installed.filter((plugin) => plugin !== record));
  console.log(pc.green(`Uninstalled plugin '${name}'.`));
}

export function describeKind(record: InstalledPlugin): string {
  return { path: "linked folder", git: "git clone", lanes: "in the lanes checkout" }[record.kind];
}

// The commit a plugin's folder is at, for `lanes plugin list` and doctor.
export function pluginVersion(record: InstalledPlugin): string {
  const shown = git(record.dir, ["show", "-s", "--format=%cs %h", "HEAD"]);
  return shown.status === 0 && shown.stdout ? shown.stdout : "unknown";
}

// Pulls and rebuilds the plugins lanes can update. Returns one line per plugin touched or
// failed; nothing for a plugin that was already current.
export function updatePlugins(only?: string): string[] {
  const installed = readInstalled();
  if (only && !installed.some((plugin) => plugin.name === only)) {
    throw new Error(`No plugin named '${only}' is installed. See \`lanes plugin list\`.`);
  }
  const notes: string[] = [];
  for (const record of installed) {
    if (only && record.name !== only) {
      continue;
    }
    if (record.kind === "path") {
      if (only) {
        notes.push(`${record.name}: linked from ${record.dir}; lanes does not update it`);
      }
      continue;
    }
    const before = pluginVersion(record);
    if (record.kind === "git" && record.repo) {
      const pulled = pullRepo(record.repo);
      if (pulled) {
        notes.push(`${record.name}: ${pulled}`);
        continue;
      }
    }
    const after = pluginVersion(record);
    if (after === before && !only) {
      continue;
    }
    const buildError = buildPlugin(record.dir);
    notes.push(buildError ? `${record.name}: ${buildError}; keeping the previous build` : `${record.name}: ${before} → ${after}`);
  }
  return notes;
}

export function listPlugins(broken: { name: string; reason: string }[]): string[] {
  const installed = readInstalled();
  if (installed.length === 0) {
    return ["No plugins installed. Install one with: lanes plugin install <git URL or path>"];
  }
  return installed.map((record) => {
    const problem = broken.find((entry) => entry.name === record.name);
    const state = problem ? pc.red(`broken: ${problem.reason}`) : pc.green("ok");
    return `${pc.bold(record.name)}  ${pluginVersion(record)}  ${describeKind(record)}  ${pc.dim(record.source)}  ${state}`;
  });
}
