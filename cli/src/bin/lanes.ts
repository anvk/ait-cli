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
  runLanesCommand
} from "../cli/commands.js";
import { runDiagnosticsCommand } from "../cli/doctor.js";
import { runUpdateCommand } from "../update/update.js";
import { registerPluginCommands } from "../plugins/cli.js";
import { loadPlugins } from "../plugins/load.js";
import { registerPlugins, setPlugins } from "../plugins/registry.js";
import { looksLikeLaneId } from "../core/lanes.js";
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

const LANE_ID = ["<laneId>", "Lane identifier, e.g. 1437"] as const;

type OpenCommandOptions = OpenOptions & BaseOption & ForceOption;

// The flags of every command that can create a lane and run its open commands.
function withOpenOptions(command: Command, baseHelp: string): Command {
  return command
    .option("--close-current-tab", "Close the terminal tab this command was run from once the lane is open")
    .option("--base <name>", baseHelp)
    .option("--force", "Create the lane even if the base has uncommitted changes or local commits");
}

program
  .name("lanes")
  .usage("[options] [command] | <laneId>")
  .description("Run coding agents side by side, each in its own lane: a git worktree on its own branch")
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
  .description("Initialize .lanes.json in the current directory")
  .argument("[source]", "Command lists to suggest for each base: a URL or file path")
  .action((source: string | undefined) => runInitCommand(source, repo()));

withOpenOptions(
  program
    .command("create")
    .description("Create a lane and run the base's open commands for it")
    .argument(...LANE_ID)
    .option("--no-open", "Do not run the open commands after creation"),
  "Base to create the lane from (required when several bases are configured)"
).action((laneId: string, options: OpenCommandOptions & { open: boolean }) => runCreateCommand(laneId, options, repo()));

withOpenOptions(
  program
    .command("checkout")
    .description(
      "Make a lane of an existing branch (fetched from origin) and open it; opens the lane if it already has that branch"
    )
    .argument("<branch>", "Branch name, e.g. someone/ABC-558-fix-login (an origin/ prefix is dropped)"),
  "Base to check the branch out from (required when several bases are configured)"
).action((branch: string, options: OpenCommandOptions) => runCheckoutCommand(branch, options, repo()));

withOpenOptions(
  program
    .command("open")
    .description("Open a lane, creating it first if it does not exist")
    .argument(...LANE_ID),
  "Base the lane belongs to (needed when it does not exist in exactly one base)"
).action((laneId: string, options: OpenCommandOptions) => runOpenCommand(laneId, options, repo()));

program
  .command("remove")
  .description("Remove a lane after typed confirmation")
  .argument(...LANE_ID)
  .option("--base <name>", "Base the lane belongs to (needed when it exists in more than one base)")
  .action((laneId: string, options: BaseOption) => runRemoveCommand(laneId, options, repo()));

program
  .command("list")
  .description("List existing lane folders")
  .action(() => runListCommand(repo()));

// `lanes` on its own opens the picker, and `lanes 1437` is `lanes open 1437`; `lanes --help`
// still lists the commands. Only a word shaped like a lane id takes the shortcut, so a
// mistyped command (`lanes lst`) fails instead of creating a lane named after the typo.
withOpenOptions(
  program
    .command("pick", { isDefault: true })
    .argument("[laneId]", "Open this lane instead of picking one, creating it if needed, e.g. 1437")
    .allowExcessArguments(false)
    .description("Pick a lane to open, or create a new one (interactive; the default command)"),
  "Start the picker filtered to one base"
).action((laneId: string | undefined, options: OpenCommandOptions) => {
  if (laneId === undefined) {
    return runLanesCommand(options, repo());
  }
  if (!looksLikeLaneId(laneId)) {
    fail(`Unknown command '${laneId}'. To open a lane with that name, run: lanes open ${laneId}`);
  }
  return runOpenCommand(laneId, options, repo());
});

program
  .command("purge")
  .description("Purge lanes not updated in N days (default: config oldLaneDays) with confirmation")
  .option("--days <days>", "Age threshold in days (overrides config)")
  .action((options: { days?: string }) => runPurgeCommand(options, repo()));

program
  .command("prune")
  .description("Remove files and git worktree records left behind by deleted lane folders")
  .action(() => runPruneCommand(repo()));

program
  .command("commands")
  .alias("tabs")
  .description("Manage the command lists run for each base's lanes")
  .command("update")
  .description("Re-fetch each base's command lists from its recorded template and save any changes")
  .option("--base <name>", "Only update this base")
  .action((options: BaseOption) => runCommandsUpdateCommand(options, repo()));

registerPluginCommands(program);

program
  .command("update")
  .description("Update lanes now instead of waiting for the next start")
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
  // Installed plugins become `lanes <plugin> …` commands; one that fails to load is left
  // out here and reported by doctor and `lanes plugin list`.
  const loaded = await loadPlugins();
  setPlugins(loaded.plugins, loaded.broken);
  registerPlugins(program);
  await program.parseAsync(process.argv);
}

main().catch(fail);
