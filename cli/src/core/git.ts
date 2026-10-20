import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import { run, runInteractive } from "./process.js";
import { errorMessage } from "./util.js";

const LOCAL_PREFIX = "refs/heads/";
export const REMOTE_PREFIX = "refs/remotes/origin/";

export function getRepoRoot(cwd: string): string {
  return run("git", ["rev-parse", "--show-toplevel"], { cwd }).stdout;
}

// The entries a git command prints, one per line or NUL separated with `-z`. Unlike
// `run`, the output is not trimmed as a whole, so no entry loses its leading characters.
// Throws when git fails.
export function gitList(cwd: string, args: string[]): string[] {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1 << 28 });
  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || "Command failed with no output").trim();
    throw new Error(`git ${args.join(" ")}\n${details}`);
  }
  if (args.includes("-z")) {
    return result.stdout.split("\0").filter(Boolean);
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function fetchOrigin(repoRoot: string): void {
  runInteractive("git", ["fetch", "origin"], { cwd: repoRoot });
}

// A repository made locally (`git init`, a project generator) has no `origin`; lanes then
// works from its local branches and skips every fetch.
export function hasOrigin(repoRoot: string): boolean {
  try {
    return gitList(repoRoot, ["remote"]).includes("origin");
  } catch {
    return false;
  }
}

export function rebaseCurrentBranchOnto(repoRoot: string, baseRef: string): void {
  runInteractive("git", ["rebase", "--autostash", baseRef], { cwd: repoRoot });
}

// Whether `ref` resolves to a commit, e.g. a base's `origin/main` before any fetch.
export function refResolves(repoRoot: string, ref: string): boolean {
  try {
    run("git", ["rev-parse", "--verify", ref], { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
}

function refExists(repoRoot: string, fullRef: string): boolean {
  try {
    run("git", ["show-ref", "--verify", fullRef], { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
}

export function localBranchExists(repoRoot: string, branchName: string): boolean {
  return refExists(repoRoot, `${LOCAL_PREFIX}${branchName}`);
}

function remoteBranchExists(repoRoot: string, branchName: string): boolean {
  return refExists(repoRoot, `${REMOTE_PREFIX}${branchName}`);
}

// A lane folder deleted by hand leaves its worktree registered, and git then refuses
// to add a new one at the same path ("missing but already registered worktree").
// Pruning only drops records whose folders are gone, so it is safe to do every time.
function prepareWorktreePath(repoRoot: string, lanePath: string): void {
  if (fs.existsSync(lanePath)) {
    throw new Error(`Lane folder already exists: ${lanePath}`);
  }
  pruneWorktrees(repoRoot);
}

interface CreateOrAttachWorktreeArgs {
  repoRoot: string;
  lanePath: string;
  branchName: string;
  baseRef: string;
}

export function createOrAttachWorktree({ repoRoot, lanePath, branchName, baseRef }: CreateOrAttachWorktreeArgs): void {
  prepareWorktreePath(repoRoot, lanePath);
  if (localBranchExists(repoRoot, branchName)) {
    runInteractive("git", ["worktree", "add", lanePath, branchName], { cwd: repoRoot });
    return;
  }
  runInteractive("git", ["worktree", "add", "-b", branchName, lanePath, baseRef], { cwd: repoRoot });
}

// Checks an existing branch out into a new worktree: the local branch when there is one
// (left where it is, so no local commits are lost), otherwise a new local branch of the
// same name tracking `origin`, so a push goes back to the branch it came from.
// Returns how many commits the local branch is behind `origin`, when both exist.
export function addBranchWorktree(repoRoot: string, lanePath: string, branchName: string): { behind: number } {
  prepareWorktreePath(repoRoot, lanePath);

  const hasRemote = remoteBranchExists(repoRoot, branchName);
  if (localBranchExists(repoRoot, branchName)) {
    runInteractive("git", ["worktree", "add", lanePath, branchName], { cwd: repoRoot });
    if (!hasRemote) {
      return { behind: 0 };
    }
    const behind = run("git", ["rev-list", "--count", `${LOCAL_PREFIX}${branchName}..${REMOTE_PREFIX}${branchName}`], {
      cwd: repoRoot
    }).stdout;
    return { behind: Number.parseInt(behind, 10) || 0 };
  }

  if (!hasRemote) {
    throw new Error(`Branch '${branchName}' exists neither locally nor on origin.`);
  }
  runInteractive("git", ["worktree", "add", "--track", "-b", branchName, lanePath, `origin/${branchName}`], {
    cwd: repoRoot
  });
  return { behind: 0 };
}

export function removeWorktree(repoRoot: string, lanePath: string, options: { force?: boolean } = {}): void {
  runInteractive("git", ["worktree", "remove", ...(options.force ? ["--force"] : []), lanePath], { cwd: repoRoot });
}

export function pruneWorktrees(repoRoot: string): void {
  run("git", ["worktree", "prune"], { cwd: repoRoot });
}

interface WorktreeEntry {
  path: string;
  // The checked-out branch, or `null` when detached.
  branch: string | null;
  // The folder was deleted by hand (not via `lanes remove`); git keeps the record until pruned.
  prunable: boolean;
}

// Every worktree of a repository, the main clone included.
function listWorktrees(repoRoot: string): WorktreeEntry[] {
  const output = run("git", ["worktree", "list", "--porcelain"], { cwd: repoRoot }).stdout;
  const entries: WorktreeEntry[] = [];
  for (const block of output.split(/\n\s*\n/)) {
    const lines = block.split("\n");
    const worktreeLine = lines.find((line) => line.startsWith("worktree "));
    if (!worktreeLine) {
      continue;
    }
    const branchLine = lines.find((line) => line.startsWith(`branch ${LOCAL_PREFIX}`));
    entries.push({
      path: worktreeLine.slice("worktree ".length).trim(),
      branch: branchLine ? branchLine.slice(`branch ${LOCAL_PREFIX}`.length).trim() : null,
      prunable: lines.some((line) => line.startsWith("prunable"))
    });
  }
  return entries;
}

export function listPrunableWorktrees(repoRoot: string): string[] {
  return listWorktrees(repoRoot)
    .filter((entry) => entry.prunable)
    .map((entry) => entry.path);
}

// Which worktree has each local branch checked out. Git lets a branch live in only one
// of them, so this is also what a checkout would collide with.
export function listWorktreeBranches(repoRoot: string): Map<string, string> {
  const holders = new Map<string, string>();
  for (const entry of listWorktrees(repoRoot)) {
    if (entry.branch) {
      holders.set(entry.branch, entry.path);
    }
  }
  return holders;
}

// The branch a worktree has checked out, or `null` when it is detached or git cannot say.
export function currentBranch(worktreePath: string): string | null {
  try {
    return run("git", ["branch", "--show-current"], { cwd: worktreePath }).stdout || null;
  } catch {
    return null;
  }
}

export function deleteLocalBranch(repoRoot: string, branchName: string): { deleted: boolean; message?: string } {
  if (!localBranchExists(repoRoot, branchName)) {
    return { deleted: false, message: "branch not found" };
  }
  try {
    run("git", ["branch", "-d", branchName], { cwd: repoRoot });
    return { deleted: true };
  } catch (error) {
    return { deleted: false, message: errorMessage(error) };
  }
}

// What makes a base folder unfit to branch a lane from: work that exists only in that
// folder. Being *behind* `ref` does not count -- the rebase that runs before a lane is
// created is exactly what fixes that -- and neither do untracked files, which the copy
// step leaves in the base. So only uncommitted changes to tracked files and commits that
// never reached `ref` are collected here.
export interface BaseWorkingState {
  staged: string[];
  unstaged: string[];
  localCommits: string[];
}

export function inspectBaseWorkingState(repoRoot: string, baseRef: string): BaseWorkingState {
  return {
    staged: gitList(repoRoot, ["diff", "--cached", "--name-only"]),
    unstaged: gitList(repoRoot, ["diff", "--name-only"]),
    localCommits: gitList(repoRoot, ["log", "--oneline", "--no-decorate", `${baseRef}..HEAD`])
  };
}

export function isBaseWorkingStateClean(state: BaseWorkingState): boolean {
  return state.staged.length === 0 && state.unstaged.length === 0 && state.localCommits.length === 0;
}

// Fetches just this branch rather than all of origin. Returns false when origin has no
// such branch.
export function fetchRemoteBranch(repoRoot: string, branchName: string): boolean {
  try {
    run("git", ["fetch", "origin", `+${LOCAL_PREFIX}${branchName}:${REMOTE_PREFIX}${branchName}`], { cwd: repoRoot });
    return true;
  } catch (error) {
    if (/couldn't find remote ref/i.test(errorMessage(error))) {
      return false;
    }
    throw error;
  }
}

const execFileAsync = promisify(execFile);

// The subject and commit time of a worktree's HEAD, or `null` when it has no commits or
// git cannot say. Asynchronous, so the lane list can ask every lane at once.
export async function lastCommit(
  worktreePath: string
): Promise<{ subject: string | null; committedAtMs: number } | null> {
  try {
    const output = (await execFileAsync("git", ["log", "-1", "--pretty=%ct%x09%s"], { cwd: worktreePath })).stdout.trim();
    if (!output) {
      return null;
    }
    const [unixSecondsRaw, ...subjectParts] = output.split("\t");
    const unixSeconds = Number.parseInt(unixSecondsRaw, 10);
    if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) {
      return null;
    }
    return { subject: subjectParts.join("\t").trim() || null, committedAtMs: unixSeconds * 1000 };
  } catch {
    return null;
  }
}

// What `git status` reports as changed in a worktree, new files included: the work that
// removing the worktree would lose. Paths are relative to the worktree; null when git
// cannot answer (the folder is not a worktree any more, say).
export async function uncommittedPaths(worktreePath: string): Promise<string[] | null> {
  let stdout: string;
  try {
    stdout = (await execFileAsync("git", ["status", "--porcelain=v1", "-z"], { cwd: worktreePath, maxBuffer: 64 * 1024 * 1024 })).stdout;
  } catch {
    return null;
  }
  // Each entry is "XY path"; a rename or copy is followed by its old path as one more entry.
  const entries = stdout.split("\0").filter(Boolean);
  const paths: string[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const status = entries[i].slice(0, 2);
    paths.push(entries[i].slice(3).replace(/\/$/, ""));
    if (status[0] === "R" || status[0] === "C") {
      i += 1;
    }
  }
  return paths;
}
