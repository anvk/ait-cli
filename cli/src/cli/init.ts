import fs from "node:fs";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import pc from "picocolors";
import {
  BASE_NAME_PATTERN,
  DEFAULT_BASE,
  DEFAULT_BASE_REF,
  DEFAULT_CONFIG,
  DEFAULT_TASKS_DIR,
  getConfigPath,
  listLabel,
  normalizeConfig,
  type CommandDocument,
  readConfig,
  resolveBaseCommands,
  writeConfig
} from "../core/config.js";
import { ensurePlugins } from "../plugins/ensure.js";
import { installedPlugins, validateCommandLine } from "../plugins/registry.js";
import { laneWords } from "../hooks/run.js";
import { shellJoin } from "../hooks/shell.js";
import { loadCommandsFromSource } from "../hooks/source.js";
import { DEFAULT_TEMPLATE } from "../hooks/templates.js";
import { COMMAND_LISTS, type CommandList, type Plugin, type TaskCommands } from "../plugins/types.js";
import type { BaseConfig, LaneConfig } from "../core/types.js";
import { errorMessage } from "../core/util.js";
import { NONE, Rewind, Wizard } from "./wizard.js";

const CLEAR_SCREEN = "\x1b[2J\x1b[H";

// Re-running `lane init` starts from the saved answers, so a workspace can be adjusted
// (another base, a different tab list) without editing the JSON by hand. A config that
// no longer parses is treated as absent and the defaults are offered instead.
function loadExistingConfig(repoRoot: string): LaneConfig | null {
  if (!fs.existsSync(getConfigPath(repoRoot))) {
    return null;
  }
  try {
    return readConfig(repoRoot);
  } catch (error) {
    console.log(pc.yellow(`Existing config could not be read, starting from defaults: ${errorMessage(error)}`));
    return null;
  }
}

export interface InitOptions {
  // Command lists to suggest for every base: a built-in template name, a path or a URL.
  template?: string;
}

export async function interactiveInit(repoRoot: string, options: InitOptions = {}): Promise<string> {
  const existing = loadExistingConfig(repoRoot);
  const folderCandidates = listFolderCandidates(repoRoot);

  if (!input.isTTY) {
    const firstFolder = folderCandidates[0] ?? DEFAULT_BASE.folder;
    return writeConfig(
      repoRoot,
      existing ?? { ...DEFAULT_CONFIG, bases: [{ ...DEFAULT_BASE, name: suggestBaseName(firstFolder), folder: firstFolder }] }
    );
  }

  const intro = [
    existing ? "Existing config found; press enter to keep each current value." : "",
    "Press esc at any question to return to the previous one (press it again to go further back)."
  ].filter(Boolean);

  let replay: string[] = [];
  // Nothing is written until the review is accepted. Esc unwinds to here, and the
  // questionnaire is re-run with the kept answers replayed (dimmed) up to the rewound
  // question, so the screen reads like the wizard went back in time.
  while (true) {
    for (const line of intro) {
      console.log(pc.dim(line));
    }
    const wizard = new Wizard(replay);
    try {
      const config = await askAll(wizard, repoRoot, existing, folderCandidates, options.template);
      return writeConfig(repoRoot, config);
    } catch (error) {
      if (!(error instanceof Rewind)) {
        throw error;
      }
      const answers = wizard.answers();
      replay = answers.slice(0, Math.max(0, answers.length - error.steps));
      output.write(CLEAR_SCREEN);
      console.log(pc.dim(`↶ back ${error.steps} question(s)`));
      console.log("");
    }
  }
}

async function askAll(
  wizard: Wizard,
  configDir: string,
  existing: LaneConfig | null,
  folderCandidates: string[],
  template: string | undefined
): Promise<LaneConfig> {
  const taskPrefix = await wizard.validated(
    "Task prefix (included literally)",
    existing?.taskPrefix ?? DEFAULT_CONFIG.taskPrefix,
    (value) => (value.trim() ? null : "The task prefix cannot be empty.")
  );
  const branchPrefix = await wizard.optional(
    "Branch prefix (optional, e.g. alex/)",
    existing?.branchPrefix ?? DEFAULT_CONFIG.branchPrefix
  );
  // The prefix is glued to the task name as-is, so `alex` (no slash) yields `alexLANE-1437`.
  if (branchPrefix && !/[\/_-]$/.test(branchPrefix)) {
    console.log(
      pc.yellow(
        `Branch prefix '${branchPrefix}' has no trailing separator, so branches will be named like '${branchPrefix}${taskPrefix}1437'.`
      )
    );
  }
  const oldTaskDays = await wizard.positiveInt(
    "Days before a task is considered old in task listings",
    existing?.oldTaskDays ?? DEFAULT_CONFIG.oldTaskDays
  );

  // A fresh workspace gets base suggestions from its folders; command lists are per base.
  const { bases, plugins } = await promptBases(wizard, configDir, existing?.bases ?? [], folderCandidates, template);

  const config: LaneConfig = { taskPrefix, branchPrefix, oldTaskDays, bases };
  const allPlugins = { ...existing?.plugins, ...plugins };
  if (Object.keys(allPlugins).length > 0) {
    config.plugins = allPlugins;
  }

  printSummary(config);
  if (!(await wizard.yesNo("Save this config? ('n' or esc returns to the last question)", true))) {
    // The "n" itself is not an answer to keep: drop it and rewind to the question before it.
    wizard.forget();
    throw new Rewind(1);
  }
  return config;
}

function printSummary(config: LaneConfig): void {
  console.log("");
  console.log(pc.cyan("Review"));
  console.log(`  Task prefix:    ${config.taskPrefix}`);
  console.log(`  Branch prefix:  ${config.branchPrefix || pc.dim("(none)")}`);
  console.log(`  Old task days:  ${config.oldTaskDays}`);
  for (const base of config.bases) {
    console.log("");
    console.log(`  Base ${pc.bold(base.name)}: ${base.folder} · ${base.ref} · ${base.tasksDir}`);
    const source = base.template ? pc.dim(` (from ${base.template})`) : "";
    printLists(resolveBaseCommands(config, base), "    ", source);
  }
  console.log("");
}

// `open:` and its lines, then `create:` and `remove:` when they have any.
function printLists(lists: Partial<TaskCommands>, indent: string, note = ""): void {
  for (const list of COMMAND_LISTS) {
    const lines = lists[list] ?? [];
    if (lines.length === 0 && list !== "open") {
      continue;
    }
    console.log(`${indent}${list} (${listLabel(list)})${list === "open" ? note : ""}:`);
    for (const line of lines) {
      console.log(`${indent}  ${line}`);
    }
    if (lines.length === 0) {
      console.log(`${indent}  ${pc.dim("(nothing)")}`);
    }
  }
}

async function promptBases(
  wizard: Wizard,
  configDir: string,
  current: BaseConfig[],
  folderCandidates: string[],
  template: string | undefined
): Promise<{ bases: BaseConfig[]; plugins: Record<string, string> }> {
  console.log("");
  console.log(pc.cyan("Base repositories: each is a git clone that tasks are created from."));

  // One base at a time, then "add another?", so the count never has to be known up
  // front. On a re-run the answer defaults to yes while saved bases remain.
  const bases: BaseConfig[] = [];
  // Where the plugins the lists use come from, as the loaded documents said.
  const plugins: Record<string, string> = {};
  for (let index = 0; ; index += 1) {
    const existingBase: BaseConfig | undefined = current[index];
    console.log("");
    console.log(pc.cyan(`Base ${index + 1}`));

    const usedFolders = new Set(bases.map((base) => path.normalize(base.folder)));
    const folderDefault =
      existingBase?.folder ??
      folderCandidates.find((candidate) => !usedFolders.has(path.normalize(candidate))) ??
      DEFAULT_BASE.folder;
    const folder = await wizard.validated("Git clone folder (relative to this directory)", folderDefault, () => null);

    const usedNames = new Set(bases.map((base) => base.name));
    const name = await wizard.validated(
      "Short name for this base (used in task paths and tab names)",
      existingBase?.name ?? suggestBaseName(folder, usedNames),
      (value) => {
        if (usedNames.has(value)) {
          return `Base name '${value}' is already used by another base.`;
        }
        return validateWith(() =>
          normalizeConfig({
            bases: [{ name: value, folder, ref: DEFAULT_BASE_REF, tasksDir: "x", open: [] }]
          })
        );
      }
    );

    const ref = await wizard.validated("Base git ref for new tasks", existingBase?.ref ?? DEFAULT_BASE_REF, () => null);

    // Always per-base (`tasks/web`), since a plain `tasks` would block adding a second
    // base later without moving folders around.
    const tasksDirDefault = existingBase?.tasksDir ?? path.join(DEFAULT_TASKS_DIR, name);
    const tasksDir = await wizard.validated("Tasks directory (relative to this directory)", tasksDirDefault, (value) =>
      validateWith(() =>
        normalizeConfig({
          bases: [...bases, { name, folder, ref, tasksDir: value }].map((base) => ({ ...base, open: base.open ?? [] }))
        })
      )
    );

    const base: BaseConfig = { name, folder, ref, tasksDir };
    // The branch prefix override is only editable in the JSON, so a re-run keeps it.
    if (existingBase?.branchPrefix != null) {
      base.branchPrefix = existingBase.branchPrefix;
    }

    const answer = await promptBaseCommands(wizard, configDir, base, existingBase, bases, template);
    for (const list of COMMAND_LISTS) {
      if (answer.lists[list]) {
        base[list] = answer.lists[list];
      }
    }
    Object.assign(plugins, answer.lists.plugins);
    if (answer.source) {
      base.template = answer.source;
    }
    bases.push(base);

    if (!(await wizard.addAnother("Add another base repository?", current.length > index + 1))) {
      return { bases, plugins };
    }
  }
}

interface CommandsAnswer {
  lists: CommandDocument;
  source?: string;
}

// Three ways to get a base's command lists, cheapest first: copy an earlier base, load a
// built-in template or a document from a file or URL, or type them in one by one.
async function promptBaseCommands(
  wizard: Wizard,
  configDir: string,
  base: BaseConfig,
  existingBase: BaseConfig | undefined,
  earlier: BaseConfig[],
  template: string | undefined
): Promise<CommandsAnswer> {
  console.log("");
  console.log(pc.cyan(`Commands run for tasks in base '${base.name}'`));

  // Copying carries the source along, so both bases keep following the same document.
  const copyFrom = await promptCopyFrom(wizard, existingBase, earlier);
  if (copyFrom) {
    return { lists: copyLists(copyFrom), source: copyFrom.template };
  }

  // The template given to `lane init`, else the one the base already follows. Lists that
  // were typed in by hand are kept by default rather than replaced by a template.
  const suggested = template ?? existingBase?.template ?? (existingBase?.open ? NONE : DEFAULT_TEMPLATE);
  while (true) {
    const answer = await wizard.ask(
      `Command lists to load ('${DEFAULT_TEMPLATE}' for Claude and Terminal tabs, a file path or URL; 'none' to set them up by hand)`,
      suggested
    );
    const source = answer === NONE ? "" : answer;
    if (!source) {
      return { lists: await promptCommandLists(wizard, existingBase) };
    }

    let lists: CommandDocument;
    try {
      lists = await loadCommandsFromSource(source, configDir);
    } catch (error) {
      console.log(pc.yellow(errorMessage(error)));
      continue;
    }

    const count = COMMAND_LISTS.reduce((sum, list) => sum + (lists[list]?.length ?? 0), 0);
    console.log(pc.green(`Loaded ${count} command(s):`));
    printLists(lists, "  ");
    if (await wizard.yesNo(`Use these ${count} command(s)?`, true)) {
      // The document may need a plugin that is not installed yet; offer it now rather
      // than at the first task.
      if (lists.plugins) {
        await ensurePlugins({ ...DEFAULT_CONFIG, bases: [{ ...base, open: lists.open ?? [] }], plugins: lists.plugins });
      }
      return { lists, source };
    }
  }
}

function copyLists(from: BaseConfig): Partial<TaskCommands> {
  const lists: Partial<TaskCommands> = {};
  for (const list of COMMAND_LISTS) {
    if (from[list]) {
      lists[list] = [...from[list]];
    }
  }
  return lists;
}

async function promptCopyFrom(
  wizard: Wizard,
  existingBase: BaseConfig | undefined,
  earlier: BaseConfig[]
): Promise<BaseConfig | null> {
  const withLists = earlier.filter((base) => base.open);
  if (withLists.length === 0) {
    return null;
  }
  // On a re-run, default to copying when the saved lists (and source) already match an earlier base.
  const matching = withLists.find(
    (base) =>
      existingBase?.open &&
      JSON.stringify(copyLists(base)) === JSON.stringify(copyLists(existingBase)) &&
      base.template === existingBase.template
  );

  if (withLists.length === 1) {
    const [only] = withLists;
    return (await wizard.yesNo(`Copy the commands of base '${only.name}'?`, matching === only)) ? only : null;
  }
  const answer = await wizard.choice(
    "Copy the commands of an earlier base?",
    [NONE, ...withLists.map((base) => base.name)],
    matching?.name ?? NONE
  );
  return answer === NONE ? null : (withLists.find((base) => base.name === answer) ?? null);
}

async function promptCommandLists(wizard: Wizard, existingBase: BaseConfig | undefined): Promise<Partial<TaskCommands>> {
  const lists: Partial<TaskCommands> = { open: await promptOpenList(wizard, existingBase?.open ?? []) };
  for (const list of ["create", "remove"] as const) {
    const lines = await promptLineList(wizard, list, existingBase?.[list] ?? []);
    if (lines.length > 0) {
      lists[list] = lines;
    }
  }
  return lists;
}

// The `open` list, one entry at a time. An installed plugin that can ask its own
// questions (Warp's title, folder and color) is offered next to a plain command line.
async function promptOpenList(wizard: Wizard, current: string[]): Promise<string[]> {
  const askers = installedPlugins().filter((plugin) => plugin.prompt);
  console.log("");
  console.log(pc.cyan(`Commands run ${listLabel("open")} (e.g. cursor .${askers.length ? `, or a ${askers.map((plugin) => plugin.name).join("/")} entry` : ""})`));
  const lines: string[] = [];
  for (let index = 0; ; index += 1) {
    const existingLine: string | undefined = current[index];
    const existingWords = existingLine ? laneWords(existingLine) : null;
    const existingPlugin = askers.find((plugin) => plugin.name === existingWords?.[0]);
    console.log("");
    console.log(pc.cyan(`Entry ${index + 1}`));

    let plugin: Plugin | undefined;
    if (askers.length > 0) {
      const kind = await wizard.choice(
        "Kind",
        ["command", ...askers.map((candidate) => candidate.name)],
        existingPlugin?.name ?? "command"
      );
      plugin = askers.find((candidate) => candidate.name === kind);
    }
    const line = plugin
      ? shellJoin(["lane", plugin.name, ...(await plugin.prompt!(wizard, existingPlugin === plugin ? existingWords!.slice(1) : undefined))])
      : await wizard.validated("Command to run in the task folder (e.g. cursor .)", existingLine, (value) =>
          validateWith(() => validateCommandLine(value, "command"))
        );
    lines.push(line);

    if (!(await wizard.addAnother("Add another entry?", current.length > index + 1))) {
      return lines;
    }
  }
}

// The `create` or `remove` list: command lines until 'none'.
async function promptLineList(wizard: Wizard, list: CommandList, current: string[]): Promise<string[]> {
  console.log("");
  console.log(pc.cyan(`Commands run ${listLabel(list)} ('none' when there are no more)`));
  const lines: string[] = [];
  for (let index = 0; ; index += 1) {
    const answer = await wizard.validated(`Command ${index + 1}`, current[index] ?? NONE, (value) =>
      value === NONE ? null : validateWith(() => validateCommandLine(value, "command"))
    );
    if (answer === NONE) {
      return lines;
    }
    lines.push(answer);
  }
}

function validateWith(check: () => unknown): string | null {
  try {
    check();
    return null;
  } catch (error) {
    return errorMessage(error);
  }
}

// Non-hidden subfolders, sorted: the first is the likely base folder in a fresh
// workspace, and later ones are offered for additional bases.
function listFolderCandidates(configDir: string): string[] {
  const absoluteDir = path.resolve(configDir);
  return fs
    .readdirSync(absoluteDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

// `api-base` → `api`, `web-base` → `web`; anything else keeps its folder name.
function suggestBaseName(folder: string, used: Set<string> = new Set()): string {
  const folderName = path.basename(path.resolve(folder));
  const stripped = folderName.replace(/[-_.]base$/i, "");
  const candidates = [stripped, folderName, DEFAULT_BASE.name].filter(
    (candidate) => candidate && BASE_NAME_PATTERN.test(candidate)
  );
  return candidates.find((candidate) => !used.has(candidate)) ?? `${DEFAULT_BASE.name}${used.size + 1}`;
}
