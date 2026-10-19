// Creating, checking out, opening and deleting a single task.
import fs from "node:fs";
import path from "node:path";
import { stdin as input } from "node:process";
import pc from "picocolors";
import { resolveBaseCommands, resolveBranchPrefix } from "./config.js";
import {
  addBranchWorktree,
  createOrAttachWorktree,
  currentBranch,
  deleteLocalBranch,
  fetchOrigin,
  fetchRemoteBranch,
  inspectBaseWorkingState,
  isBaseWorkingStateClean,
  listWorktreeBranches,
  localBranchExists,
  rebaseCurrentBranchOnto,
  removeWorktree
} from "./git.js";
import { ensureTasksDir, getTaskPath, listTaskFolders, syncBaseFolderIntoTask, toTaskName } from "./tasks.js";
import type { BaseConfig, LaneConfig } from "./types.js";
import { ask, realpathOrSelf } from "./util.js";
import { closeCurrentTab, forgetTask, setupCommandsOf } from "../plugins/registry.js";
import { runList } from "../hooks/run.js";
import type { TaskContext } from "../plugins/types.js";
import { locateInBase, resolveBaseRepoRoot, taskIdentity, type TaskLocation } from "./workspace.js";

export interface OpenOptions {
  closeCurrentTab?: boolean;
}

// Create the task even though the base still holds work of its own.
export interface ForceOption {
  force?: boolean;
}

// The task as the command lines see it.
function taskContext(configDir: string, config: LaneConfig, location: TaskLocation, created: boolean): TaskContext {
  const { key, label } = taskIdentity(config, location.base, location.taskName);
  return {
    taskName: location.taskName,
    taskPath: location.taskPath,
    key,
    label,
    branch: taskBranch(config, location),
    base: location.base.name,
    root: configDir,
    created
  };
}

// Runs the base's `open` list for the task; right after creating it, and when the setup
// prompt was accepted, the `create` list runs first so what it sets up is there when the
// open commands start.
export function openTask(
  configDir: string,
  config: LaneConfig,
  location: TaskLocation,
  options: OpenOptions & { created?: boolean; runSetup?: boolean }
): void {
  const commands = resolveBaseCommands(config, location.base);
  const ctx = taskContext(configDir, config, location, Boolean(options.created));
  if (options.runSetup) {
    runList(ctx, commands.create, { announce: true });
  }
  runList(ctx, commands.open, { after: true, runSetup: options.runSetup });
  if (options.closeCurrentTab && !closeCurrentTab()) {
    console.log(pc.yellow("Not running inside a terminal lane can close; leaving the current tab open."));
  }
}

// The branch lane creates for a new task.
function taskBranchName(config: LaneConfig, base: BaseConfig, taskName: string): string {
  return `${resolveBranchPrefix(config, base)}${taskName}`;
}

// Long file lists in the not-clean report are cut off; the point is to name the base,
// not to reprint `git status`.
const MAX_LISTED_DIRTY_ITEMS = 10;

function describeDirtyItems(label: string, items: string[]): string[] {
  if (items.length === 0) {
    return [];
  }
  const shown = items.slice(0, MAX_LISTED_DIRTY_ITEMS);
  const hidden = items.length - shown.length;
  return [
    `  ${label} (${items.length}):`,
    ...shown.map((item) => `    ${item}`),
    ...(hidden > 0 ? [`    ...and ${hidden} more`] : [])
  ];
}

// A task branches from `base.ref` and then has the base's ignored content copied over
// it, so edits and commits living only in the base would be silently lost (they are not
// on the new branch). Creation stops instead. Untracked files do not count: the copy
// leaves them in the base, which is where a stray file belongs. A base that is merely
// behind `base.ref` is fine too, because the rebase right after this brings it forward.
function assertBaseIsClean(base: BaseConfig, baseRepoRoot: string, options: ForceOption): void {
  if (options.force) {
    console.log(pc.yellow(`Skipping the clean-base check for '${base.name}' (--force).`));
    return;
  }
  const state = inspectBaseWorkingState(baseRepoRoot, base.ref);
  if (isBaseWorkingStateClean(state)) {
    return;
  }

  throw new Error(
    [
      `Base '${base.name}' (${base.folder}) is not clean, so no task was created.`,
      ...describeDirtyItems("staged, uncommitted", state.staged),
      ...describeDirtyItems("modified, uncommitted", state.unstaged),
      ...describeDirtyItems(`commits not on ${base.ref}`, state.localCommits),
      "",
      `Commit, stash or push this work in ${base.folder}, then run the command again.`,
      "Pass --force to create the task from the base anyway."
    ].join("\n")
  );
}

// The last step of making a task: bring over what the new worktree lacks from the base.
function copyBaseIntoTask(configDir: string, location: TaskLocation): void {
  const { base, taskName, taskPath } = location;
  console.log(pc.cyan(`Copying ${base.folder} into ${taskName}...`));
  const sync = syncBaseFolderIntoTask(path.resolve(configDir, base.folder), taskPath);
  console.log(pc.dim(`  ${sync.entries} path(s) ${sync.strategy === "clone" ? "cloned" : "copied"}`));
  if (sync.left > 0) {
    console.log(pc.dim(`  ${sync.left} untracked path(s) left in ${base.folder}, not copied`));
  }
  console.log(pc.green(`Created: ${taskPath}`));
}

export function createTaskFolder(
  configDir: string,
  config: LaneConfig,
  location: TaskLocation,
  options: ForceOption = {}
): void {
  const { base, taskName, taskPath } = location;
  const baseRepoRoot = resolveBaseRepoRoot(configDir, base);

  console.log(pc.cyan(`Fetching origin in ${base.folder}...`));
  fetchOrigin(baseRepoRoot);
  // Checked after the fetch, so `base.ref` is current, and before the rebase, so
  // `--autostash` cannot hide uncommitted changes by tucking them away and back.
  assertBaseIsClean(base, baseRepoRoot, options);

  ensureTasksDir(configDir, base.tasksDir);
  console.log(pc.cyan(`Rebasing ${base.folder} onto ${base.ref}...`));
  rebaseCurrentBranchOnto(baseRepoRoot, base.ref);
  console.log(pc.cyan(`Creating ${taskName} from ${base.ref}...`));
  createOrAttachWorktree({
    repoRoot: baseRepoRoot,
    taskPath,
    branchName: taskBranchName(config, base, taskName),
    baseRef: base.ref
  });
  copyBaseIntoTask(configDir, location);
}

// Task names a branch may take, preferred first. A branch lane made itself
// (`<branchPrefix><taskName>`) maps back to that same task name. Any other branch is
// named after its last `/` part (`someone/LANE-558-fix` → `LANE-558-fix`), then after the
// whole branch should that name be taken (`LANE-someone-LANE-558-fix`). Characters a folder
// name should not carry become `-`. The name always starts with the task prefix exactly,
// since the task list matches it case-sensitively: a prefix in another case is respelled
// (`lane-701` → `LANE-701`), and a missing one is added.
export function taskNamesForBranch(config: LaneConfig, base: BaseConfig, branchName: string): string[] {
  const toName = (raw: string): string => {
    const clean = raw.replace(/[^A-Za-z0-9._-]+/g, "-");
    return clean.toLowerCase().startsWith(config.taskPrefix.toLowerCase())
      ? `${config.taskPrefix}${clean.slice(config.taskPrefix.length)}`
      : toTaskName(config.taskPrefix, clean);
  };
  const branchPrefix = resolveBranchPrefix(config, base);
  if (branchPrefix && branchName.startsWith(branchPrefix)) {
    return [toName(branchName.slice(branchPrefix.length))];
  }
  const lastPart = branchName.slice(branchName.lastIndexOf("/") + 1);
  return [...new Set([toName(lastPart), toName(branchName)])];
}

export interface BranchHolder {
  // The task holding the branch, when the worktree is one of this base's task folders.
  taskName: string | null;
  // Its folder, relative to the workspace.
  folder: string;
}

// Every worktree of a base that has a branch checked out, keyed by branch.
export function describeBranchHolders(
  configDir: string,
  config: LaneConfig,
  base: BaseConfig,
  baseRepoRoot: string
): Map<string, BranchHolder> {
  const taskNamesByPath = new Map(
    listTaskFolders(configDir, base.tasksDir, config.taskPrefix).map((taskName) => [
      realpathOrSelf(getTaskPath(configDir, base.tasksDir, taskName)),
      taskName
    ])
  );
  const holders = new Map<string, BranchHolder>();
  for (const [branchName, worktreePath] of listWorktreeBranches(baseRepoRoot)) {
    const realPath = realpathOrSelf(worktreePath);
    holders.set(branchName, {
      taskName: taskNamesByPath.get(realPath) ?? null,
      folder: path.relative(configDir, realPath) || "."
    });
  }
  return holders;
}

// Makes a task of an existing branch, or finds the task that already has it. Only that
// one branch is fetched, and only when a task is about to be made of it.
function checkoutBranchTask(
  configDir: string,
  config: LaneConfig,
  base: BaseConfig,
  branchName: string,
  options: ForceOption = {}
): { location: TaskLocation; created: boolean } {
  const baseRepoRoot = resolveBaseRepoRoot(configDir, base);

  // Git keeps a branch in one worktree at a time: an existing task is simply opened,
  // anything else (the base clone itself, a worktree made by hand) has to let go first.
  const holder = describeBranchHolders(configDir, config, base, baseRepoRoot).get(branchName);
  if (holder?.taskName) {
    return { location: locateInBase(configDir, base, holder.taskName), created: false };
  }
  if (holder) {
    throw new Error(
      `Branch '${branchName}' is already checked out in ${holder.folder}. Switch that checkout to another branch, then run this again.`
    );
  }

  console.log(pc.cyan(`Fetching ${branchName} from origin...`));
  if (!fetchRemoteBranch(baseRepoRoot, branchName) && !localBranchExists(baseRepoRoot, branchName)) {
    throw new Error(`Branch '${branchName}' exists neither locally nor on origin.`);
  }

  // A folder by that name is some other branch's task (this branch's was found above).
  const candidates = taskNamesForBranch(config, base, branchName).map((taskName) =>
    locateInBase(configDir, base, taskName)
  );
  const location = candidates.find((candidate) => !candidate.exists);
  if (!location) {
    const taken = candidates.at(-1)!;
    const onBranch = currentBranch(taken.taskPath);
    throw new Error(
      `Task folder already exists: ${taken.taskPath}${onBranch ? ` (on branch '${onBranch}')` : ""}\nRemove it or check that branch out there by hand.`
    );
  }

  assertBaseIsClean(base, baseRepoRoot, options);

  ensureTasksDir(configDir, base.tasksDir);
  console.log(pc.cyan(`Checking out ${branchName} as ${location.taskName}...`));
  const { behind } = addBranchWorktree(baseRepoRoot, location.taskPath, branchName);
  if (behind > 0) {
    console.log(
      pc.yellow(`Local branch '${branchName}' is ${behind} commit(s) behind origin; run 'git pull' in the task to catch up.`)
    );
  }
  copyBaseIntoTask(configDir, location);
  return { location: { ...location, exists: true }, created: true };
}

export async function checkoutAndOpen(
  configDir: string,
  config: LaneConfig,
  base: BaseConfig,
  branchName: string,
  options: OpenOptions & ForceOption
): Promise<void> {
  const { location, created } = checkoutBranchTask(configDir, config, base, branchName, options);
  const runSetup = created ? await askToRunSetup(config, base) : false;
  openTask(configDir, config, location, { ...options, created, runSetup });
}

// Asked once per new task, and only when there is something to run: the base's `create`
// list, or a setup command carried by one of its `open` lines (a Warp tab's --setup).
export async function askToRunSetup(config: LaneConfig, base: BaseConfig): Promise<boolean> {
  const lists = resolveBaseCommands(config, base);
  const commands = [...lists.open.flatMap(setupCommandsOf), ...lists.create];
  if (commands.length === 0 || !input.isTTY) {
    return false;
  }
  const answer = await ask(`Run the env setup script (${commands.join(", ")})? [y/N] `);
  return /^y(es)?$/i.test(answer.trim());
}

export async function promptForExactConfirmation(prompt: string, expected: string): Promise<void> {
  const answer = (await ask(`${prompt}\n> `)).trim();
  if (answer !== expected) {
    throw new Error("Confirmation text did not match. Aborting.");
  }
}

// The branch a task is on, read from its worktree rather than rebuilt from its name, so
// a task checked out from someone else's branch still removes the right one. A task left
// detached falls back to the branch lane would have created for it.
function taskBranch(config: LaneConfig, location: TaskLocation): string {
  return currentBranch(location.taskPath) ?? taskBranchName(config, location.base, location.taskName);
}

// Runs the base's `remove` list (a failure there, Docker not running say, must not keep
// the task from being removed), then removes the worktree (discarding uncommitted
// changes), its branch when git considers it merged, and whatever plugin commands
// left behind for it.
export function deleteTask(configDir: string, config: LaneConfig, location: TaskLocation, baseRepoRoot: string): void {
  // Read before the worktree goes, since the branch is only known from inside it.
  const branchName = taskBranch(config, location);
  runList(taskContext(configDir, config, location, false), resolveBaseCommands(config, location.base).remove, {
    announce: true,
    failureNote: "continuing with removal"
  });
  removeWorktree(baseRepoRoot, location.taskPath, { force: true });

  const branchResult = deleteLocalBranch(baseRepoRoot, branchName);
  if (!branchResult.deleted && branchResult.message && branchResult.message !== "branch not found") {
    console.log(pc.yellow(`Worktree removed but branch '${branchName}' was kept: ${branchResult.message}`));
  }
  forgetTask(taskIdentity(config, location.base, location.taskName).key);
}

export async function confirmAndRemoveTask(configDir: string, config: LaneConfig, location: TaskLocation): Promise<void> {
  const baseRepoRoot = resolveBaseRepoRoot(configDir, location.base);
  if (!fs.existsSync(location.taskPath)) {
    throw new Error(`Task folder does not exist: ${location.taskPath}`);
  }

  const { label } = taskIdentity(config, location.base, location.taskName);
  await promptForExactConfirmation(`Type 'delete' to permanently remove the task worktree ${label}:`, "delete");
  deleteTask(configDir, config, location, baseRepoRoot);
  console.log(pc.green(`Removed task: ${location.taskPath}`));
}
