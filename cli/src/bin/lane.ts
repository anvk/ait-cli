#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import pc from "picocolors";
import { describeVersion, packageVersion, resolveInstall } from "../update/install.js";
import { maybeAutoUpdate } from "../update/index.js";
import {
  type BaseOption,
  type ForceOption,
  type OpenOptions,
  runCheckoutCommand,
  runCreateCommand,
  runInitCommand,
  runListCommand,
  runOpenCommand,
  runPruneCommand,
  runPurgeCommand,
  runRemoveCommand,
  runCommandsUpdateCommand,
  runTaskCommand,
  runTasksCommand
} from "../cli/commands.js";
import { runDiagnosticsCommand } from "../cli/doctor.js";
import { runUpdateCommand } from "../update/update.js";
import { registerPluginCommands } from "../plugins/cli.js";
import { loadPlugins } from "../plugins/load.js";
import { registerPlugins, setPlugins } from "../plugins/registry.js";
import { errorMessage } from "../core/util.js";

const program = new Command();
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Commander wants a plain string when the flag is registered, so the git lookup happens
// only when the flag is actually present. Everything else keeps its 0.05s startup.
function versionForFlag(): string {
  const asked = process.argv.includes("-v") || process.argv.includes("--version");
  return asked ? describeInstalledVersion() : packageVersion(packageRoot);
}

// The commit date and sha of the installed checkout; package.json's version is never bumped.
function describeInstalledVersion(): string {
  try {
    return describeVersion(resolveInstall());
  } catch {
    return packageVersion(packageRoot);
  }
}

function fail(error: unknown): never {
  console.error(pc.red(errorMessage(error)));
  process.exit(1);
}

// The workspace given with --repo, if any.
function repo(): string | undefined {
  return program.opts<{ repo?: string }>().repo;
}

const TASK_ID = ["<taskId>", "Task identifier, e.g. 1437"] as const;

type OpenCommandOptions = OpenOptions & BaseOption & ForceOption;

// The flags of every command that can create a task and run its open commands.
function withOpenOptions(command: Command, baseHelp: string): Command {
  return command
    .option("--close-current-tab", "Close the terminal tab this command was run from once the task is open")
    .option("--base <name>", baseHelp)
    .option("--force", "Create the task even if the base has uncommitted changes or local commits");
}

program
  .name("lane")
  .description("Manage per-repo task worktrees")
  .option("-C, --repo <path>", "Use a specific repository path")
  .version(versionForFlag(), "-v, --version", "Show CLI version")
  .addHelpCommand("help [command]", "Show commands and descriptions")
  .showHelpAfterError("(add --help for additional information)");

program
  .command("version")
  .description("Print CLI version")
  .action(() => console.log(describeInstalledVersion()));

program
  .command("init")
  .description("Initialize .lane.json in the current directory")
  .action(() => runInitCommand(repo()));

withOpenOptions(
  program
    .command("create")
    .description("Create a task worktree and run the base's open commands for it")
    .argument(...TASK_ID)
    .option("--no-open", "Do not run the open commands after creation"),
  "Base to create the task from (required when several bases are configured)"
).action((taskId: string, options: OpenCommandOptions & { open: boolean }) => runCreateCommand(taskId, options, repo()));

withOpenOptions(
  program
    .command("task")
    .description("Open task if it exists, otherwise create and open it")
    .argument(...TASK_ID),
  "Base the task belongs to (needed when it does not exist in exactly one base)"
).action((taskId: string, options: OpenCommandOptions) => runTaskCommand(taskId, options, repo()));

withOpenOptions(
  program
    .command("checkout")
    .description(
      "Make a task of an existing branch (fetched from origin) and open it; opens the task if it already has that branch"
    )
    .argument("<branch>", "Branch name, e.g. someone/LANE-558-fix-login (an origin/ prefix is dropped)"),
  "Base to check the branch out from (required when several bases are configured)"
).action((branch: string, options: OpenCommandOptions) => runCheckoutCommand(branch, options, repo()));

program
  .command("open")
  .description("Run the base's open commands for an existing task")
  .argument(...TASK_ID)
  .option("--base <name>", "Base the task belongs to (needed when it exists in more than one base)")
  .action((taskId: string, options: BaseOption) => runOpenCommand(taskId, options, repo()));

program
  .command("remove")
  .description("Remove a task worktree after typed confirmation")
  .argument(...TASK_ID)
  .option("--base <name>", "Base the task belongs to (needed when it exists in more than one base)")
  .action((taskId: string, options: BaseOption) => runRemoveCommand(taskId, options, repo()));

program
  .command("list")
  .description("List existing task folders")
  .action(() => runListCommand(repo()));

// `lane` on its own opens the picker; `lane --help` still lists the commands.
// Without this a mistyped command (`lane lst`) would fall through to the default
// command with the typo as an ignored extra argument, and silently open the picker.
withOpenOptions(
  program
    .command("tasks", { isDefault: true })
    .allowExcessArguments(false)
    .description("Pick a task to open, or create a new one (interactive; the default command)"),
  "Start the picker filtered to one base"
).action((options: OpenCommandOptions) => runTasksCommand(options, repo()));

program
  .command("purge")
  .description("Purge tasks not updated in N days (default: config oldTaskDays) with confirmation")
  .option("--days <days>", "Age threshold in days (overrides config)")
  .action((options: { days?: string }) => runPurgeCommand(options, repo()));

program
  .command("prune")
  .description("Remove files and git worktree records left behind by deleted task folders")
  .action(() => runPruneCommand(repo()));

program
  .command("commands")
  .alias("tabs")
  .description("Manage the command lists run for each base's tasks")
  .command("update")
  .description("Re-fetch each base's command lists from its recorded template and save any changes")
  .option("--base <name>", "Only update this base")
  .action((options: BaseOption) => runCommandsUpdateCommand(options, repo()));

registerPluginCommands(program);

program
  .command("update")
  .alias("upgrade")
  .description("Update lane now instead of waiting for the next start")
  .option("--check", "Only report whether an update is available")
  .action((options: { check?: boolean }) => runUpdateCommand(options));

program
  .command("doctor")
  .alias("status")
  .description("Run environment and config diagnostics")
  .action(() => runDiagnosticsCommand(repo()));

async function main(): Promise<void> {
  // Before commander, so anything printed lands ahead of the picker's raw-mode repaint,
  // and so an update can re-exec the command rather than run it on stale code.
  maybeAutoUpdate(process.argv);
  // Installed plugins become `lane <plugin> …` commands; one that fails to load is left
  // out here and reported by doctor and `lane plugin list`.
  const loaded = await loadPlugins();
  setPlugins(loaded.plugins, loaded.broken);
  registerPlugins(program);
  await program.parseAsync(process.argv);
}

main().catch(fail);
