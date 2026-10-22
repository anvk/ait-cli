import fs from "node:fs";
import pc from "picocolors";
import { CONFIG_FILE, baseNames, readConfig, resolveBaseCommands } from "../core/config.js";
import { cloneSupport } from "../core/copy.js";
import { listPrunableWorktrees, refResolves } from "../core/git.js";
import { describeKind, pluginVersion } from "../plugins/install.js";
import { brokenPluginList, doctorChecks, findLeftovers, missingPlugins } from "../plugins/registry.js";
import { readInstalled } from "../plugins/state.js";
import { isLanesLine } from "../hooks/run.js";
import { shellSplit } from "../hooks/shell.js";
import { COMMAND_LISTS } from "../plugins/types.js";
import { commandExists } from "../core/process.js";
import { selfUpdateDiagnostics } from "../update/diagnostics.js";
import { resolveLanesRoot } from "../core/lanes.js";
import type { BaseConfig } from "../core/types.js";
import { errorMessage } from "../core/util.js";
import {
  exportLanesRepoCommand,
  knownLaneKeys,
  resolveBaseRepoRoot,
  resolveConfiguredRepoRoot
} from "../core/workspace.js";

// Words the shell handles itself, which a PATH lookup would wrongly report as missing.
const SHELL_WORDS = new Set([
  "cd",
  "export",
  "set",
  "true",
  "false",
  "echo",
  "exit",
  "test",
  "[",
  "source",
  ".",
  "eval",
  "exec"
]);

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
    ok(`lanes config directory: ${configDir}`);

    const envRepo = process.env.LANES_REPO?.trim();
    if (envRepo) {
      ok(`LANES_REPO is set: ${envRepo}`);
    } else {
      warn(
        `LANES_REPO is not set, so lanes only works inside ${configDir} and its subfolders. To fix, run:\n     ${exportLanesRepoCommand(configDir)}`
      );
    }

    const config = readConfig(configDir);
    ok(`Config loaded from ${CONFIG_FILE}`);
    ok(`Lane prefix: ${config.lanePrefix || "(none)"}`);
    if (config.branchPrefix) {
      ok(`Branch prefix: ${config.branchPrefix}`);
    } else {
      ok("Branch prefix: (none)");
    }
    ok(`Old lane threshold (days): ${config.oldLaneDays}`);
    ok(`Bases: ${baseNames(config).join(", ")}`);

    // A base that is missing or not a repo fails its own checks; the others still run.
    const baseRepoRoots: { base: BaseConfig; repoRoot: string }[] = [];
    for (const base of config.bases) {
      const label = config.bases.length > 1 ? `Base '${base.name}'` : "Base";
      ok(`${label} folder: ${base.folder}`);
      ok(`${label} git ref: ${base.ref}`);
      ok(`${label} lanes directory: ${base.lanesDir}`);
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

      const lanesRoot = resolveLanesRoot(configDir, base.lanesDir);
      if (fs.existsSync(lanesRoot)) {
        ok(`${label} lanes root exists: ${lanesRoot}`);
      } else {
        warn(`${label} lanes root does not exist yet (will be created on demand): ${lanesRoot}`);
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
        warn(
          `${label}: ${prunable.length} git worktree(s) point at deleted folders. Run 'lanes prune' to clean them up.`
        );
      }
    }

    const leftovers = findLeftovers(knownLaneKeys(configDir, config));
    if (leftovers.length === 0) {
      ok("No files left behind by removed lanes");
    } else {
      const names = leftovers.map((leftover) => leftover.key).join(", ");
      warn(`${leftovers.length} removed lane(s) left files behind (${names}). Run 'lanes prune' to clean them up.`);
    }

    // Lane folders are mirrored from the base with APFS cloning where it is available,
    // which is the difference between a second and a dozen for a large repository.
    const clone = cloneSupport();
    if (clone.available) {
      ok("Fast lane copies: base folders are cloned copy-on-write");
    } else {
      warn(`Lane folders will be copied rather than cloned, which is slower: ${clone.reason}`);
    }

    const installed = readInstalled();
    ok(
      installed.length === 0
        ? "No plugins installed"
        : `Plugins: ${installed.map((plugin) => `${plugin.name} (${pluginVersion(plugin)}, ${describeKind(plugin)})`).join(", ")}`
    );
    for (const broken of brokenPluginList()) {
      warn(`Plugin '${broken.name}' does not load: ${broken.reason}`);
    }
    for (const name of missingPlugins(config)) {
      const source = config.plugins?.[name];
      failCheck(
        `Plugin '${name}' is used by this workspace but is not installed. Run: lanes plugin install ${source ?? "<git URL or path>"}`
      );
    }
    // Only the plugins some base uses are checked, so a workspace that opens lanes in
    // Cursor is not asked about Warp.
    for (const line of doctorChecks(config)) {
      ({ ok, warn, fail: failCheck })[line.level](line.message);
    }

    for (const base of config.bases) {
      const label = config.bases.length > 1 ? `Base '${base.name}'` : "Base";
      if (base.template) {
        ok(`${label} commands come from ${base.template} (refresh with 'lanes commands update')`);
      } else if (!base.open) {
        ok(`${label} uses the top-level command lists`);
      }
      const lists = resolveBaseCommands(config, base);
      for (const list of COMMAND_LISTS) {
        for (const line of lists[list]) {
          ok(`${label} ${list}: ${line}`);
          // Only the program is looked up; the line may carry flags and arguments.
          const executable = isLanesLine(line) ? undefined : executableOf(line);
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
