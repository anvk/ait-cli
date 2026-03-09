import fs from "node:fs";
import path from "node:path";
import { run } from "./process.js";
import type { AitConfig } from "./types.js";

export const CONFIG_FILE = ".ait.json";

export const DEFAULT_CONFIG: AitConfig = {
  prefix: "AIT",
  tasksDir: "tasks",
  baseRef: "origin/main",
  baseFolder: "."
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
  const merged = { ...DEFAULT_CONFIG, ...(input as Partial<AitConfig>) };
  const config: AitConfig = {
    prefix: String(merged.prefix || DEFAULT_CONFIG.prefix).trim(),
    tasksDir: String(merged.tasksDir || DEFAULT_CONFIG.tasksDir).trim(),
    baseRef: String(merged.baseRef || DEFAULT_CONFIG.baseRef).trim(),
    baseFolder: String(merged.baseFolder || DEFAULT_CONFIG.baseFolder).trim()
  };

  if (!config.prefix) {
    throw new Error("Config `prefix` cannot be empty.");
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

  return config;
}
