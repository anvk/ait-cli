#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Command } from "commander";
import pc from "picocolors";
import { getRepoRoot, readConfig } from "../config.js";
import { interactiveInit } from "../init.js";
import { openInCursor } from "../editor.js";
import {
  createOrAttachWorktree,
  deleteLocalBranch,
  fetchOrigin,
  removeWorktree
} from "../git.js";
import { commandExists, run } from "../process.js";
import {
  ensureTasksDir,
  getTaskLastUpdatedMs,
  getTaskPath,
  listTaskFolders,
  resolveTasksRoot,
  toTaskName
} from "../tasks.js";

const program = new Command();
const thisFile = fileURLToPath(import.meta.url);
const thisDir = path.dirname(thisFile);

function getCliVersion(): string {
  try {
    const packageJsonPath = path.resolve(thisDir, "../../package.json");
    const packageJsonRaw = fs.readFileSync(packageJsonPath, "utf8");
    const packageJson = JSON.parse(packageJsonRaw) as { version?: string };
    if (packageJson.version) {
      return packageJson.version;
    }
  } catch {
    // Ignore and fall through to unknown version.
  }
  return "unknown";
}

const cliVersion = getCliVersion();

interface GlobalOptions {
  repo?: string;
}

function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  console.error(pc.red(message));
  process.exit(1);
}

function resolveRepoRoot(repoOption?: string): string {
  const cwd = repoOption ? path.resolve(repoOption) : process.cwd();
  try {
    return getRepoRoot(cwd);
  } catch {
    throw new Error(
      `Not inside a git repository: ${cwd}\nRun the command from a repo, or pass --repo <path-to-repo>.`
    );
  }
}

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

function maybeDeleteTaskBranch(baseRepoRoot: string, taskName: string): void {
  const branchResult = deleteLocalBranch(baseRepoRoot, taskName);
  if (!branchResult.deleted && branchResult.message && branchResult.message !== "branch not found") {
    console.log(
      pc.yellow(
        `Worktree removed but branch '${taskName}' was kept: ${branchResult.message}`
      )
    );
  }
}

program
  .name("ait")
  .description("Manage per-repo task worktrees")
  .option("-C, --repo <path>", "Use a specific repository path")
  .version(cliVersion, "-v, --version", "Show CLI version")
  .addHelpCommand("help [command]", "Show commands and descriptions")
  .showHelpAfterError("(add --help for additional information)");

program
  .command("version")
  .description("Print CLI version")
  .action(() => {
    console.log(cliVersion);
  });

program
  .command("init")
  .description("Initialize .ait.json in the current directory")
  .action(async () => {
    try {
      const targetDir = path.resolve(program.opts<GlobalOptions>().repo || process.cwd());
      const configPath = await interactiveInit(targetDir);
      console.log(pc.green(`Created config: ${configPath}`));
    } catch (error) {
      fail(error);
    }
  });

program
  .command("create")
  .description("Create a task worktree and open it in Cursor")
  .argument("<taskId>", "Task identifier, e.g. 1437")
  .option("--no-open", "Do not open Cursor after creation")
  .action((taskId: string, options: { open: boolean }) => {
    try {
      const configDir = resolveConfiguredRepoRoot(program.opts<GlobalOptions>().repo);
      const config = readConfig(configDir);
      const baseRepoRoot = resolveBaseRepoRoot(configDir, config.baseFolder);
      const taskName = toTaskName(config.prefix, taskId);
      ensureTasksDir(configDir, config.tasksDir);
      const taskPath = getTaskPath(configDir, config.tasksDir, taskName);

      if (fs.existsSync(taskPath)) {
        throw new Error(
          `Task folder already exists: ${taskPath}\nUse \`ait open ${taskId}\` instead.`
        );
      }

      console.log(pc.cyan("Fetching origin..."));
      fetchOrigin(baseRepoRoot);
      console.log(pc.cyan(`Creating ${taskName} from ${config.baseRef}...`));
      createOrAttachWorktree({
        repoRoot: baseRepoRoot,
        taskPath,
        branchName: taskName,
        baseRef: config.baseRef
      });
      console.log(pc.green(`Created: ${taskPath}`));

      if (options.open) {
        openInCursor(taskPath);
      }
    } catch (error) {
      fail(error);
    }
  });

program
  .command("task")
  .description("Open task if it exists, otherwise create and open it")
  .argument("<taskId>", "Task identifier, e.g. 1437")
  .action((taskId: string) => {
    try {
      const configDir = resolveConfiguredRepoRoot(program.opts<GlobalOptions>().repo);
      const config = readConfig(configDir);
      const baseRepoRoot = resolveBaseRepoRoot(configDir, config.baseFolder);
      const taskName = toTaskName(config.prefix, taskId);
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
        branchName: taskName,
        baseRef: config.baseRef
      });
      console.log(pc.green(`Created: ${taskPath}`));
      openInCursor(taskPath);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("open")
  .description("Open an existing task folder in Cursor")
  .argument("<taskId>", "Task identifier, e.g. 1437")
  .action((taskId: string) => {
    try {
      const configDir = resolveConfiguredRepoRoot(program.opts<GlobalOptions>().repo);
      const config = readConfig(configDir);
      const taskName = toTaskName(config.prefix, taskId);
      const taskPath = getTaskPath(configDir, config.tasksDir, taskName);

      if (!fs.existsSync(taskPath)) {
        throw new Error(`Task folder does not exist: ${taskPath}`);
      }

      openInCursor(taskPath);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("remove")
  .description("Remove a task worktree after typed confirmation")
  .argument("<taskId>", "Task identifier, e.g. 1437")
  .action(async (taskId: string) => {
    try {
      const configDir = resolveConfiguredRepoRoot(program.opts<GlobalOptions>().repo);
      const config = readConfig(configDir);
      const baseRepoRoot = resolveBaseRepoRoot(configDir, config.baseFolder);
      const taskName = toTaskName(config.prefix, taskId);
      const taskPath = getTaskPath(configDir, config.tasksDir, taskName);

      if (!fs.existsSync(taskPath)) {
        throw new Error(`Task folder does not exist: ${taskPath}`);
      }

      await promptForExactConfirmation(
        `Type '${taskName}' to permanently remove this task worktree:`,
        taskName
      );

      removeWorktree(baseRepoRoot, taskPath);
      maybeDeleteTaskBranch(baseRepoRoot, taskName);
      console.log(pc.green(`Removed task: ${taskPath}`));
    } catch (error) {
      fail(error);
    }
  });

program
  .command("list")
  .description("List existing task folders")
  .action(() => {
    try {
      const configDir = resolveConfiguredRepoRoot(program.opts<GlobalOptions>().repo);
      const config = readConfig(configDir);
      const tasksRoot = resolveTasksRoot(configDir, config.tasksDir);
      const tasks = listTaskFolders(configDir, config.tasksDir, config.prefix);
      if (tasks.length === 0) {
        if (fs.existsSync(tasksRoot)) {
          console.log(pc.yellow(`No task folders found in '${config.tasksDir}' (directory is empty).`));
        } else {
          console.log(
            pc.yellow(
              `No task folders found. '${config.tasksDir}' does not exist yet; it will be created when you run 'ait create <taskId>'.`
            )
          );
        }
        return;
      }
      for (const taskName of tasks) {
        console.log(taskName);
      }
    } catch (error) {
      fail(error);
    }
  });

program
  .command("tasks")
  .description("Alias for list")
  .action(() => {
    try {
      const configDir = resolveConfiguredRepoRoot(program.opts<GlobalOptions>().repo);
      const config = readConfig(configDir);
      const tasksRoot = resolveTasksRoot(configDir, config.tasksDir);
      const tasks = listTaskFolders(configDir, config.tasksDir, config.prefix);
      if (tasks.length === 0) {
        if (fs.existsSync(tasksRoot)) {
          console.log(pc.yellow(`No task folders found in '${config.tasksDir}' (directory is empty).`));
        } else {
          console.log(
            pc.yellow(
              `No task folders found. '${config.tasksDir}' does not exist yet; it will be created when you run 'ait create <taskId>'.`
            )
          );
        }
        return;
      }
      for (const taskName of tasks) {
        console.log(taskName);
      }
    } catch (error) {
      fail(error);
    }
  });

program
  .command("purge-old")
  .description("Purge tasks not updated in N days (default 14) with confirmation")
  .option("--days <days>", "Age threshold in days", "14")
  .action(async (options: { days: string }) => {
    try {
      const days = Number.parseInt(options.days, 10);
      if (!Number.isFinite(days) || days < 1) {
        throw new Error("`--days` must be a positive integer.");
      }

      const configDir = resolveConfiguredRepoRoot(program.opts<GlobalOptions>().repo);
      const config = readConfig(configDir);
      const baseRepoRoot = resolveBaseRepoRoot(configDir, config.baseFolder);
      const taskNames = listTaskFolders(configDir, config.tasksDir, config.prefix);
      if (taskNames.length === 0) {
        console.log(pc.yellow("No task folders found."));
        return;
      }

      const now = Date.now();
      const thresholdMs = days * 24 * 60 * 60 * 1000;
      const purgeCandidates: Array<{ taskName: string; taskPath: string; lastUpdatedMs: number }> =
        [];

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
        console.log(
          `- ${candidate.taskName} (last update: ${new Date(candidate.lastUpdatedMs).toISOString()})`
        );
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
          removeWorktree(baseRepoRoot, candidate.taskPath);
          maybeDeleteTaskBranch(baseRepoRoot, candidate.taskName);
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
    } catch (error) {
      fail(error);
    }
  });

program
  .command("doctor")
  .description("Run environment and config diagnostics")
  .action(() => {
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
      const configDir = resolveConfiguredRepoRoot(program.opts<GlobalOptions>().repo);
      ok(`AIT config directory: ${configDir}`);

      const config = readConfig(configDir);
      ok("Config loaded from .ait.json");
      ok(`Task naming prefix: ${config.prefix}`);
      ok(`Tasks directory: ${config.tasksDir}`);
      ok(`Base git ref: ${config.baseRef}`);
      ok(`Base folder: ${config.baseFolder}`);

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
  });

async function main(): Promise<void> {
  await program.parseAsync(process.argv);
}

main().catch(fail);
