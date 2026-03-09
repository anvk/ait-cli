import readline from "node:readline/promises";
import fs from "node:fs";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { DEFAULT_CONFIG, getConfigPath, writeConfig } from "./config.js";

async function promptWithDefault(
  rl: readline.Interface,
  label: string,
  defaultValue: string
): Promise<string> {
  const answer = await rl.question(`${label} (${defaultValue}): `);
  const trimmed = answer.trim();
  return trimmed || defaultValue;
}

export async function interactiveInit(repoRoot: string): Promise<string> {
  const baseFolderSuggestion = suggestBaseFolder(repoRoot);

  if (!input.isTTY) {
    return writeConfig(repoRoot, { ...DEFAULT_CONFIG, baseFolder: baseFolderSuggestion });
  }

  const rl = readline.createInterface({ input, output });
  try {
    const prefix = await promptWithDefault(rl, "Task prefix", DEFAULT_CONFIG.prefix);
    const tasksDir = await promptWithDefault(
      rl,
      "Tasks directory (relative to repo root)",
      DEFAULT_CONFIG.tasksDir
    );
    const baseRef = await promptWithDefault(
      rl,
      "Base git ref for new tasks",
      DEFAULT_CONFIG.baseRef
    );
    const baseFolder = await promptWithDefault(
      rl,
      "Base git folder (relative to this config directory)",
      baseFolderSuggestion
    );

    const configPath = writeConfig(repoRoot, { prefix, tasksDir, baseRef, baseFolder });
    return configPath;
  } finally {
    rl.close();
  }
}

export function existingConfigPath(repoRoot: string): string {
  return getConfigPath(repoRoot);
}

function suggestBaseFolder(configDir: string): string {
  const absoluteDir = path.resolve(configDir);
  const entries = fs
    .readdirSync(absoluteDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();

  return entries[0] ?? DEFAULT_CONFIG.baseFolder;
}
