import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { copyPaths, type CopyPair, type CopyStrategy } from "./copy.js";
import { gitList } from "./git.js";
import { isDirectory } from "./util.js";

export function toLaneName(lanePrefix: string, laneIdOrName: string): string {
  const cleanLaneIdOrName = String(laneIdOrName).trim();
  if (!cleanLaneIdOrName) {
    throw new Error("Lane id is required.");
  }

  if (cleanLaneIdOrName.startsWith(lanePrefix)) {
    return cleanLaneIdOrName;
  }

  return `${lanePrefix}${cleanLaneIdOrName}`;
}

// A raw id (`1437`) or a prefixed lane name (`ABC-1437`, `ABC-12-fix`). Plain words are
// left to the command parser, since they are far more likely to be a mistyped command.
export function looksLikeLaneId(word: string): boolean {
  return /^\d/.test(word) || /^[A-Za-z]+-\d/.test(word);
}

export function getLanePath(repoRoot: string, lanesDir: string, laneName: string): string {
  return path.join(resolveLanesRoot(repoRoot, lanesDir), laneName);
}

export function resolveLanesRoot(repoRoot: string, lanesDir: string): string {
  return path.join(repoRoot, lanesDir);
}

export function ensureLanesDir(repoRoot: string, lanesDir: string): string {
  const absoluteLanesDir = resolveLanesRoot(repoRoot, lanesDir);
  fs.mkdirSync(absoluteLanesDir, { recursive: true });
  return absoluteLanesDir;
}

function isPathInside(childPath: string, parentPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

// True when copying `sourcePath` would copy the destination into itself, which is what
// happens when the lanes directory lives inside the base folder.
function wouldRecurse(sourcePath: string, destinationRoot: string): boolean {
  return sourcePath === destinationRoot || isPathInside(destinationRoot, sourcePath);
}

export interface SyncResult {
  strategy: CopyStrategy;
  entries: number;
  // Untracked, not ignored paths that stayed in the base because the copy skips them.
  left: number;
}

// What a brand-new lane worktree is missing from the base folder. `git worktree add`
// has just written every tracked file, so re-copying those is pure waste; what it has
// no idea about is the ignored content (node_modules, build output, local env files).
// Untracked files that are not ignored are deliberately not copied: a stray file in
// the base should not turn up on a new branch. `--directory` collapses a wholly
// ignored folder into a single entry, which is what makes it cheap to clone.
interface SyncPlan {
  missing: string[];
  left: string[];
  // Tracked files the base has edited without committing. The worktree holds the
  // committed version, so these are copied over it.
  changed: string[];
}

function planFromGit(sourceRoot: string): SyncPlan | null {
  const missing = gitPaths(sourceRoot, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"]);
  if (missing === null) {
    return null;
  }
  return {
    missing,
    left: gitPaths(sourceRoot, ["ls-files", "--others", "--exclude-standard", "--directory", "-z"]) ?? [],
    changed: gitPaths(sourceRoot, ["diff", "--name-only", "-z", "HEAD"]) ?? []
  };
}

// `null` when git cannot answer. `--directory` marks folders with a trailing slash.
function gitPaths(cwd: string, args: string[]): string[] | null {
  try {
    return gitList(cwd, args).map((entry) => entry.replace(/\/+$/, ""));
  } catch {
    return null;
  }
}

export function syncBaseFolderIntoLane(baseFolderPath: string, lanePath: string): SyncResult {
  if (!isDirectory(baseFolderPath)) {
    throw new Error(`Base folder does not exist: ${baseFolderPath}`);
  }

  if (!fs.existsSync(lanePath)) {
    fs.mkdirSync(lanePath, { recursive: true });
  }
  if (!fs.statSync(lanePath).isDirectory()) {
    throw new Error(`Lane destination is not a directory: ${lanePath}`);
  }

  const sourceRoot = fs.realpathSync.native(baseFolderPath);
  const destinationRoot = fs.realpathSync.native(lanePath);

  const plan = planFromGit(sourceRoot);
  if (!plan) {
    // Not a git repository, or git could not answer: mirror everything.
    return { strategy: "node", entries: copyEveryEntry(sourceRoot, destinationRoot), left: 0 };
  }

  const pairs: CopyPair[] = [];
  for (const relative of plan.missing) {
    const source = path.join(sourceRoot, relative);
    if (wouldRecurse(source, destinationRoot)) {
      continue;
    }
    pairs.push({ source, destination: path.join(destinationRoot, relative) });
  }

  const strategy = copyPaths(pairs);
  return {
    strategy,
    entries: pairs.length + overwriteChanged(sourceRoot, destinationRoot, plan.changed),
    left: plan.left.length
  };
}

function overwriteChanged(sourceRoot: string, destinationRoot: string, changed: string[]): number {
  let count = 0;
  for (const relative of changed) {
    const source = path.join(sourceRoot, relative);
    // A tracked file deleted in the base is simply left as the worktree checked it out.
    if (!fs.existsSync(source)) {
      continue;
    }
    const destination = path.join(destinationRoot, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, { recursive: true, force: true, errorOnExist: false });
    count += 1;
  }
  return count;
}

function copyEveryEntry(sourceRoot: string, destinationRoot: string): number {
  let count = 0;
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    if (entry.name === ".git") {
      continue;
    }
    const source = path.join(sourceRoot, entry.name);
    if (wouldRecurse(source, destinationRoot)) {
      continue;
    }
    fs.cpSync(source, path.join(destinationRoot, entry.name), {
      recursive: true,
      force: true,
      errorOnExist: false
    });
    count += 1;
  }
  return count;
}

export function listLaneFolders(repoRoot: string, lanesDir: string, lanePrefix: string): string[] {
  const absoluteLanesDir = resolveLanesRoot(repoRoot, lanesDir);
  if (!fs.existsSync(absoluteLanesDir)) {
    return [];
  }

  return fs
    .readdirSync(absoluteLanesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(lanePrefix))
    .map((entry) => entry.name)
    .sort();
}

// Directories whose mtimes reflect tooling, not the user's work. `node_modules`
// alone is ~90% of the files in a lane folder, so skipping it is both a large
// speedup and more accurate: an `npm install` is not lane activity.
const MTIME_SCAN_IGNORED = new Set([".git", "node_modules"]);

// The newest mtime anywhere in a lane folder. Every file has to be stat'ed, so the
// directory walk fans out instead of visiting one file at a time.
export async function getLaneLastUpdatedMs(lanePath: string): Promise<number> {
  const stat = await fsp.stat(lanePath);
  if (!stat.isDirectory()) {
    return stat.mtimeMs;
  }
  const entries = await fsp.readdir(lanePath, { withFileTypes: true });
  const childTimes = await Promise.all(
    entries
      .filter((entry) => !MTIME_SCAN_IGNORED.has(entry.name))
      .map((entry) => getLaneLastUpdatedMs(path.join(lanePath, entry.name)))
  );
  const latest = childTimes.reduce((max, time) => Math.max(max, time), 0);
  return latest || stat.mtimeMs;
}
