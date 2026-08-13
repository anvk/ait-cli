import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import pc from "picocolors";
import { getRepoRoot, readConfig } from "./config.js";
import { interactiveInit } from "./init.js";
import {
  closeCurrentWarpTab,
  getTabConfigsDir,
  isWarpInstalled,
  openTaskInWarp,
  removeTabConfigs
} from "./warp.js";
import {
  createOrAttachWorktree,
  deleteLocalBranch,
  fetchOrigin,
  rebaseCurrentBranchOnto,
  removeWorktree
} from "./git.js";
import { commandExists, run } from "./process.js";
import {
  ensureTasksDir,
  getTaskPath,
  listTaskFolders,
  resolveTasksRoot,
  syncBaseFolderIntoTask,
  toTaskName
} from "./tasks.js";

function findUp(startDir: string, fileName: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, fileName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function resolveConfiguredRepoRoot(repoOption?: string): string {
  const startDir = repoOption ? path.resolve(repoOption) : process.cwd();
  const configPath = findUp(startDir, ".ait.json");
  if (configPath) {
    return fs.realpathSync.native(path.dirname(configPath));
  }

  // Only consulted outside a configured workspace, so an exported AIT_REPO cannot
  // hijack commands run inside a different one.
  const fallbackRepo = repoOption ? undefined : process.env.AIT_REPO?.trim();
  if (fallbackRepo) {
    const fallbackConfigPath = findUp(path.resolve(fallbackRepo), ".ait.json");
    if (!fallbackConfigPath) {
      throw new Error(
        `AIT_REPO does not point at a configured workspace: ${fallbackRepo}\nMissing .ait.json. Run \`ait init\` there.`
      );
    }
    return fs.realpathSync.native(path.dirname(fallbackConfigPath));
  }

  throw new Error(
    `Directory is not configured for AIT tasks: ${startDir}\nMissing .ait.json. Run \`ait init\` in your repository root, or set AIT_REPO to a configured workspace.`
  );
}

function resolveBaseRepoRoot(configDir: string, baseFolder: string): string {
  const baseFolderPath = path.resolve(configDir, baseFolder);

  if (!fs.existsSync(baseFolderPath) || !fs.statSync(baseFolderPath).isDirectory()) {
    throw new Error(`Configured baseFolder does not exist: ${baseFolderPath}`);
  }

  let repoRoot: string;
  try {
    repoRoot = getRepoRoot(baseFolderPath);
  } catch {
    throw new Error(`Configured baseFolder is not inside a git repository: ${baseFolderPath}`);
  }

  return fs.realpathSync.native(repoRoot);
}

async function promptForExactConfirmation(prompt: string, expected: string): Promise<void> {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = (await rl.question(`${prompt}\n> `)).trim();
    if (answer !== expected) {
      throw new Error("Confirmation text did not match. Aborting.");
    }
  } finally {
    rl.close();
  }
}

function maybeDeleteTaskBranch(baseRepoRoot: string, branchName: string): void {
  const branchResult = deleteLocalBranch(baseRepoRoot, branchName);
  if (!branchResult.deleted && branchResult.message && branchResult.message !== "branch not found") {
    console.log(
      pc.yellow(
        `Worktree removed but branch '${branchName}' was kept: ${branchResult.message}`
      )
    );
  }
}

interface TaskDisplayItem {
  taskName: string;
  taskPath: string;
  lastUpdatedMs: number;
  lastCommitSubject: string | null;
}

function formatRelativeTime(fromMs: number, nowMs = Date.now()): string {
  const diffMs = Math.max(0, nowMs - fromMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) {
    return "just now";
  }
  if (diffMs < hour) {
    const minutes = Math.floor(diffMs / minute);
    return `${minutes}m ago`;
  }
  if (diffMs < day) {
    const hours = Math.floor(diffMs / hour);
    return `${hours}h ago`;
  }
  const days = Math.floor(diffMs / day);
  return `${days}d ago`;
}

function getLastCommitMeta(taskPath: string): { subject: string | null; committedAtMs: number } | null {
  try {
    const result = run("git", ["log", "-1", "--pretty=%ct%x09%s"], { cwd: taskPath });
    const output = result.stdout.trim();
    if (!output) {
      return null;
    }

    const [unixSecondsRaw, ...subjectParts] = output.split("\t");
    const unixSeconds = Number.parseInt(unixSecondsRaw, 10);
    if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) {
      return null;
    }

    const subject = subjectParts.join("\t").trim() || null;
    return { subject, committedAtMs: unixSeconds * 1000 };
  } catch {
    return null;
  }
}

function gatherTaskDisplayItems(configDir: string, tasksDir: string, taskPrefix: string): TaskDisplayItem[] {
  const taskNames = listTaskFolders(configDir, tasksDir, taskPrefix);
  return taskNames
    .map((taskName) => {
      const taskPath = getTaskPath(configDir, tasksDir, taskName);
      const commitMeta = getLastCommitMeta(taskPath);
      const lastUpdatedMs = commitMeta ? commitMeta.committedAtMs : fs.statSync(taskPath).mtimeMs;
      return {
        taskName,
        taskPath,
        lastUpdatedMs,
        lastCommitSubject: commitMeta ? commitMeta.subject : null
      };
    })
    .sort((a, b) => b.lastUpdatedMs - a.lastUpdatedMs);
}

function printTaskSection(title: string, items: TaskDisplayItem[], options: { old: boolean }): void {
  if (items.length === 0) {
    return;
  }

  const sectionColor = options.old ? pc.red : pc.cyan;
  console.log(sectionColor(`-- ${title} --`));

  const rows = items.map((item) => ({
    item,
    relativeLabel: formatRelativeTime(item.lastUpdatedMs)
  }));
  const nameWidth = Math.max(...rows.map((row) => row.item.taskName.length));
  const relativeWidth = Math.max(...rows.map((row) => row.relativeLabel.length));

  for (const row of rows) {
    const { item, relativeLabel } = row;
    const icon = options.old ? "☠" : "*";
    const nameText = item.taskName.padEnd(nameWidth + 2);
    const relativeText = relativeLabel.padEnd(relativeWidth + 2);
    const name = options.old ? pc.red(nameText) : pc.green(nameText);
    const relative = options.old ? pc.red(relativeText) : pc.yellow(relativeText);
    const commit = item.lastCommitSubject
      ? options.old
        ? pc.red(item.lastCommitSubject)
        : pc.white(item.lastCommitSubject)
      : pc.dim("no commits yet");

    console.log(`${icon} ${name}\t${relative}\t${commit}`);
  }
  console.log("");
}

function printRichTaskList(
  configDir: string,
  tasksDir: string,
  taskPrefix: string,
  oldTaskDays: number
): void {
  const tasksRoot = resolveTasksRoot(configDir, tasksDir);
  const taskItems = gatherTaskDisplayItems(configDir, tasksDir, taskPrefix);
  if (taskItems.length === 0) {
    if (fs.existsSync(tasksRoot)) {
      console.log(pc.yellow(`No task folders found in '${tasksDir}' (directory is empty).`));
    } else {
      console.log(
        pc.yellow(
          `No task folders found. '${tasksDir}' does not exist yet; it will be created when you run 'ait create <taskId>'.`
        )
      );
    }
    return;
  }

  const now = Date.now();
  const oldThresholdMs = oldTaskDays * 24 * 60 * 60 * 1000;
  const recentTasks = taskItems.filter((item) => now - item.lastUpdatedMs < oldThresholdMs);
  const oldTasks = taskItems.filter((item) => now - item.lastUpdatedMs >= oldThresholdMs);

  printTaskSection("recent", recentTasks, { old: false });
  printTaskSection(`old (${oldTaskDays}+ days)`, oldTasks, { old: true });
}

export async function runInitCommand(repoOption?: string): Promise<void> {
  const targetDir = path.resolve(repoOption || process.cwd());
  const configPath = await interactiveInit(targetDir);
  console.log(pc.green(`Created config: ${configPath}`));
  console.log("");
  console.log("To run ait from any directory, run:");
  console.log(pc.cyan(`  ${exportAitRepoCommand(path.dirname(configPath))}`));
}

// macOS defaults to zsh; bash keeps login shells in .bash_profile.
function shellProfilePath(): string {
  return (process.env.SHELL ?? "").endsWith("/bash") ? "~/.bash_profile" : "~/.zshrc";
}

function exportAitRepoCommand(configDir: string): string {
  return `echo 'export AIT_REPO=${configDir}' >> ${shellProfilePath()}`;
}

export function runCreateCommand(
  taskId: string,
  options: { open: boolean; closeCurrentTab?: boolean; newWindow?: boolean },
  repoOption?: string
): void {
  const configDir = resolveConfiguredRepoRoot(repoOption);
  const config = readConfig(configDir);
  const baseFolderPath = path.resolve(configDir, config.baseFolder);
  const baseRepoRoot = resolveBaseRepoRoot(configDir, config.baseFolder);
  const taskName = toTaskName(config.taskPrefix, taskId);
  const branchName = `${config.branchPrefix}${taskName}`;
  ensureTasksDir(configDir, config.tasksDir);
  const taskPath = getTaskPath(configDir, config.tasksDir, taskName);

  if (fs.existsSync(taskPath)) {
    throw new Error(`Task folder already exists: ${taskPath}\nUse \`ait open ${taskId}\` instead.`);
  }

  console.log(pc.cyan("Fetching origin..."));
  fetchOrigin(baseRepoRoot);
  console.log(pc.cyan(`Rebasing base folder onto ${config.baseRef}...`));
  rebaseCurrentBranchOnto(baseRepoRoot, config.baseRef);
  console.log(pc.cyan(`Creating ${taskName} from ${config.baseRef}...`));
  createOrAttachWorktree({
    repoRoot: baseRepoRoot,
    taskPath,
    branchName,
    baseRef: config.baseRef
  });
  console.log(pc.cyan(`Copying ${config.baseFolder} into ${taskName} (this can take a while)...`));
  syncBaseFolderIntoTask(baseFolderPath, taskPath);
  console.log(pc.green(`Created: ${taskPath}`));

  if (options.open) {
    openTaskInWarp(taskPath, taskName, config.warpTabs, { newWindow: options.newWindow });
    if (options.closeCurrentTab) {
      closeCurrentWarpTab();
    }
  }
}

export function runTaskCommand(
  taskId: string,
  options: { closeCurrentTab?: boolean; newWindow?: boolean },
  repoOption?: string
): void {
  const configDir = resolveConfiguredRepoRoot(repoOption);
  const config = readConfig(configDir);
  const baseFolderPath = path.resolve(configDir, config.baseFolder);
  const baseRepoRoot = resolveBaseRepoRoot(configDir, config.baseFolder);
  const taskName = toTaskName(config.taskPrefix, taskId);
  const branchName = `${config.branchPrefix}${taskName}`;
  ensureTasksDir(configDir, config.tasksDir);
  const taskPath = getTaskPath(configDir, config.tasksDir, taskName);

  if (fs.existsSync(taskPath)) {
    openTaskInWarp(taskPath, taskName, config.warpTabs, { newWindow: options.newWindow });
    if (options.closeCurrentTab) {
      closeCurrentWarpTab();
    }
    return;
  }

  console.log(pc.cyan("Fetching origin..."));
  fetchOrigin(baseRepoRoot);
  console.log(pc.cyan(`Rebasing base folder onto ${config.baseRef}...`));
  rebaseCurrentBranchOnto(baseRepoRoot, config.baseRef);
  console.log(pc.cyan(`Creating ${taskName} from ${config.baseRef}...`));
  createOrAttachWorktree({
    repoRoot: baseRepoRoot,
    taskPath,
    branchName,
    baseRef: config.baseRef
  });
  console.log(pc.cyan(`Copying ${config.baseFolder} into ${taskName} (this can take a while)...`));
  syncBaseFolderIntoTask(baseFolderPath, taskPath);
  console.log(pc.green(`Created: ${taskPath}`));
  openTaskInWarp(taskPath, taskName, config.warpTabs, { newWindow: options.newWindow });
  if (options.closeCurrentTab) {
    closeCurrentWarpTab();
  }
}

export function runOpenCommand(taskId: string, repoOption?: string): void {
  const configDir = resolveConfiguredRepoRoot(repoOption);
  const config = readConfig(configDir);
  const taskName = toTaskName(config.taskPrefix, taskId);
  const taskPath = getTaskPath(configDir, config.tasksDir, taskName);

  if (!fs.existsSync(taskPath)) {
    throw new Error(`Task folder does not exist: ${taskPath}`);
  }

  openTaskInWarp(taskPath, taskName, config.warpTabs);
}

export async function runRemoveCommand(taskId: string, repoOption?: string): Promise<void> {
  const configDir = resolveConfiguredRepoRoot(repoOption);
  const config = readConfig(configDir);
  const baseRepoRoot = resolveBaseRepoRoot(configDir, config.baseFolder);
  const taskName = toTaskName(config.taskPrefix, taskId);
  const taskPath = getTaskPath(configDir, config.tasksDir, taskName);

  if (!fs.existsSync(taskPath)) {
    throw new Error(`Task folder does not exist: ${taskPath}`);
  }

  await promptForExactConfirmation("Type 'delete' to permanently remove this task worktree:", "delete");

  removeWorktree(baseRepoRoot, taskPath, { force: true });
  maybeDeleteTaskBranch(baseRepoRoot, `${config.branchPrefix}${taskName}`);
  removeTabConfigs(taskName);
  console.log(pc.green(`Removed task: ${taskPath}`));
}

export function runListCommand(repoOption?: string): void {
  const configDir = resolveConfiguredRepoRoot(repoOption);
  const config = readConfig(configDir);
  printRichTaskList(configDir, config.tasksDir, config.taskPrefix, config.oldTaskDays);
}

export async function runPurgeCommand(options: { days?: string }, repoOption?: string): Promise<void> {
  const configDir = resolveConfiguredRepoRoot(repoOption);
  const config = readConfig(configDir);
  const days = options.days ? Number.parseInt(options.days, 10) : config.oldTaskDays;
  if (!Number.isFinite(days) || days < 1) {
    throw new Error("`--days` must be a positive integer.");
  }

  const baseRepoRoot = resolveBaseRepoRoot(configDir, config.baseFolder);
  const taskItems = gatherTaskDisplayItems(configDir, config.tasksDir, config.taskPrefix);
  if (taskItems.length === 0) {
    console.log(pc.yellow("No task folders found."));
    return;
  }

  const now = Date.now();
  const thresholdMs = days * 24 * 60 * 60 * 1000;
  const purgeCandidates = taskItems.filter((item) => now - item.lastUpdatedMs >= thresholdMs);

  if (purgeCandidates.length === 0) {
    console.log(pc.yellow(`No tasks older than ${days} day(s) were found.`));
    return;
  }

  console.log(pc.yellow(`Tasks to purge (older than ${days} day(s)):`));
  for (const candidate of purgeCandidates) {
    console.log(`- ${candidate.taskName} (last update: ${new Date(candidate.lastUpdatedMs).toISOString()})`);
  }

  const confirmationToken = `PURGE ${purgeCandidates.length}`;
  await promptForExactConfirmation(
    `Type '${confirmationToken}' to permanently purge these ${purgeCandidates.length} task(s):`,
    confirmationToken
  );

  let removedCount = 0;
  const failures: string[] = [];
  for (const candidate of purgeCandidates) {
    try {
      removeWorktree(baseRepoRoot, candidate.taskPath, { force: true });
      maybeDeleteTaskBranch(baseRepoRoot, `${config.branchPrefix}${candidate.taskName}`);
      removeTabConfigs(candidate.taskName);
      removedCount += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${candidate.taskName}: ${message}`);
    }
  }

  console.log(pc.green(`Purged ${removedCount} task(s).`));
  if (failures.length > 0) {
    console.log(pc.red(`Failed to purge ${failures.length} task(s):`));
    for (const failure of failures) {
      console.log(`- ${failure}`);
    }
    process.exit(1);
  }
}

export function runDiagnosticsCommand(repoOption?: string): void {
  const checks: string[] = [];
  let hasFailures = false;

  function ok(message: string): void {
    checks.push(`${pc.green("OK")} ${message}`);
  }
  function warn(message: string): void {
    checks.push(`${pc.yellow("WARN")} ${message}`);
  }
  function failCheck(message: string): void {
    hasFailures = true;
    checks.push(`${pc.red("FAIL")} ${message}`);
  }

  try {
    const configDir = resolveConfiguredRepoRoot(repoOption);
    ok(`AIT config directory: ${configDir}`);

    const envRepo = process.env.AIT_REPO?.trim();
    if (envRepo) {
      ok(`AIT_REPO is set: ${envRepo}`);
    } else {
      warn(
        `AIT_REPO is not set, so ait only works inside ${configDir} and its subfolders. To fix, run:\n     ${exportAitRepoCommand(configDir)}`
      );
    }

    const config = readConfig(configDir);
    ok("Config loaded from .ait.json");
    ok(`Task prefix: ${config.taskPrefix}`);
    if (config.branchPrefix) {
      ok(`Branch prefix: ${config.branchPrefix}`);
    } else {
      ok("Branch prefix: (none)");
    }
    ok(`Tasks directory: ${config.tasksDir}`);
    ok(`Base git ref: ${config.baseRef}`);
    ok(`Base folder: ${config.baseFolder}`);
    ok(`Old task threshold (days): ${config.oldTaskDays}`);

    const baseFolderPath = path.resolve(configDir, config.baseFolder);
    const baseRepoRoot = resolveBaseRepoRoot(configDir, config.baseFolder);
    ok(`Base folder exists: ${baseFolderPath}`);
    ok(`Base git repository: ${baseRepoRoot}`);

    const tasksRoot = resolveTasksRoot(configDir, config.tasksDir);
    if (fs.existsSync(tasksRoot)) {
      ok(`Tasks root exists: ${tasksRoot}`);
    } else {
      warn(`Tasks root does not exist yet (will be created on demand): ${tasksRoot}`);
    }

    try {
      run("git", ["rev-parse", "--verify", config.baseRef], { cwd: baseRepoRoot });
      ok(`Base ref is resolvable locally: ${config.baseRef}`);
    } catch {
      warn(`Base ref not currently resolvable locally: ${config.baseRef} (try 'git fetch origin')`);
    }

    if (isWarpInstalled()) {
      ok("Warp is installed");
    } else {
      failCheck("Warp is not installed (get it from https://www.warp.dev)");
    }

    const tabConfigsDir = getTabConfigsDir();
    try {
      fs.mkdirSync(tabConfigsDir, { recursive: true });
      fs.accessSync(tabConfigsDir, fs.constants.W_OK);
      ok(`Warp tab configs directory is writable: ${tabConfigsDir}`);
    } catch {
      failCheck(`Warp tab configs directory is not writable: ${tabConfigsDir}`);
    }

    for (const tab of config.warpTabs) {
      const colorLabel = tab.color ?? "no color";
      const pathLabel = tab.path === "." ? "<task>" : `<task>/${tab.path}`;
      ok(`Warp tab '${tab.title}' -> ${pathLabel} (${colorLabel})`);
      if (tab.command && !commandExists(tab.command)) {
        warn(`Warp tab '${tab.title}' runs '${tab.command}', which is missing from PATH`);
      }
    }
  } catch (error) {
    failCheck(error instanceof Error ? error.message : String(error));
  }

  for (const line of checks) {
    console.log(line);
  }
  if (hasFailures) {
    process.exit(1);
  }
  console.log("");
  console.log(`${pc.green("🚀✨")} ${pc.green("You are all setup and ready to go.")}`);
}
