import fs from "node:fs";
import pc from "picocolors";
import { CONFIG_FILE, baseNames, readConfig, resolveBaseCommands } from "../core/config.js";
import { cloneSupport } from "../core/copy.js";
import { listPrunableWorktrees, refResolves } from "../core/git.js";
import { describeKind, pluginVersion } from "../plugins/install.js";
import { brokenPluginList, doctorChecks, findLeftovers, missingPlugins } from "../plugins/registry.js";
import { readInstalled } from "../plugins/state.js";
import { isLaneLine } from "../hooks/run.js";
import { shellSplit } from "../hooks/shell.js";
import { COMMAND_LISTS } from "../plugins/types.js";
import { commandExists } from "../core/process.js";
import { selfUpdateDiagnostics } from "../update/diagnostics.js";
import { resolveTasksRoot } from "../core/tasks.js";
import type { BaseConfig } from "../core/types.js";
import { errorMessage } from "../core/util.js";
import { exportLaneRepoCommand, knownTaskKeys, resolveBaseRepoRoot, resolveConfiguredRepoRoot } from "../core/workspace.js";

// Words the shell handles itself, which a PATH lookup would wrongly report as missing.
const SHELL_WORDS = new Set(["cd", "export", "set", "true", "false", "echo", "exit", "test", "[", "source", ".", "eval", "exec"]);

// The program a command line starts with, when it is something to look up on PATH.
function executableOf(line: string): string | undefined {
  try {
    const first = shellSplit(line).find((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
    return first && !SHELL_WORDS.has(first) && !first.includes("/") ? first : undefined;
  } catch {
    return undefined;
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

  for (const line of selfUpdateDiagnostics()) {
    if (line.level === "ok") {
      ok(line.message);
    } else {
      warn(line.message);
    }
  }

  try {
    const configDir = resolveConfiguredRepoRoot(repoOption);
    ok(`lane config directory: ${configDir}`);

    const envRepo = process.env.LANE_REPO?.trim();
    if (envRepo) {
      ok(`LANE_REPO is set: ${envRepo}`);
    } else {
      warn(
        `LANE_REPO is not set, so lane only works inside ${configDir} and its subfolders. To fix, run:\n     ${exportLaneRepoCommand(configDir)}`
      );
    }

    const config = readConfig(configDir);
    ok(`Config loaded from ${CONFIG_FILE}`);
    ok(`Task prefix: ${config.taskPrefix}`);
    if (config.branchPrefix) {
      ok(`Branch prefix: ${config.branchPrefix}`);
    } else {
      ok("Branch prefix: (none)");
    }
    ok(`Old task threshold (days): ${config.oldTaskDays}`);
    ok(`Bases: ${baseNames(config).join(", ")}`);

    // A base that is missing or not a repo fails its own checks; the others still run.
    const baseRepoRoots: { base: BaseConfig; repoRoot: string }[] = [];
    for (const base of config.bases) {
      const label = config.bases.length > 1 ? `Base '${base.name}'` : "Base";
      ok(`${label} folder: ${base.folder}`);
      ok(`${label} git ref: ${base.ref}`);
      ok(`${label} tasks directory: ${base.tasksDir}`);
      if (base.branchPrefix != null) {
        ok(`${label} branch prefix override: ${base.branchPrefix || "(none)"}`);
      }

      let repoRoot: string;
      try {
        repoRoot = resolveBaseRepoRoot(configDir, base);
      } catch (error) {
        failCheck(errorMessage(error));
        continue;
      }
      baseRepoRoots.push({ base, repoRoot });
      ok(`${label} git repository: ${repoRoot}`);

      const tasksRoot = resolveTasksRoot(configDir, base.tasksDir);
      if (fs.existsSync(tasksRoot)) {
        ok(`${label} tasks root exists: ${tasksRoot}`);
      } else {
        warn(`${label} tasks root does not exist yet (will be created on demand): ${tasksRoot}`);
      }

      if (refResolves(repoRoot, base.ref)) {
        ok(`${label} ref is resolvable locally: ${base.ref}`);
      } else {
        warn(`${label} ref not currently resolvable locally: ${base.ref} (try 'git fetch origin' in ${base.folder})`);
      }

      const prunable = listPrunableWorktrees(repoRoot);
      if (prunable.length === 0) {
        ok(`${label}: no stale git worktrees`);
      } else {
        warn(`${label}: ${prunable.length} git worktree(s) point at deleted folders. Run 'lane prune' to clean them up.`);
      }
    }

    const leftovers = findLeftovers(knownTaskKeys(configDir, config));
    if (leftovers.length === 0) {
      ok("No files left behind by removed tasks");
    } else {
      const names = leftovers.map((leftover) => leftover.key).join(", ");
      warn(`${leftovers.length} removed task(s) left files behind (${names}). Run 'lane prune' to clean them up.`);
    }

    // Task folders are mirrored from the base with APFS cloning where it is available,
    // which is the difference between a second and a dozen for a large repository.
    const clone = cloneSupport();
    if (clone.available) {
      ok("Fast task copies: base folders are cloned copy-on-write");
    } else {
      warn(`Task folders will be copied rather than cloned, which is slower: ${clone.reason}`);
    }

    const installed = readInstalled();
    ok(installed.length === 0 ? "No plugins installed" : `Plugins: ${installed.map((plugin) => `${plugin.name} (${pluginVersion(plugin)}, ${describeKind(plugin)})`).join(", ")}`);
    for (const broken of brokenPluginList()) {
      warn(`Plugin '${broken.name}' does not load: ${broken.reason}`);
    }
    for (const name of missingPlugins(config)) {
      const source = config.plugins?.[name];
      failCheck(
        `Plugin '${name}' is used by this workspace but is not installed. Run: lane plugin install ${source ?? "<git URL or path>"}`
      );
    }
    // Only the plugins some base uses are checked, so a workspace that opens tasks in
    // Cursor is not asked about Warp.
    for (const line of doctorChecks(config)) {
      ({ ok, warn, fail: failCheck })[line.level](line.message);
    }

    for (const base of config.bases) {
      const label = config.bases.length > 1 ? `Base '${base.name}'` : "Base";
      if (base.template) {
        ok(`${label} commands come from ${base.template} (refresh with 'lane commands update')`);
      } else if (!base.open) {
        ok(`${label} uses the top-level command lists`);
      }
      const lists = resolveBaseCommands(config, base);
      for (const list of COMMAND_LISTS) {
        for (const line of lists[list]) {
          ok(`${label} ${list}: ${line}`);
          // Only the program is looked up; the line may carry flags and arguments.
          const executable = isLaneLine(line) ? undefined : executableOf(line);
          if (executable && !commandExists(executable)) {
            warn(`${label} ${list} runs '${executable}', which is missing from PATH`);
          }
        }
      }
    }
  } catch (error) {
    failCheck(errorMessage(error));
  }

  for (const line of checks) {
    console.log(line);
  }
  if (hasFailures) {
    process.exitCode = 1;
    return;
  }
  console.log("");
  console.log(`${pc.green("🚀✨")} ${pc.green("You are all setup and ready to go.")}`);
}
