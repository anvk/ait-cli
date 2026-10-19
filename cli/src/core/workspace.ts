import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILE, baseNames, findBase, readConfig } from "./config.js";
import { getRepoRoot } from "./git.js";
import { getTaskPath, listTaskFolders, toTaskName } from "./tasks.js";
import type { BaseConfig, LaneConfig } from "./types.js";
import { findUp, isDirectory } from "./util.js";

export function resolveConfiguredRepoRoot(repoOption?: string): string {
  const startDir = repoOption ? path.resolve(repoOption) : process.cwd();
  const configPath = findUp(startDir, CONFIG_FILE);
  if (configPath) {
    return fs.realpathSync.native(path.dirname(configPath));
  }

  // Only consulted outside a configured workspace, so an exported LANE_REPO cannot
  // hijack commands run inside a different one.
  const fallbackRepo = repoOption ? undefined : process.env.LANE_REPO?.trim();
  if (fallbackRepo) {
    const fallbackConfigPath = findUp(path.resolve(fallbackRepo), CONFIG_FILE);
    if (!fallbackConfigPath) {
      throw new Error(
        `LANE_REPO does not point at a configured workspace: ${fallbackRepo}\nMissing .lane.json. Run \`lane init\` there.`
      );
    }
    return fs.realpathSync.native(path.dirname(fallbackConfigPath));
  }

  throw new Error(
    `Directory is not configured for lane tasks: ${startDir}\nMissing .lane.json. Run \`lane init\` in your repository root, or set LANE_REPO to a configured workspace.`
  );
}

export interface Workspace {
  configDir: string;
  config: LaneConfig;
}

// The workspace a command runs in: `--repo`, else the one around the current directory,
// else LANE_REPO.
export function loadWorkspace(repoOption?: string): Workspace {
  const configDir = resolveConfiguredRepoRoot(repoOption);
  return { configDir, config: readConfig(configDir) };
}

export function resolveBaseRepoRoot(configDir: string, base: BaseConfig): string {
  const baseFolderPath = path.resolve(configDir, base.folder);

  if (!isDirectory(baseFolderPath)) {
    throw new Error(`Base '${base.name}' folder does not exist: ${baseFolderPath}`);
  }

  let repoRoot: string;
  try {
    repoRoot = getRepoRoot(baseFolderPath);
  } catch {
    throw new Error(`Base '${base.name}' folder is not inside a git repository: ${baseFolderPath}`);
  }

  return fs.realpathSync.native(repoRoot);
}

// Where a task lives (or would live): its base, name and folder.
export interface TaskLocation {
  base: BaseConfig;
  taskName: string;
  taskPath: string;
  exists: boolean;
}

export function locateInBase(configDir: string, base: BaseConfig, taskName: string): TaskLocation {
  const taskPath = getTaskPath(configDir, base.tasksDir, taskName);
  return { base, taskName, taskPath, exists: fs.existsSync(taskPath) };
}

// `--base` decides; a single-base workspace needs no flag. Otherwise the task has to
// already exist in exactly one base, since guessing where to create it would silently
// put work in the wrong repository.
export function locateTask(configDir: string, config: LaneConfig, taskId: string, baseOption?: string): TaskLocation {
  const taskName = toTaskName(config.taskPrefix, taskId);
  if (baseOption) {
    return locateInBase(configDir, findBase(config, baseOption), taskName);
  }
  if (config.bases.length === 1) {
    return locateInBase(configDir, config.bases[0], taskName);
  }

  const hits = config.bases.map((base) => locateInBase(configDir, base, taskName)).filter((location) => location.exists);
  if (hits.length === 1) {
    return hits[0];
  }
  if (hits.length === 0) {
    throw new Error(
      `Task ${taskName} does not exist in any base (${baseNames(config).join(", ")}). Pass --base <name> to say which base to use.`
    );
  }
  throw new Error(
    `Task ${taskName} exists in more than one base (${hits.map((hit) => hit.base.name).join(", ")}). Pass --base <name>.`
  );
}

// The base a new task or checkout goes into: `--base`, or the only one there is. A
// multi-base workspace always needs the flag, since there is nothing to locate it by.
export function requireBase(config: LaneConfig, baseOption?: string): BaseConfig {
  if (baseOption) {
    return findBase(config, baseOption);
  }
  if (config.bases.length > 1) {
    throw new Error(`This workspace has several bases (${baseNames(config).join(", ")}). Pass --base <name>.`);
  }
  return config.bases[0];
}

// How a task is named outside its folder. With several bases the same task name can
// exist twice, so the `key` plugin commands file things under carries the base, and
// the `label` people see says which base it is.
export interface TaskIdentity {
  key: string;
  label: string;
}

export function taskIdentity(config: LaneConfig, base: BaseConfig, taskName: string): TaskIdentity {
  if (config.bases.length === 1) {
    return { key: taskName, label: taskName };
  }
  return { key: `${base.name}-${taskName}`, label: `${taskName} (${base.name})` };
}

// The key of every task that exists; files under any other key were left behind by a
// deleted task.
export function knownTaskKeys(configDir: string, config: LaneConfig): string[] {
  return config.bases.flatMap((base) =>
    listTaskFolders(configDir, base.tasksDir, config.taskPrefix).map((taskName) => taskIdentity(config, base, taskName).key)
  );
}

// macOS defaults to zsh; bash keeps login shells in .bash_profile.
function shellProfilePath(): string {
  return (process.env.SHELL ?? "").endsWith("/bash") ? "~/.bash_profile" : "~/.zshrc";
}

// Appending alone leaves the current shell without the variable, since the profile is
// only read at shell startup, so the same command exports it here too.
export function exportLaneRepoCommand(configDir: string): string {
  const line = `export LANE_REPO=${configDir}`;
  return `echo '${line}' >> ${shellProfilePath()} && ${line}`;
}
