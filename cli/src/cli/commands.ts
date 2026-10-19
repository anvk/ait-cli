// The entry point of each `lane` subcommand, called from bin/lane.ts.
import fs from "node:fs";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import pc from "picocolors";
import { pickBranch } from "../ui/branchpicker.js";
import { searchRemoteBranches } from "../branches/branchsearch.js";
import { baseNames, findBase, readConfig, resolveBaseCommands, writeConfig } from "../core/config.js";
import { listPrunableWorktrees, pruneWorktrees } from "../core/git.js";
import { interactiveInit } from "./init.js";
import {
  askToRunSetup,
  checkoutAndOpen,
  confirmAndRemoveTask,
  createTaskFolder,
  deleteTask,
  describeBranchHolders,
  openTask,
  promptForExactConfirmation,
  type ForceOption,
  type OpenOptions
} from "../core/lifecycle.js";
import { pickTask, type PickerItem } from "../ui/picker.js";
import { ensurePlugins } from "../plugins/ensure.js";
import { findLeftovers } from "../plugins/registry.js";
import { loadCommandsFromSource } from "../hooks/source.js";
import { COMMAND_LISTS } from "../plugins/types.js";
import {
  gatherTaskDisplayItems,
  isOlderThan,
  noTasksHint,
  printRichTaskList,
  splitTasksByAge,
  type TaskDisplayItem
} from "../ui/tasklist.js";
import type { BaseConfig } from "../core/types.js";
import { errorMessage } from "../core/util.js";
import {
  exportLaneRepoCommand,
  knownTaskKeys,
  loadWorkspace,
  locateInBase,
  locateTask,
  requireBase,
  resolveBaseRepoRoot
} from "../core/workspace.js";

export type { ForceOption, OpenOptions };

export interface BaseOption {
  base?: string;
}

export async function runInitCommand(repoOption?: string): Promise<void> {
  const targetDir = path.resolve(repoOption || process.cwd());
  const configPath = await interactiveInit(targetDir);
  console.log(pc.green(`Created config: ${configPath}`));
  const configDir = path.dirname(configPath);
  for (const base of readConfig(configDir).bases) {
    warnIfBaseFolderIsNotARepo(configDir, base);
  }
  console.log("");
  console.log("To run lane from any directory, run:");
  console.log(pc.cyan(`  ${exportLaneRepoCommand(configDir)}`));
}

// Init records the base folder without requiring it to exist yet, so a user who typed a
// name (or made an empty folder) only finds out on the first real command otherwise.
function warnIfBaseFolderIsNotARepo(configDir: string, base: BaseConfig): void {
  try {
    resolveBaseRepoRoot(configDir, base);
  } catch (error) {
    console.log("");
    console.log(pc.yellow(errorMessage(error)));
    console.log(
      pc.yellow(
        `'${base.folder}' must be a git clone of your project. Every task is a worktree of that repository. ` +
          `Clone it there (for example 'gh repo clone <owner>/<repo> ${base.folder}') before running lane.`
      )
    );
  }
}

export async function runCreateCommand(
  taskId: string,
  options: OpenOptions & BaseOption & ForceOption & { open: boolean },
  repoOption?: string
): Promise<void> {
  const { configDir, config } = loadWorkspace(repoOption);
  await ensurePlugins(config);
  const location = locateTask(configDir, config, taskId, requireBase(config, options.base).name);
  if (location.exists) {
    throw new Error(`Task folder already exists: ${location.taskPath}\nUse \`lane open ${taskId}\` instead.`);
  }

  createTaskFolder(configDir, config, location, options);
  if (options.open) {
    openTask(configDir, config, location, { ...options, created: true, runSetup: await askToRunSetup(config, location.base) });
  }
}

export async function runTaskCommand(
  taskId: string,
  options: OpenOptions & BaseOption & ForceOption,
  repoOption?: string
): Promise<void> {
  const { configDir, config } = loadWorkspace(repoOption);
  await ensurePlugins(config);
  const location = locateTask(configDir, config, taskId, options.base);

  const created = !location.exists;
  let runSetup = false;
  if (created) {
    createTaskFolder(configDir, config, location, options);
    runSetup = await askToRunSetup(config, location.base);
  }
  openTask(configDir, config, location, { ...options, created, runSetup });
}

export async function runCheckoutCommand(
  branchName: string,
  options: OpenOptions & BaseOption & ForceOption,
  repoOption?: string
): Promise<void> {
  const { configDir, config } = loadWorkspace(repoOption);
  await ensurePlugins(config);
  const base = requireBase(config, options.base);
  await checkoutAndOpen(configDir, config, base, branchName.trim().replace(/^origin\//, ""), options);
}

export async function runOpenCommand(taskId: string, options: BaseOption, repoOption?: string): Promise<void> {
  const { configDir, config } = loadWorkspace(repoOption);
  await ensurePlugins(config);
  const location = locateTask(configDir, config, taskId, options.base);
  if (!location.exists) {
    throw new Error(`Task folder does not exist: ${location.taskPath}`);
  }
  openTask(configDir, config, location, {});
}

export async function runRemoveCommand(taskId: string, options: BaseOption, repoOption?: string): Promise<void> {
  const { configDir, config } = loadWorkspace(repoOption);
  await ensurePlugins(config);
  await confirmAndRemoveTask(configDir, config, locateTask(configDir, config, taskId, options.base));
}

export async function runListCommand(repoOption?: string): Promise<void> {
  const { configDir, config } = loadWorkspace(repoOption);
  await printRichTaskList(configDir, config);
}

export async function runTasksCommand(
  options: OpenOptions & BaseOption & ForceOption,
  repoOption?: string
): Promise<void> {
  const { configDir, config } = loadWorkspace(repoOption);
  await ensurePlugins(config);
  // Fail on a typo up front rather than after the picker has been drawn.
  const initialBase = options.base ? findBase(config, options.base).name : undefined;

  // The picker needs a terminal on both ends: `lane tasks | cat` and `lane tasks > file`
  // fall back to the same static report as `lane list`.
  if (!input.isTTY || !output.isTTY) {
    await printRichTaskList(configDir, config);
    return;
  }

  // Kept across loops while nothing changed: coming back from the branch search reuses
  // it, and only a removal throws it away.
  let taskItems: TaskDisplayItem[] | null = null;
  while (true) {
    // Gathering walks every task folder's mtimes and runs `git log` per task, which
    // is a visible pause with many tasks. The line is erased before the first frame
    // so the picker's redraw math does not count it.
    if (!taskItems) {
      output.write(pc.dim("Loading tasks…"));
      taskItems = await gatherTaskDisplayItems(configDir, config);
      output.write("\x1b[2K\r");
    }

    const { recent, old } = splitTasksByAge(taskItems, config.oldTaskDays);
    const items: PickerItem[] = [
      ...recent.map((item) => ({ ...item, isOld: false })),
      ...old.map((item) => ({ ...item, isOld: true }))
    ];

    const result = await pickTask({
      items,
      taskPrefix: config.taskPrefix,
      oldTaskDays: config.oldTaskDays,
      emptyHint: noTasksHint(configDir, config),
      bases: baseNames(config),
      initialBase
    });

    switch (result.kind) {
      case "cancel":
        return;
      case "open":
        openTask(configDir, config, locateInBase(configDir, findBase(config, result.item.baseName), result.item.taskName), options);
        return;
      case "create":
        await runTaskCommand(result.taskId, { ...options, base: result.baseName }, repoOption);
        return;
      case "checkout": {
        const branch = await pickBranch({
          search: (baseName, query) => {
            const base = findBase(config, baseName);
            const baseRepoRoot = resolveBaseRepoRoot(configDir, base);
            const holders = describeBranchHolders(configDir, config, base, baseRepoRoot);
            const { branches, total } = searchRemoteBranches(baseRepoRoot, query);
            const items = branches.map((remote) => {
              const holder = holders.get(remote.name);
              const note = holder ? (holder.taskName ? `task ${holder.taskName}` : `checked out in ${holder.folder}`) : null;
              return { ...remote, note };
            });
            return { items, total };
          },
          bases: baseNames(config),
          initialBase: result.baseName,
          initialQuery: result.query
        });
        if (branch.kind === "cancel") {
          return;
        }
        if (branch.kind === "select") {
          await checkoutAndOpen(configDir, config, findBase(config, branch.baseName), branch.branch, options);
          return;
        }
        break;
      }
      case "remove":
        // A mistyped confirmation (or a failed removal) reports and returns to the
        // picker rather than ending the session the way a bare `lane remove` does.
        try {
          await confirmAndRemoveTask(
            configDir,
            config,
            locateInBase(configDir, findBase(config, result.item.baseName), result.item.taskName)
          );
        } catch (error) {
          console.log(pc.red(errorMessage(error)));
        }
        console.log("");
        taskItems = null;
        break;
    }
  }
}

export async function runPurgeCommand(options: { days?: string }, repoOption?: string): Promise<void> {
  const { configDir, config } = loadWorkspace(repoOption);
  await ensurePlugins(config);
  const days = options.days ? Number.parseInt(options.days, 10) : config.oldTaskDays;
  if (!Number.isFinite(days) || days < 1) {
    throw new Error("`--days` must be a positive integer.");
  }

  // Every base repo is resolved before anything is listed, so a broken base fails
  // the command instead of failing halfway through the removals.
  const baseRepoRoots = new Map(config.bases.map((base) => [base.name, resolveBaseRepoRoot(configDir, base)]));
  const taskItems = await gatherTaskDisplayItems(configDir, config);
  if (taskItems.length === 0) {
    console.log(pc.yellow("No task folders found."));
    return;
  }

  const now = Date.now();
  const purgeCandidates = taskItems.filter((item) => isOlderThan(item, days, now));
  if (purgeCandidates.length === 0) {
    console.log(pc.yellow(`No tasks older than ${days} day(s) were found.`));
    return;
  }

  const showBase = config.bases.length > 1;
  console.log(pc.yellow(`Tasks to purge (older than ${days} day(s)):`));
  for (const candidate of purgeCandidates) {
    const baseTag = showBase ? ` [${candidate.baseName}]` : "";
    console.log(`- ${candidate.taskName}${baseTag} (last update: ${new Date(candidate.lastUpdatedMs).toISOString()})`);
  }

  const confirmationToken = `PURGE ${purgeCandidates.length}`;
  await promptForExactConfirmation(
    `Type '${confirmationToken}' to permanently purge these ${purgeCandidates.length} task(s):`,
    confirmationToken
  );

  let removedCount = 0;
  const failures: string[] = [];
  for (const candidate of purgeCandidates) {
    const base = findBase(config, candidate.baseName);
    try {
      deleteTask(configDir, config, locateInBase(configDir, base, candidate.taskName), baseRepoRoots.get(base.name)!);
      removedCount += 1;
    } catch (error) {
      failures.push(`${candidate.taskName}: ${errorMessage(error)}`);
    }
  }

  console.log(pc.green(`Purged ${removedCount} task(s).`));
  if (failures.length > 0) {
    console.log(pc.red(`Failed to purge ${failures.length} task(s):`));
    for (const failure of failures) {
      console.log(`- ${failure}`);
    }
    process.exitCode = 1;
  }
}

export function runPruneCommand(repoOption?: string): void {
  const { configDir, config } = loadWorkspace(repoOption);
  const prunable = config.bases.map((base) => {
    const repoRoot = resolveBaseRepoRoot(configDir, base);
    return { base, repoRoot, worktrees: listPrunableWorktrees(repoRoot) };
  });
  const leftovers = findLeftovers(knownTaskKeys(configDir, config));
  const prunableCount = prunable.reduce((sum, entry) => sum + entry.worktrees.length, 0);
  if (leftovers.length === 0 && prunableCount === 0) {
    console.log(pc.green("Nothing to prune: every leftover file and git worktree belongs to an existing task."));
    return;
  }

  for (const leftover of leftovers) {
    for (const file of leftover.files) {
      fs.rmSync(file, { force: true });
    }
    console.log(`${pc.yellow("removed")} ${leftover.files.length} file(s) left behind by ${leftover.key}`);
  }
  for (const entry of prunable) {
    if (entry.worktrees.length === 0) {
      continue;
    }
    pruneWorktrees(entry.repoRoot);
    for (const worktreePath of entry.worktrees) {
      console.log(`${pc.yellow("pruned")} stale git worktree ${worktreePath} (base ${entry.base.name})`);
    }
  }

  const fileCount = leftovers.reduce((sum, leftover) => sum + leftover.files.length, 0);
  console.log(pc.green(`Pruned ${fileCount} leftover file(s) and ${prunableCount} git worktree(s).`));
}

// Re-fetches every base's command lists from its recorded source and rewrites the config
// only when something changed, so a team-hosted document can be rolled out without
// re-running init. Lists the document does not mention are left as they are.
export async function runCommandsUpdateCommand(options: BaseOption, repoOption?: string): Promise<void> {
  const { configDir, config } = loadWorkspace(repoOption);
  const targets = options.base ? [findBase(config, options.base)] : config.bases;

  let changed = false;
  let failures = 0;
  for (const base of targets) {
    if (!base.template) {
      console.log(`${pc.dim("skipped")} ${base.name}: no template recorded`);
      continue;
    }
    let lists;
    try {
      lists = await loadCommandsFromSource(base.template, configDir);
    } catch (error) {
      failures += 1;
      console.log(`${pc.red("failed")} ${base.name}: ${errorMessage(error)}`);
      continue;
    }
    const before = resolveBaseCommands(config, base);
    const after = { ...before, ...lists };
    if (JSON.stringify(before) === JSON.stringify(after)) {
      console.log(`${pc.green("unchanged")} ${base.name}: ${before.open.length} open command(s)`);
      continue;
    }
    for (const list of COMMAND_LISTS) {
      if (lists[list]) {
        base[list] = lists[list];
      }
    }
    if (lists.plugins) {
      config.plugins = { ...config.plugins, ...lists.plugins };
    }
    changed = true;
    const counts = COMMAND_LISTS.map((list) => `${list} ${before[list].length} → ${after[list].length}`).join(", ");
    console.log(`${pc.yellow("updated")} ${base.name}: ${counts}`);
  }

  if (changed) {
    console.log(pc.green(`Wrote ${writeConfig(configDir, config)}`));
    await ensurePlugins(config);
  }
  if (failures > 0) {
    process.exitCode = 1;
  }
}
