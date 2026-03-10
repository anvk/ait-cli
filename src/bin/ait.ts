#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Command } from "commander"
import pc from "picocolors"
import {
  runCreateCommand,
  runDiagnosticsCommand,
  runInitCommand,
  runListCommand,
  runOpenCommand,
  runPurgeCommand,
  runRemoveCommand,
  runTaskCommand,
} from "../commands.js"

const program = new Command()
const thisFile = fileURLToPath(import.meta.url)
const thisDir = path.dirname(thisFile)

function getCliVersion(): string {
  try {
    const packageJsonPath = path.resolve(thisDir, "../../package.json")
    const packageJsonRaw = fs.readFileSync(packageJsonPath, "utf8")
    const packageJson = JSON.parse(packageJsonRaw) as { version?: string }
    if (packageJson.version) {
      return packageJson.version
    }
  } catch {
    // Ignore and fall through to unknown version.
  }
  return "unknown"
}

const cliVersion = getCliVersion()

interface GlobalOptions {
  repo?: string
}

function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error)
  console.error(pc.red(message))
  process.exit(1)
}

program
  .name("ait")
  .description("Manage per-repo task worktrees")
  .option("-C, --repo <path>", "Use a specific repository path")
  .version(cliVersion, "-v, --version", "Show CLI version")
  .addHelpCommand("help [command]", "Show commands and descriptions")
  .showHelpAfterError("(add --help for additional information)")

program
  .command("version")
  .description("Print CLI version")
  .action(() => {
    console.log(cliVersion)
  })

program
  .command("init")
  .description("Initialize .ait.json in the current directory")
  .action(async () => {
    await runInitCommand(program.opts<GlobalOptions>().repo)
  })

program
  .command("create")
  .description("Create a task worktree and open it in Cursor")
  .argument("<taskId>", "Task identifier, e.g. 1437")
  .option("--no-open", "Do not open Cursor after creation")
  .action((taskId: string, options: { open: boolean }) => {
    runCreateCommand(taskId, options, program.opts<GlobalOptions>().repo)
  })

program
  .command("task")
  .description("Open task if it exists, otherwise create and open it")
  .argument("<taskId>", "Task identifier, e.g. 1437")
  .action((taskId: string) => {
    runTaskCommand(taskId, program.opts<GlobalOptions>().repo)
  })

program
  .command("open")
  .description("Open an existing task folder in Cursor")
  .argument("<taskId>", "Task identifier, e.g. 1437")
  .action((taskId: string) => {
    runOpenCommand(taskId, program.opts<GlobalOptions>().repo)
  })

program
  .command("remove")
  .description("Remove a task worktree after typed confirmation")
  .argument("<taskId>", "Task identifier, e.g. 1437")
  .action(async (taskId: string) => {
    await runRemoveCommand(taskId, program.opts<GlobalOptions>().repo)
  })

program
  .command("list")
  .description("List existing task folders")
  .action(() => {
    runListCommand(program.opts<GlobalOptions>().repo)
  })

program
  .command("tasks")
  .description("Alias for list")
  .action(() => {
    runListCommand(program.opts<GlobalOptions>().repo)
  })

program
  .command("purge")
  .description(
    "Purge tasks not updated in N days (default: config oldTaskDays) with confirmation",
  )
  .option("--days <days>", "Age threshold in days (overrides config)")
  .action(async (options: { days?: string }) => {
    await runPurgeCommand(options, program.opts<GlobalOptions>().repo)
  })

program
  .command("doctor")
  .description("Run environment and config diagnostics")
  .action(() => {
    runDiagnosticsCommand(program.opts<GlobalOptions>().repo)
  })

program
  .command("status")
  .description("Alias for doctor")
  .action(() => {
    runDiagnosticsCommand(program.opts<GlobalOptions>().repo)
  })

async function main(): Promise<void> {
  await program.parseAsync(process.argv)
}

main().catch(fail)
