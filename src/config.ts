import fs from "node:fs";
import path from "node:path";
import { run } from "./process.js";
import type { AitConfig } from "./types.js";

export const CONFIG_FILE = ".ait.json";

export const DEFAULT_CONFIG: AitConfig = {
  taskPrefix: "AIT-",
  branchPrefix: "",
  tasksDir: "tasks",
  baseRef: "origin/main",
  baseFolder: ".",
  oldTaskDays: 14
};

export function getRepoRoot(cwd = process.cwd()): string {
  const { stdout } = run("git", ["rev-parse", "--show-toplevel"], { cwd });
  return stdout;
}

export function getConfigPath(repoRoot: string): string {
  return path.join(repoRoot, CONFIG_FILE);
}

export function readConfig(repoRoot: string): AitConfig {
  const configPath = getConfigPath(repoRoot);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing ${CONFIG_FILE}. Run \`ait init\` first.`);
  }

  const raw = fs.readFileSync(configPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${configPath}`);
  }

  return normalizeConfig(parsed);
}

export function writeConfig(repoRoot: string, partialConfig: Partial<AitConfig>): string {
  const normalized = normalizeConfig(partialConfig);
  const configPath = getConfigPath(repoRoot);
  fs.writeFileSync(configPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return configPath;
}

export function normalizeConfig(input: unknown): AitConfig {
  const inputRecord = (input ?? {}) as Record<string, unknown>;
  const legacyPrefix = inputRecord.prefix;
  const merged = {
    ...DEFAULT_CONFIG,
    ...inputRecord,
    taskPrefix: inputRecord.taskPrefix ?? legacyPrefix ?? DEFAULT_CONFIG.taskPrefix
  } as Partial<AitConfig>;
  const oldTaskDays = parsePositiveInt(merged.oldTaskDays, "oldTaskDays");
  const config: AitConfig = {
    taskPrefix: String(merged.taskPrefix || DEFAULT_CONFIG.taskPrefix).trim(),
    branchPrefix: String(merged.branchPrefix || DEFAULT_CONFIG.branchPrefix).trim(),
    tasksDir: String(merged.tasksDir || DEFAULT_CONFIG.tasksDir).trim(),
    baseRef: String(merged.baseRef || DEFAULT_CONFIG.baseRef).trim(),
    baseFolder: String(merged.baseFolder || DEFAULT_CONFIG.baseFolder).trim(),
    oldTaskDays
  };

  if (!config.taskPrefix) {
    throw new Error("Config `taskPrefix` cannot be empty.");
  }
  if (!config.tasksDir) {
    throw new Error("Config `tasksDir` cannot be empty.");
  }
  if (!config.baseRef) {
    throw new Error("Config `baseRef` cannot be empty.");
  }
  if (!config.baseFolder) {
    throw new Error("Config `baseFolder` cannot be empty.");
  }
  if (!Number.isInteger(config.oldTaskDays) || config.oldTaskDays < 1) {
    throw new Error("Config `oldTaskDays` must be a positive integer.");
  }

  return config;
}

function parsePositiveInt(value: unknown, fieldName: string): number {
  if (value == null) {
    return DEFAULT_CONFIG.oldTaskDays;
  }
  if (typeof value === "number") {
    if (Number.isInteger(value) && value > 0) {
      return value;
    }
    throw new Error(`Config \`${fieldName}\` must be a positive integer.`);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
    throw new Error(`Config \`${fieldName}\` must be a positive integer.`);
  }
  throw new Error(`Config \`${fieldName}\` must be a positive integer.`);
}
