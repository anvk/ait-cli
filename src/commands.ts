import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import pc from "picocolors";
import { getRepoRoot, readConfig } from "./config.js";
import { interactiveInit } from "./init.js";
import { openInCursor } from "./editor.js";
import {
  createOrAttachWorktree,
  deleteLocalBranch,
  fetchOrigin,
  removeWorktree
} from "./git.js";
import { commandExists, run } from "./process.js";
import {
  ensureTasksDir,
  getTaskLastUpdatedMs,
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
  if (!configPath) {
    throw new Error(
      `Directory is not configured for AIT tasks: ${startDir}\nMissing .ait.json. Run \`ait init\` in your repository root.`
    );
  }

  const configDir = path.dirname(configPath);
  return fs.realpathSync.native(configDir);
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

function getLastCommitSubject(taskPath: string): string | null {
  try {
    const result = run("git", ["log", "-1", "--pretty=%s"], { cwd: taskPath });
    return result.stdout || null;
  } catch {
    return null;
  }
}

function gatherTaskDisplayItems(configDir: string, tasksDir: string, taskPrefix: string): TaskDisplayItem[] {
  const taskNames = listTaskFolders(configDir, tasksDir, taskPrefix);
  return taskNames
    .map((taskName) => {
      const taskPath = getTaskPath(configDir, tasksDir, taskName);
      const lastUpdatedMs = getTaskLastUpdatedMs(taskPath);
      return {
        taskName,
        taskPath,
        lastUpdatedMs,
        lastCommitSubject: getLastCommitSubject(taskPath)
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
}

export function runCreateCommand(taskId: string, options: { open: boolean }, repoOption?: string): void {
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
  console.log(pc.cyan(`Creating ${taskName} from ${config.baseRef}...`));
  createOrAttachWorktree({
    repoRoot: baseRepoRoot,
    taskPath,
    branchName,
    baseRef: config.baseRef
  });
  syncBaseFolderIntoTask(baseFolderPath, taskPath);
  console.log(pc.green(`Created: ${taskPath}`));

  if (options.open) {
    openInCursor(taskPath);
  }
}

export function runTaskCommand(taskId: string, repoOption?: string): void {
  const configDir = resolveConfiguredRepoRoot(repoOption);
  const config = readConfig(configDir);
  const baseFolderPath = path.resolve(configDir, config.baseFolder);
  const baseRepoRoot = resolveBaseRepoRoot(configDir, config.baseFolder);
  const taskName = toTaskName(config.taskPrefix, taskId);
  const branchName = `${config.branchPrefix}${taskName}`;
  ensureTasksDir(configDir, config.tasksDir);
  const taskPath = getTaskPath(configDir, config.tasksDir, taskName);

  if (fs.existsSync(taskPath)) {
    openInCursor(taskPath);
    return;
  }

  console.log(pc.cyan("Fetching origin..."));
  fetchOrigin(baseRepoRoot);
  console.log(pc.cyan(`Creating ${taskName} from ${config.baseRef}...`));
  createOrAttachWorktree({
    repoRoot: baseRepoRoot,
    taskPath,
    branchName,
    baseRef: config.baseRef
  });
  syncBaseFolderIntoTask(baseFolderPath, taskPath);
  console.log(pc.green(`Created: ${taskPath}`));
  openInCursor(taskPath);
}

export function runOpenCommand(taskId: string, repoOption?: string): void {
  const configDir = resolveConfiguredRepoRoot(repoOption);
  const config = readConfig(configDir);
  const taskName = toTaskName(config.taskPrefix, taskId);
  const taskPath = getTaskPath(configDir, config.tasksDir, taskName);

  if (!fs.existsSync(taskPath)) {
    throw new Error(`Task folder does not exist: ${taskPath}`);
  }

  openInCursor(taskPath);
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

  await promptForExactConfirmation(
    `Type '${taskName}' to permanently remove this task worktree:`,
    taskName
  );

  removeWorktree(baseRepoRoot, taskPath, { force: true });
  maybeDeleteTaskBranch(baseRepoRoot, `${config.branchPrefix}${taskName}`);
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
  const taskNames = listTaskFolders(configDir, config.tasksDir, config.taskPrefix);
  if (taskNames.length === 0) {
    console.log(pc.yellow("No task folders found."));
    return;
  }

  const now = Date.now();
  const thresholdMs = days * 24 * 60 * 60 * 1000;
  const purgeCandidates: Array<{ taskName: string; taskPath: string; lastUpdatedMs: number }> = [];

  for (const taskName of taskNames) {
    const taskPath = getTaskPath(configDir, config.tasksDir, taskName);
    const lastUpdatedMs = getTaskLastUpdatedMs(taskPath);
    if (now - lastUpdatedMs >= thresholdMs) {
      purgeCandidates.push({ taskName, taskPath, lastUpdatedMs });
    }
  }

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

    if (commandExists("cursor")) {
      ok("Cursor CLI is available");
    } else {
      failCheck("Cursor CLI is missing from PATH");
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
