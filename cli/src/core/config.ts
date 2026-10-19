import fs from "node:fs";
import path from "node:path";
import { shellJoin, shellQuote } from "../hooks/shell.js";
import { validateCommandLine } from "../plugins/registry.js";
import { COMMAND_LISTS, type CommandList, type TaskCommands } from "../plugins/types.js";
import type { BaseConfig, LaneConfig } from "./types.js";

export const CONFIG_FILE = ".lane.json";

// The one plugin lane knows by name, and only here: a config written before command lists
// (`warpTabs`) can only mean Warp, so its conversion also says where Warp comes from.
export const WARP_PLUGIN_SOURCE = "https://github.com/anvk/lane-cli.git#plugins/warp";
const LEGACY_WARP_COLORS = ["red", "green", "yellow", "blue", "magenta", "cyan"];

// A command document, or the part of a config that one can replace.
export type CommandDocument = Partial<TaskCommands> & { plugins?: Record<string, string> };

export const DEFAULT_BASE_REF = "origin/main";
export const DEFAULT_TASKS_DIR = "tasks";

export const DEFAULT_BASE: BaseConfig = {
  name: "base",
  folder: ".",
  ref: DEFAULT_BASE_REF,
  tasksDir: DEFAULT_TASKS_DIR
};

// A fresh config opens nothing until `lane init` or a hand edit says what to run.
export const DEFAULT_CONFIG: LaneConfig = {
  taskPrefix: "LANE-",
  branchPrefix: "",
  oldTaskDays: 14,
  bases: [DEFAULT_BASE],
  open: []
};

// Base names end up in folder names and in the file names plugin commands write, so
// they are kept to the characters those accept verbatim.
export const BASE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export function getConfigPath(repoRoot: string): string {
  return path.join(repoRoot, CONFIG_FILE);
}

export function readConfig(repoRoot: string): LaneConfig {
  const configPath = getConfigPath(repoRoot);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing ${CONFIG_FILE}. Run \`lane init\` first.`);
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

export function writeConfig(repoRoot: string, partialConfig: Partial<LaneConfig>): string {
  const normalized = normalizeConfig(partialConfig);
  const configPath = getConfigPath(repoRoot);
  fs.writeFileSync(configPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return configPath;
}

export function findBase(config: LaneConfig, name: string): BaseConfig {
  const base = config.bases.find((candidate) => candidate.name === name);
  if (!base) {
    throw new Error(`Unknown base '${name}'. Configured bases: ${baseNames(config).join(", ")}.`);
  }
  return base;
}

export function baseNames(config: LaneConfig): string[] {
  return config.bases.map((base) => base.name);
}

// A base's lists, each its own or the shared top-level one.
export function resolveBaseCommands(config: LaneConfig, base: BaseConfig): TaskCommands {
  return {
    open: base.open ?? config.open ?? [],
    create: base.create ?? config.create ?? [],
    remove: base.remove ?? config.remove ?? []
  };
}

export function resolveBranchPrefix(config: LaneConfig, base: BaseConfig): string {
  return base.branchPrefix ?? config.branchPrefix;
}

export function normalizeConfig(input: unknown): LaneConfig {
  const inputRecord = (input ?? {}) as Record<string, unknown>;
  const oldTaskDays = parsePositiveInt(inputRecord.oldTaskDays, "oldTaskDays");
  // `warpTabGroup` predates command lists; it becomes `--group` on every converted tab.
  const group = parseBoolean(inputRecord.warpTabGroup, "warpTabGroup");
  const bases = parseBases(inputRecord, group);
  const config: LaneConfig = {
    taskPrefix: String(inputRecord.taskPrefix ?? DEFAULT_CONFIG.taskPrefix).trim(),
    branchPrefix: String(inputRecord.branchPrefix ?? DEFAULT_CONFIG.branchPrefix).trim(),
    oldTaskDays,
    bases,
    ...parseCommandLists(inputRecord, "", group)
  };
  const plugins = parsePlugins(inputRecord.plugins, "plugins");
  const legacyWarp =
    inputRecord.warpTabs !== undefined ||
    (Array.isArray(inputRecord.bases) && inputRecord.bases.some((entry) => isRecord(entry) && entry.warpTabs !== undefined));
  if (legacyWarp && !plugins.warp) {
    plugins.warp = WARP_PLUGIN_SOURCE;
  }
  if (Object.keys(plugins).length > 0) {
    config.plugins = plugins;
  }

  // Every base needs something to open with, its own or the shared top-level list.
  bases.forEach((base, index) => {
    if (!base.open && !config.open) {
      throw new Error(
        `Config \`bases[${index}]\` ('${base.name}') has no \`open\` commands and there is no top-level \`open\` to fall back on.`
      );
    }
  });

  if (!config.taskPrefix) {
    throw new Error("Config `taskPrefix` cannot be empty.");
  }
  if (!Number.isInteger(config.oldTaskDays) || config.oldTaskDays < 1) {
    throw new Error("Config `oldTaskDays` must be a positive integer.");
  }

  return config;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// `"plugins": { "<name>": "<git URL or path>" }`.
export function parsePlugins(value: unknown, label: string): Record<string, string> {
  if (value == null) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error(`Config \`${label}\` must be an object mapping plugin names to sources.`);
  }
  const plugins: Record<string, string> = {};
  for (const [name, source] of Object.entries(value)) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      throw new Error(`Config \`${label}\`: '${name}' is not a plugin name (lowercase letters, digits and dashes).`);
    }
    if (typeof source !== "string" || !source.trim()) {
      throw new Error(`Config \`${label}.${name}\` must be a git URL or a path.`);
    }
    plugins[name] = source.trim();
  }
  return plugins;
}

function parseBases(record: Record<string, unknown>, group: boolean): BaseConfig[] {
  if (record.bases == null && record.baseFolder != null) {
    throw new Error("This .lane.json uses the format from before multiple bases. Run `lane init` to rewrite it.");
  }
  if (!Array.isArray(record.bases)) {
    throw new Error("Config `bases` must be an array of base definitions.");
  }
  if (record.bases.length === 0) {
    throw new Error("Config `bases` must define at least one base.");
  }

  const bases = record.bases.map((entry, index) => parseBase(entry, index, group));

  const seenNames = new Set<string>();
  for (const base of bases) {
    if (seenNames.has(base.name)) {
      throw new Error(`Config \`bases\` has more than one base named '${base.name}'.`);
    }
    seenNames.add(base.name);
  }

  // Task folders are attributed to a base by location, so one base's tasks directory
  // may not be (or contain) another's.
  for (const base of bases) {
    for (const other of bases) {
      if (base !== other && isSameOrInside(other.tasksDir, base.tasksDir)) {
        throw new Error(
          `Config \`bases\`: tasksDir '${other.tasksDir}' of base '${other.name}' is inside tasksDir '${base.tasksDir}' of base '${base.name}'; each base needs its own tasks directory.`
        );
      }
    }
  }

  return bases;
}

function isSameOrInside(childDir: string, parentDir: string): boolean {
  const relative = path.relative(path.normalize(parentDir), path.normalize(childDir));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parseBase(entry: unknown, index: number, group: boolean): BaseConfig {
  const label = `bases[${index}]`;
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    throw new Error(`Config \`${label}\` must be an object.`);
  }
  const record = entry as Record<string, unknown>;

  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!name) {
    throw new Error(`Config \`${label}.name\` must be a non-empty string.`);
  }
  if (!BASE_NAME_PATTERN.test(name)) {
    throw new Error(`Config \`${label}.name\` may only contain letters, digits, '.', '_' and '-': ${name}`);
  }

  const folder = typeof record.folder === "string" ? record.folder.trim() : "";
  if (!folder) {
    throw new Error(`Config \`${label}.folder\` must be a non-empty string.`);
  }

  const ref = typeof record.ref === "string" ? record.ref.trim() : "";
  if (!ref) {
    throw new Error(`Config \`${label}.ref\` must be a non-empty string (for example "origin/main").`);
  }

  const tasksDir = typeof record.tasksDir === "string" ? record.tasksDir.trim() : "";
  if (!tasksDir) {
    throw new Error(`Config \`${label}.tasksDir\` must be a non-empty string.`);
  }

  const base: BaseConfig = { name, folder, ref, tasksDir };

  if (record.branchPrefix != null) {
    if (typeof record.branchPrefix !== "string") {
      throw new Error(`Config \`${label}.branchPrefix\` must be a string.`);
    }
    base.branchPrefix = record.branchPrefix.trim();
  }

  Object.assign(base, parseCommandLists(record, `${label}.`, group));

  // `warpTabsSource` is the name from before lists other than Warp tabs existed.
  const source = record.template ?? record.warpTabsSource;
  if (source != null && source !== "") {
    if (typeof source !== "string") {
      throw new Error(`Config \`${label}.template\` must be a string (file path or URL).`);
    }
    base.template = source.trim();
  }

  return base;
}

// The `open`, `create` and `remove` lists of a config or a base, or of a document. A
// `warpTabs` list from before (each tab an object) becomes `lane warp tab` lines, and its
// `teardownCommand`s become `remove` lines, so older configs and documents still read.
export function parseCommandLists(record: Record<string, unknown>, prefix: string, group: boolean): Partial<TaskCommands> {
  const lists: Partial<TaskCommands> = {};
  for (const list of COMMAND_LISTS) {
    if (record[list] != null) {
      lists[list] = parseCommandList(record[list], `${prefix}${list}`);
    }
  }
  if (record.warpTabs !== undefined && lists.open === undefined) {
    const converted = legacyTabsToCommands(record.warpTabs, `${prefix}warpTabs`, group);
    lists.open = converted.open;
    if (converted.remove.length > 0 && lists.remove === undefined) {
      lists.remove = converted.remove;
    }
  }
  return lists;
}

function parseCommandList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Config \`${label}\` must be an array of command lines.`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new Error(`Config \`${label}[${index}]\` must be a command line (a string).`);
    }
    const line = entry.trim();
    validateCommandLine(line, `${label}[${index}]`);
    return line;
  });
}

// A document is a JSON object with any of `open`, `create` and `remove`, or one of the
// older forms: a bare array of Warp tabs, or an object with `warpTabs`. Anything else in
// the object is ignored, so another workspace's .lane.json works as a source too.
export function parseOpenDocument(text: string, label: string): CommandDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  if (Array.isArray(parsed)) {
    if (parsed.every((entry) => typeof entry === "string")) {
      return { open: parseCommandList(parsed, label) };
    }
    const converted = legacyTabsToCommands(parsed, label, false);
    return {
      open: converted.open,
      ...(converted.remove.length > 0 ? { remove: converted.remove } : {}),
      plugins: { warp: WARP_PLUGIN_SOURCE }
    };
  }
  if (isRecord(parsed)) {
    const document: CommandDocument = parseCommandLists(parsed, `${label}.`, parseBoolean(parsed.warpTabGroup, `${label}.warpTabGroup`));
    const plugins = parsePlugins(parsed.plugins, `${label}.plugins`);
    if (parsed.warpTabs !== undefined && !plugins.warp) {
      plugins.warp = WARP_PLUGIN_SOURCE;
    }
    if (Object.keys(plugins).length > 0) {
      document.plugins = plugins;
    }
    if (Object.keys(document).length > 0) {
      return document;
    }
  }
  throw new Error(`${label} must be a JSON object with "open", "create" or "remove" command lists.`);
}

function legacyTabsToCommands(value: unknown, label: string, group: boolean): { open: string[]; remove: string[] } {
  if (!Array.isArray(value)) {
    throw new Error(`Config \`${label}\` must be an array of tab definitions.`);
  }
  const open: string[] = [];
  const remove: string[] = [];
  value.forEach((entry, index) => {
    const tab = parseLegacyTab(entry, `${label}[${index}]`);
    open.push(shellJoin([...tab.words, ...(group ? ["--group"] : [])]));
    if (tab.teardown) {
      remove.push(tab.path === "." ? tab.teardown : `cd ${shellQuote(tab.path)} && ${tab.teardown}`);
    }
  });
  return { open, remove };
}

// One tab object of the old format as the words of a `lane warp tab …` line. Only the
// shape is checked here; the Warp plugin validates the line once it is installed.
function parseLegacyTab(entry: unknown, label: string): { words: string[]; path: string; teardown?: string } {
  if (!isRecord(entry)) {
    throw new Error(`Config \`${label}\` must be an object.`);
  }
  const title = typeof entry.title === "string" ? entry.title.trim() : "";
  if (!title) {
    throw new Error(`Config \`${label}.title\` must be a non-empty string.`);
  }
  const rawPath = typeof entry.path === "string" ? entry.path.trim() : "";
  if (!rawPath) {
    throw new Error(`Config \`${label}.path\` must be a non-empty string (use "." for the task root).`);
  }
  const tabPath = path.normalize(rawPath).replace(/(.)\/+$/, "$1");
  const words = ["lane", "warp", "tab", title];
  if (tabPath !== ".") {
    words.push("--path", tabPath);
  }
  if (entry.color != null && entry.color !== "") {
    const color = String(entry.color).trim().toLowerCase();
    if (!LEGACY_WARP_COLORS.includes(color)) {
      throw new Error(`Config \`${label}.color\` must be one of: ${LEGACY_WARP_COLORS.join(", ")} (Warp only supports these tab colors).`);
    }
    words.push("--color", color);
  }
  for (const [field, flag] of [
    ["command", "--command"],
    ["setupCommand", "--setup"]
  ] as const) {
    const value = entry[field];
    if (value == null || value === "") {
      continue;
    }
    if (typeof value !== "string") {
      throw new Error(`Config \`${label}.${field}\` must be a string.`);
    }
    words.push(flag, value.trim());
  }
  const teardown = entry.teardownCommand;
  if (teardown != null && teardown !== "" && typeof teardown !== "string") {
    throw new Error(`Config \`${label}.teardownCommand\` must be a string.`);
  }
  return { words, path: tabPath, teardown: typeof teardown === "string" && teardown.trim() ? teardown.trim() : undefined };
}

export function listLabel(list: CommandList): string {
  return { open: "when a task opens", create: "once after a task is created", remove: "before a task is removed" }[list];
}

function parseBoolean(value: unknown, fieldName: string): boolean {
  if (value == null) {
    return false;
  }
  if (typeof value === "boolean") {
    return value;
  }
  throw new Error(`Config \`${fieldName}\` must be true or false.`);
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
