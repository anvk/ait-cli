// Creating, checking out, opening and deleting a single lane.
import path from "node:path";
import pc from "picocolors";
import { resolveBaseCommands, resolveBranchPrefix } from "./config.js";
import {
  addBranchWorktree,
  createOrAttachWorktree,
  currentBranch,
  deleteLocalBranch,
  fastForwardTo,
  fetchRefFromOrigin,
  fetchRemoteBranch,
  hasOrigin,
  inspectBaseWorkingState,
  isBaseWorkingStateClean,
  listWorktreeBranches,
  localBranchExists,
  refResolves,
  removeWorktree
} from "./git.js";
import { ensureLanesDir, lanesInWorkspace, syncBaseFolderIntoLane, toLaneName } from "./lanes.js";
import type { BaseConfig, LanesConfig } from "./types.js";
import { realpathOrSelf } from "./util.js";
import { closeCurrentTab, forgetLane } from "../plugins/registry.js";
import { runList } from "../hooks/run.js";
import type { LaneContext } from "../plugins/types.js";
import { locateInBase, resolveBaseRepoRoot, laneIdentity, type LaneLocation } from "./workspace.js";

export interface OpenOptions {
  closeCurrentTab?: boolean;
}

// Create the lane even though the base still holds work of its own.
export interface ForceOption {
  force?: boolean;
}

// The lane as the command lines see it.
function laneContext(configDir: string, config: LanesConfig, location: LaneLocation, created: boolean): LaneContext {
  const { key, label } = laneIdentity(config, location.base, location.laneName);
  return {
    laneName: location.laneName,
    lanePath: location.lanePath,
    key,
    label,
    branch: laneBranch(config, location),
    base: location.base.name,
    root: configDir,
    created
  };
}

// Runs the base's `open` list for the lane; right after creating it, and when the setup
// prompt was accepted, the `create` list runs first so what it sets up is there when the
// open commands start.
export function openLane(
  configDir: string,
  config: LanesConfig,
  location: LaneLocation,
  options: OpenOptions & { created?: boolean; runSetup?: boolean }
): void {
  const commands = resolveBaseCommands(config, location.base);
  const ctx = laneContext(configDir, config, location, Boolean(options.created));
  if (options.runSetup) {
    runList(ctx, commands.create, { announce: true });
  }
  runList(ctx, commands.open, { after: true, runSetup: options.runSetup });
  if (options.closeCurrentTab && !closeCurrentTab()) {
    console.log(pc.yellow("Not running inside a terminal lanes can close; leaving the current tab open."));
  }
}

// The branch lanes creates for a new lane.
function laneBranchName(config: LanesConfig, base: BaseConfig, laneName: string): string {
  return `${resolveBranchPrefix(config, base)}${laneName}`;
}

// Long file lists in the not-clean report are cut off; the point is to name the base,
// not to reprint `git status`.
export const MAX_LISTED_DIRTY_ITEMS = 10;

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

// A lane branches from `base.ref` and then has the base's ignored content copied over
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
      `Base '${base.name}' (${base.folder}) is not clean, so no lane was created.`,
      ...describeDirtyItems("staged, uncommitted", state.staged),
      ...describeDirtyItems("modified, uncommitted", state.unstaged),
      ...describeDirtyItems(`commits not on ${base.ref}`, state.localCommits),
      "",
      `Commit, stash or push this work in ${base.folder}, then run the command again.`,
      "Pass --force to create the lane from the base anyway."
    ].join("\n")
  );
}

// A ref that does not resolve would otherwise surface as a bare git error halfway
// through creation. The usual causes: a local-only repository (no `origin`), or a
// default branch other than `main`; either way the fix is the base's `ref`.
function assertBaseRefExists(base: BaseConfig, baseRepoRoot: string): void {
  if (refResolves(baseRepoRoot, base.ref)) {
    return;
  }
  throw new Error(
    [
      `Base '${base.name}' branches from '${base.ref}', which does not exist in ${base.folder}.`,
      `Set "ref" for this base in .lanes.json to a branch it has ('git -C ${base.folder} branch -a' lists them).`,
      base.ref.startsWith("origin/") && !hasOrigin(baseRepoRoot)
        ? `Or add the remote it expects: git -C ${base.folder} remote add origin <url>`
        : ""
    ]
      .filter(Boolean)
      .join("\n")
  );
}

// The last step of making a lane: bring over what the new worktree lacks from the base.
function copyBaseIntoLane(configDir: string, location: LaneLocation): void {
  const { base, laneName, lanePath } = location;
  console.log(pc.cyan(`Copying ${base.folder} into ${laneName}...`));
  const sync = syncBaseFolderIntoLane(path.resolve(configDir, base.folder), lanePath);
  console.log(pc.dim(`  ${sync.entries} path(s) ${sync.strategy === "clone" ? "cloned" : "copied"}`));
  if (sync.left > 0) {
    console.log(pc.dim(`  ${sync.left} untracked path(s) left in ${base.folder}, not copied`));
  }
  console.log(pc.green(`Created: ${lanePath}`));
}

export function createLaneFolder(
  configDir: string,
  config: LanesConfig,
  location: LaneLocation,
  options: ForceOption = {}
): void {
  const { base, laneName, lanePath } = location;
  const baseRepoRoot = resolveBaseRepoRoot(configDir, base);

  if (!hasOrigin(baseRepoRoot)) {
    console.log(pc.dim(`${base.folder} has no 'origin' remote, so nothing is fetched.`));
  } else if (/^origin\//.test(base.ref)) {
    console.log(pc.cyan(`Fetching ${base.ref} in ${base.folder}...`));
    fetchRefFromOrigin(baseRepoRoot, base.ref);
  }
  assertBaseRefExists(base, baseRepoRoot);
  // Checked after the fetch, so `base.ref` is current.
  assertBaseIsClean(base, baseRepoRoot, options);

  ensureLanesDir(configDir, base.lanesDir);
  // The base is brought up to `ref` so the dependencies copied from it match the new lane.
  console.log(pc.cyan(`Updating ${base.folder} to ${base.ref}...`));
  if (!fastForwardTo(baseRepoRoot, base.ref)) {
    console.log(pc.yellow(`${base.folder} could not fast-forward to ${base.ref} (it has work of its own); left as it is.`));
  }
  console.log(pc.cyan(`Creating ${laneName} from ${base.ref}...`));
  createOrAttachWorktree({
    repoRoot: baseRepoRoot,
    lanePath,
    branchName: laneBranchName(config, base, laneName),
    baseRef: base.ref
  });
  copyBaseIntoLane(configDir, location);
}

// Lane names a branch may take, preferred first. A branch lanes made itself
// (`<branchPrefix><laneName>`) maps back to that same lane name. Any other branch is
// named after its last `/` part (`someone/ABC-558-fix` → `ABC-558-fix`), then after the
// whole branch should that name be taken (`ABC-someone-ABC-558-fix`). Characters a folder
// name should not carry become `-`. The name always starts with the lane prefix exactly,
// since the lane list matches it case-sensitively: a prefix in another case is respelled
// (`abc-701` → `ABC-701`), and a missing one is added.
export function laneNamesForBranch(config: LanesConfig, base: BaseConfig, branchName: string): string[] {
  const toName = (raw: string): string => {
    const clean = raw.replace(/[^A-Za-z0-9._-]+/g, "-");
    return clean.toLowerCase().startsWith(config.lanePrefix.toLowerCase())
      ? `${config.lanePrefix}${clean.slice(config.lanePrefix.length)}`
      : toLaneName(config.lanePrefix, clean);
  };
  const branchPrefix = resolveBranchPrefix(config, base);
  if (branchPrefix && branchName.startsWith(branchPrefix)) {
    return [toName(branchName.slice(branchPrefix.length))];
  }
  const lastPart = branchName.slice(branchName.lastIndexOf("/") + 1);
  return [...new Set([toName(lastPart), toName(branchName)])];
}

export interface BranchHolder {
  // The lane holding the branch, when the worktree is one of this base's lane folders.
  laneName: string | null;
  // Its folder, relative to the workspace.
  folder: string;
}

// Every worktree of a base that has a branch checked out, keyed by branch.
export function describeBranchHolders(
  configDir: string,
  config: LanesConfig,
  base: BaseConfig,
  baseRepoRoot: string
): Map<string, BranchHolder> {
  const laneNamesByPath = new Map(
    lanesInWorkspace(configDir, config)
      .filter((lane) => lane.baseName === base.name)
      .map((lane) => [realpathOrSelf(lane.lanePath), lane.laneName])
  );
  const holders = new Map<string, BranchHolder>();
  for (const [branchName, worktreePath] of listWorktreeBranches(baseRepoRoot)) {
    const realPath = realpathOrSelf(worktreePath);
    holders.set(branchName, {
      laneName: laneNamesByPath.get(realPath) ?? null,
      folder: path.relative(configDir, realPath) || "."
    });
  }
  return holders;
}

// Makes a lane of an existing branch, or finds the lane that already has it. Only that
// one branch is fetched, and only when a lane is about to be made of it.
export function checkoutBranchLane(
  configDir: string,
  config: LanesConfig,
  base: BaseConfig,
  branchName: string,
  options: ForceOption = {}
): { location: LaneLocation; created: boolean } {
  const baseRepoRoot = resolveBaseRepoRoot(configDir, base);

  // Git keeps a branch in one worktree at a time: an existing lane is simply opened,
  // anything else (the base clone itself, a worktree made by hand) has to let go first.
  const holder = describeBranchHolders(configDir, config, base, baseRepoRoot).get(branchName);
  if (holder?.laneName) {
    return { location: locateInBase(configDir, base, holder.laneName), created: false };
  }
  if (holder) {
    throw new Error(
      `Branch '${branchName}' is already checked out in ${holder.folder}. Switch that checkout to another branch, then run this again.`
    );
  }

  if (hasOrigin(baseRepoRoot)) {
    console.log(pc.cyan(`Fetching ${branchName} from origin...`));
    if (!fetchRemoteBranch(baseRepoRoot, branchName) && !localBranchExists(baseRepoRoot, branchName)) {
      throw new Error(`Branch '${branchName}' exists neither locally nor on origin.`);
    }
  } else if (!localBranchExists(baseRepoRoot, branchName)) {
    throw new Error(`Branch '${branchName}' does not exist in ${base.folder}, which has no 'origin' remote to fetch it from.`);
  }

  // A folder by that name is some other branch's lane (this branch's was found above).
  const candidates = laneNamesForBranch(config, base, branchName).map((laneName) =>
    locateInBase(configDir, base, laneName)
  );
  const location = candidates.find((candidate) => !candidate.exists);
  if (!location) {
    const taken = candidates.at(-1)!;
    const onBranch = currentBranch(taken.lanePath);
    throw new Error(
      `Lane folder already exists: ${taken.lanePath}${onBranch ? ` (on branch '${onBranch}')` : ""}\nRemove it or check that branch out there by hand.`
    );
  }

  assertBaseIsClean(base, baseRepoRoot, options);

  ensureLanesDir(configDir, base.lanesDir);
  console.log(pc.cyan(`Checking out ${branchName} as ${location.laneName}...`));
  const { behind } = addBranchWorktree(baseRepoRoot, location.lanePath, branchName);
  if (behind > 0) {
    console.log(
      pc.yellow(`Local branch '${branchName}' is ${behind} commit(s) behind origin; run 'git pull' in the lane to catch up.`)
    );
  }
  copyBaseIntoLane(configDir, location);
  return { location: { ...location, exists: true }, created: true };
}

// The branch a lane is on, read from its worktree rather than rebuilt from its name, so
// a lane checked out from someone else's branch still removes the right one. A lane left
// detached falls back to the branch lanes would have created for it.
function laneBranch(config: LanesConfig, location: LaneLocation): string {
  return currentBranch(location.lanePath) ?? laneBranchName(config, location.base, location.laneName);
}

// Runs the base's `remove` list (a failure there, Docker not running say, must not keep
// the lane from being removed), then removes the worktree (discarding uncommitted
// changes), its branch when git considers it merged, and whatever plugin commands
// left behind for it.
export function deleteLane(configDir: string, config: LanesConfig, location: LaneLocation, baseRepoRoot: string): void {
  // Read before the worktree goes, since the branch is only known from inside it.
  const branchName = laneBranch(config, location);
  runList(laneContext(configDir, config, location, false), resolveBaseCommands(config, location.base).remove, {
    announce: true,
    failureNote: "continuing with removal"
  });
  removeWorktree(baseRepoRoot, location.lanePath, { force: true });

  const branchResult = deleteLocalBranch(baseRepoRoot, branchName);
  if (!branchResult.deleted && branchResult.message && branchResult.message !== "branch not found") {
    console.log(pc.yellow(`Worktree removed but branch '${branchName}' was kept: ${branchResult.message}`));
  }
  forgetLane(laneIdentity(config, location.base, location.laneName).key);
}

