import fs from "node:fs";
import path from "node:path";
import { validateCommandLine } from "../plugins/registry.js";
import { COMMAND_LISTS, type CommandList, type LaneCommands } from "../plugins/types.js";
import type { BaseConfig, LanesConfig } from "./types.js";

export const CONFIG_FILE = ".lanes.json";

// A command document, or the part of a config that one can replace.
export type CommandDocument = Partial<LaneCommands> & { plugins?: Record<string, string> };

export const DEFAULT_BASE_REF = "origin/main";
export const DEFAULT_LANES_DIR = "lanes";

export const DEFAULT_BASE: BaseConfig = {
  name: "base",
  folder: ".",
  ref: DEFAULT_BASE_REF,
  lanesDir: DEFAULT_LANES_DIR
};

// A fresh config opens nothing until `lanes init` or a hand edit says what to run.
export const DEFAULT_CONFIG: LanesConfig = {
  lanePrefix: "",
  branchPrefix: "",
  oldLaneDays: 14,
  bases: [DEFAULT_BASE],
  open: []
};

// Base names end up in folder names and in the file names plugin commands write, so
// they are kept to the characters those accept verbatim.
export const BASE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export function getConfigPath(repoRoot: string): string {
  return path.join(repoRoot, CONFIG_FILE);
}

export function readConfig(repoRoot: string): LanesConfig {
  const configPath = getConfigPath(repoRoot);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing ${CONFIG_FILE}. Run \`lanes init\` first.`);
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

export function writeConfig(repoRoot: string, partialConfig: Partial<LanesConfig>): string {
  const normalized = normalizeConfig(partialConfig);
  const configPath = getConfigPath(repoRoot);
  fs.writeFileSync(configPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return configPath;
}

export function findBase(config: LanesConfig, name: string): BaseConfig {
  const base = config.bases.find((candidate) => candidate.name === name);
  if (!base) {
    throw new Error(`Unknown base '${name}'. Configured bases: ${baseNames(config).join(", ")}.`);
  }
  return base;
}

export function baseNames(config: LanesConfig): string[] {
  return config.bases.map((base) => base.name);
}

// A base's lists, each its own or the shared top-level one.
export function resolveBaseCommands(config: LanesConfig, base: BaseConfig): LaneCommands {
  return {
    open: base.open ?? config.open ?? [],
    create: base.create ?? config.create ?? [],
    remove: base.remove ?? config.remove ?? []
  };
}

export function resolveBranchPrefix(config: LanesConfig, base: BaseConfig): string {
  return base.branchPrefix ?? config.branchPrefix;
}

export function normalizeConfig(input: unknown): LanesConfig {
  const inputRecord = (input ?? {}) as Record<string, unknown>;
  const oldLaneDays = parsePositiveInt(inputRecord.oldLaneDays, "oldLaneDays");
  const bases = parseBases(inputRecord);
  const config: LanesConfig = {
    lanePrefix: String(inputRecord.lanePrefix ?? DEFAULT_CONFIG.lanePrefix).trim(),
    branchPrefix: String(inputRecord.branchPrefix ?? DEFAULT_CONFIG.branchPrefix).trim(),
    oldLaneDays,
    bases,
    ...parseCommandLists(inputRecord, "")
  };
  const plugins = parsePlugins(inputRecord.plugins, "plugins");
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

  if (!Number.isInteger(config.oldLaneDays) || config.oldLaneDays < 1) {
    throw new Error("Config `oldLaneDays` must be a positive integer.");
  }

  return config;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// `"plugins": { "<name>": "<git URL or path>" }`.
function parsePlugins(value: unknown, label: string): Record<string, string> {
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

function parseBases(record: Record<string, unknown>): BaseConfig[] {
  if (!Array.isArray(record.bases)) {
    throw new Error("Config `bases` must be an array of base definitions.");
  }
  if (record.bases.length === 0) {
    throw new Error("Config `bases` must define at least one base.");
  }

  const bases = record.bases.map((entry, index) => parseBase(entry, index));

  const seenNames = new Set<string>();
  for (const base of bases) {
    if (seenNames.has(base.name)) {
      throw new Error(`Config \`bases\` has more than one base named '${base.name}'.`);
    }
    seenNames.add(base.name);
  }

  // Lane folders are attributed to a base by location, so one base's lanes directory
  // may not be (or contain) another's.
  for (const base of bases) {
    for (const other of bases) {
      if (base !== other && isSameOrInside(other.lanesDir, base.lanesDir)) {
        throw new Error(
          `Config \`bases\`: lanesDir '${other.lanesDir}' of base '${other.name}' is inside lanesDir '${base.lanesDir}' of base '${base.name}'; each base needs its own lanes directory.`
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

function parseBase(entry: unknown, index: number): BaseConfig {
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

  const lanesDir = typeof record.lanesDir === "string" ? record.lanesDir.trim() : "";
  if (!lanesDir) {
    throw new Error(`Config \`${label}.lanesDir\` must be a non-empty string.`);
  }

  const base: BaseConfig = { name, folder, ref, lanesDir };

  if (record.branchPrefix != null) {
    if (typeof record.branchPrefix !== "string") {
      throw new Error(`Config \`${label}.branchPrefix\` must be a string.`);
    }
    base.branchPrefix = record.branchPrefix.trim();
  }

  Object.assign(base, parseCommandLists(record, `${label}.`));

  const source = record.template;
  if (source != null && source !== "") {
    if (typeof source !== "string") {
      throw new Error(`Config \`${label}.template\` must be a string (file path or URL).`);
    }
    base.template = source.trim();
  }

  return base;
}

// The `open`, `create` and `remove` lists of a config, a base, or a document.
function parseCommandLists(record: Record<string, unknown>, prefix: string): Partial<LaneCommands> {
  const lists: Partial<LaneCommands> = {};
  for (const list of COMMAND_LISTS) {
    if (record[list] != null) {
      lists[list] = parseCommandList(record[list], `${prefix}${list}`);
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

// A document is a JSON object with any of `open`, `create` and `remove` (and `plugins`), or
// a bare array of `open` lines. Anything else in the object is ignored, so another
// workspace's .lanes.json works as a source too.
export function parseOpenDocument(text: string, label: string): CommandDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  if (Array.isArray(parsed)) {
    return { open: parseCommandList(parsed, label) };
  }
  if (isRecord(parsed)) {
    const document: CommandDocument = parseCommandLists(parsed, `${label}.`);
    const plugins = parsePlugins(parsed.plugins, `${label}.plugins`);
    if (Object.keys(plugins).length > 0) {
      document.plugins = plugins;
    }
    if (Object.keys(document).length > 0) {
      return document;
    }
  }
  throw new Error(`${label} must be a JSON object with "open", "create" or "remove" command lists.`);
}

export function listLabel(list: CommandList): string {
  return { open: "when a lane opens", create: "once after a lane is created", remove: "before a lane is removed" }[list];
}

function parsePositiveInt(value: unknown, fieldName: string): number {
  if (value == null) {
    return DEFAULT_CONFIG.oldLaneDays;
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
