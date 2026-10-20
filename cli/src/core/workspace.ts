import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILE, baseNames, findBase, readConfig } from "./config.js";
import { getRepoRoot } from "./git.js";
import { getLanePath, listLaneFolders, toLaneName } from "./lanes.js";
import type { BaseConfig, LanesConfig } from "./types.js";
import { findUp, isDirectory } from "./util.js";

export function resolveConfiguredRepoRoot(repoOption?: string): string {
  const startDir = repoOption ? path.resolve(repoOption) : process.cwd();
  const configPath = findUp(startDir, CONFIG_FILE);
  if (configPath) {
    return fs.realpathSync.native(path.dirname(configPath));
  }

  // Only consulted outside a configured workspace, so an exported LANES_REPO cannot
  // hijack commands run inside a different one.
  const fallbackRepo = repoOption ? undefined : process.env.LANES_REPO?.trim();
  if (fallbackRepo) {
    const fallbackConfigPath = findUp(path.resolve(fallbackRepo), CONFIG_FILE);
    if (!fallbackConfigPath) {
      throw new Error(
        `LANES_REPO does not point at a configured workspace: ${fallbackRepo}\nMissing .lanes.json. Run \`lanes init\` there.`
      );
    }
    return fs.realpathSync.native(path.dirname(fallbackConfigPath));
  }

  throw new Error(
    `Directory is not a lanes workspace: ${startDir}\nMissing .lanes.json. Run \`lanes init\` in your repository root, or set LANES_REPO to a configured workspace.`
  );
}

export interface Workspace {
  configDir: string;
  config: LanesConfig;
}

// The workspace a command runs in: `--repo`, else the one around the current directory,
// else LANES_REPO.
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

// Where a lane lives (or would live): its base, name and folder.
export interface LaneLocation {
  base: BaseConfig;
  laneName: string;
  lanePath: string;
  exists: boolean;
}

export function locateInBase(configDir: string, base: BaseConfig, laneName: string): LaneLocation {
  const lanePath = getLanePath(configDir, base.lanesDir, laneName);
  return { base, laneName, lanePath, exists: fs.existsSync(lanePath) };
}

// `--base` decides; a single-base workspace needs no flag. Otherwise the lane has to
// already exist in exactly one base, since guessing where to create it would silently
// put work in the wrong repository.
export function locateLane(configDir: string, config: LanesConfig, laneId: string, baseOption?: string): LaneLocation {
  const laneName = toLaneName(config.lanePrefix, laneId);
  if (baseOption) {
    return locateInBase(configDir, findBase(config, baseOption), laneName);
  }
  if (config.bases.length === 1) {
    return locateInBase(configDir, config.bases[0], laneName);
  }

  const hits = config.bases.map((base) => locateInBase(configDir, base, laneName)).filter((location) => location.exists);
  if (hits.length === 1) {
    return hits[0];
  }
  if (hits.length === 0) {
    throw new Error(
      `Lane ${laneName} does not exist in any base (${baseNames(config).join(", ")}). Pass --base <name> to say which base to use.`
    );
  }
  throw new Error(
    `Lane ${laneName} exists in more than one base (${hits.map((hit) => hit.base.name).join(", ")}). Pass --base <name>.`
  );
}

// The base a new lane or checkout goes into: `--base`, or the only one there is. A
// multi-base workspace always needs the flag, since there is nothing to locate it by.
export function requireBase(config: LanesConfig, baseOption?: string): BaseConfig {
  if (baseOption) {
    return findBase(config, baseOption);
  }
  if (config.bases.length > 1) {
    throw new Error(`This workspace has several bases (${baseNames(config).join(", ")}). Pass --base <name>.`);
  }
  return config.bases[0];
}

// How a lane is named outside its folder. With several bases the same lane name can
// exist twice, so the `key` plugin commands file things under carries the base, and
// the `label` people see says which base it is.
export interface LaneIdentity {
  key: string;
  label: string;
}

// The key names a lane in files other tools keep (Warp's tab configs), so it never
// changes: always base and lane, even while the workspace has one base. Adding a second
// base would otherwise rename every lane's files. The label is for reading, so it skips
// the base while there is only one.
export function laneIdentity(config: LanesConfig, base: BaseConfig, laneName: string): LaneIdentity {
  const key = `${base.name}-${laneName}`;
  return { key, label: config.bases.length === 1 ? laneName : `${laneName} (${base.name})` };
}

// The key of every lane that exists; files under any other key were left behind by a
// deleted lane.
export function knownLaneKeys(configDir: string, config: LanesConfig): string[] {
  return config.bases.flatMap((base) =>
    listLaneFolders(configDir, base.lanesDir, config.lanePrefix).map((laneName) => laneIdentity(config, base, laneName).key)
  );
}

// macOS defaults to zsh; bash keeps login shells in .bash_profile.
function shellProfilePath(): string {
  return (process.env.SHELL ?? "").endsWith("/bash") ? "~/.bash_profile" : "~/.zshrc";
}

// Appending alone leaves the current shell without the variable, since the profile is
// only read at shell startup, so the same command exports it here too.
export function exportLanesRepoCommand(configDir: string): string {
  const line = `export LANES_REPO=${configDir}`;
  return `echo '${line}' >> ${shellProfilePath()} && ${line}`;
}
