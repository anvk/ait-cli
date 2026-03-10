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
    const taskPrefix = await promptWithDefault(rl, "Task prefix (included literally)", DEFAULT_CONFIG.taskPrefix);
    const branchPrefix = await promptWithDefault(
      rl,
      "Branch prefix (optional, e.g. alex/)",
      DEFAULT_CONFIG.branchPrefix
    );
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
    const oldTaskDaysRaw = await promptWithDefault(
      rl,
      "Days before a task is considered old in task listings",
      String(DEFAULT_CONFIG.oldTaskDays)
    );
    const oldTaskDays = Number.parseInt(oldTaskDaysRaw, 10);
    if (!Number.isInteger(oldTaskDays) || oldTaskDays < 1) {
      throw new Error("`oldTaskDays` must be a positive integer.");
    }

    const configPath = writeConfig(repoRoot, {
      taskPrefix,
      branchPrefix,
      tasksDir,
      baseRef,
      baseFolder,
      oldTaskDays
    });
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
