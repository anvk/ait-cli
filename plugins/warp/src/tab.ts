// `lanes warp tab`: one Warp tab as a command line. Run by lanes while opening a lane, the
// tabs of a list are staged and opened together at the end (so they share a window or a
// group); run from a shell, it opens one tab right away.
import fs from "node:fs";
import path from "node:path";
import { Command, CommanderError, InvalidArgumentError } from "commander";
import pc from "picocolors";
import { ENV } from "lanes-plugin-api";
import { isDirectory, run, shellJoin } from "./support.js";
import { WARP_TAB_INTERVAL_MS, ensureWarpRunning } from "./app.js";
import {
  WARP_COLORS,
  buildLaunchConfigYaml,
  buildPaneNameCommand,
  buildTabConfigToml,
  getLaunchConfigName,
  getLaunchConfigsDir,
  getTabConfigsDir,
  getLaneConfigPrefix,
  removeTabConfigs,
  tabConfigName,
  type ResolvedWarpTab,
  type WarpColor
} from "./files.js";

export interface WarpTabSpec {
  title: string;
  // Folder relative to the lane root.
  path: string;
  color?: WarpColor;
  command?: string;
  // Runs in this tab only right after the lane was created, when the setup prompt was accepted.
  setup?: string;
  // Open the lane's tabs as one tab group named after the lane (always a new window).
  group: boolean;
  newWindow: boolean;
}

function parseColor(value: string): WarpColor {
  const color = value.trim().toLowerCase();
  if (!WARP_COLORS.includes(color as WarpColor)) {
    throw new InvalidArgumentError(`Warp only supports ${WARP_COLORS.join(", ")}.`);
  }
  return color as WarpColor;
}

function parsePath(value: string): string {
  const rawPath = value.trim();
  if (!rawPath) {
    throw new InvalidArgumentError('use "." for the lane root.');
  }
  if (path.isAbsolute(rawPath) || rawPath.startsWith("~")) {
    throw new InvalidArgumentError("must be relative to the lane folder.");
  }
  const normalized = path.normalize(rawPath).replace(/(.)\/+$/, "$1");
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new InvalidArgumentError("must stay inside the lane folder.");
  }
  return normalized;
}

// The command's definition, applied both to the real `lanes warp tab` and to a throwaway
// Command used to validate config lines.
export function configureTabCommand(command: Command): Command {
  return command
    .allowExcessArguments(false)
    .description("Open a Warp tab in the lane folder (staged until the list ends when run by lanes)")
    .argument("<title>", "Pane name; the lane name is appended")
    .option("--path <dir>", "Folder to open, relative to the lane root", parsePath, ".")
    .option("--color <color>", `One of ${WARP_COLORS.join(", ")}`, parseColor)
    .option("--command <cmd>", "Run when the tab opens, e.g. 'claude --continue'")
    .option("--setup <cmd>", "Run once in this tab right after the lane is created, if accepted")
    .option("--group", "Open the lane's tabs as a tab group named after the lane (always a new window)")
    .option("--new-window", "Open the tabs in a new Warp window");
}

interface TabOptions {
  path: string;
  color?: WarpColor;
  command?: string;
  setup?: string;
  group?: boolean;
  newWindow?: boolean;
}

function toSpec(title: string, options: TabOptions): WarpTabSpec {
  const spec: WarpTabSpec = {
    title: title.trim(),
    path: options.path,
    group: Boolean(options.group),
    newWindow: Boolean(options.newWindow)
  };
  if (!spec.title) {
    throw new Error("the tab title cannot be empty.");
  }
  if (options.color) {
    spec.color = options.color;
  }
  if (options.command?.trim()) {
    spec.command = options.command.trim();
  }
  if (options.setup?.trim()) {
    spec.setup = options.setup.trim();
  }
  return spec;
}

// Parses the words after `lanes warp tab` without touching the process: a bad flag or
// color throws instead of printing and exiting, so configs can be checked when read.
export function parseTabWords(words: string[]): WarpTabSpec {
  let spec: WarpTabSpec | undefined;
  const command = configureTabCommand(new Command("tab"))
    .exitOverride()
    .configureOutput({ writeOut: () => {}, writeErr: () => {} })
    .action((title: string, options: TabOptions) => {
      spec = toSpec(title, options);
    });
  try {
    command.parse(words, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      throw new Error(error.message.replace(/^error:\s*/, ""));
    }
    throw error;
  }
  if (!spec) {
    throw new Error("the tab title is missing.");
  }
  return spec;
}

// The command line for a spec, as written to a config.
export function tabLine(spec: WarpTabSpec): string {
  const words = ["lanes", "warp", "tab", spec.title];
  if (spec.path !== ".") {
    words.push("--path", spec.path);
  }
  if (spec.color) {
    words.push("--color", spec.color);
  }
  if (spec.command) {
    words.push("--command", spec.command);
  }
  if (spec.setup) {
    words.push("--setup", spec.setup);
  }
  if (spec.group) {
    words.push("--group");
  }
  if (spec.newWindow) {
    words.push("--new-window");
  }
  return shellJoin(words);
}

// A tab ready to be written, plus the flags that decide how the batch opens.
interface StagedTab extends ResolvedWarpTab {
  title: string;
  group: boolean;
  newWindow: boolean;
}

interface TabContext {
  lanePath: string;
  key: string;
  label: string;
}

// lanes describes the lane through the environment; from a plain shell the current folder
// stands in for it.
function tabContext(): TabContext {
  const cwd = process.cwd();
  return {
    lanePath: process.env[ENV.lanePath] || cwd,
    key: process.env[ENV.laneKey] || path.basename(cwd),
    label: process.env[ENV.laneLabel] || process.env[ENV.lane] || path.basename(cwd)
  };
}

export function resolveTabFolder(lanePath: string, relative: string, title: string): string {
  const candidate = path.resolve(lanePath, relative);
  if (isDirectory(candidate)) {
    return candidate;
  }
  console.log(pc.yellow(`Tab '${title}' folder does not exist: ${candidate}\nUsing lane root instead.`));
  return lanePath;
}

function stageTab(spec: WarpTabSpec, ctx: TabContext, index: number): StagedTab {
  const cwd = resolveTabFolder(ctx.lanePath, spec.path, spec.title);
  const command = spec.command;
  const setup = process.env[ENV.runSetup] ? spec.setup : undefined;
  // Tab configs are rewritten on every open, so the setup command runs this once only.
  const tabCommand = [command, setup].filter(Boolean).join("; ");
  return {
    title: spec.title,
    configName: tabConfigName(ctx.key, index, spec.title),
    cwd,
    color: spec.color,
    commands: [buildPaneNameCommand(`${spec.title} - ${ctx.label}`), ...(tabCommand ? [tabCommand] : [])],
    group: spec.group,
    newWindow: spec.newWindow
  };
}

const STAGED_FILE = "warp.tabs";
const FLUSH_FILE = "warp.flush";

export function runTabCommand(spec: WarpTabSpec): void {
  const ctx = tabContext();
  const afterDir = process.env[ENV.afterDir];

  if (afterDir) {
    const stagedFile = path.join(afterDir, STAGED_FILE);
    const staged = readStaged(stagedFile);
    staged.push(stageTab(spec, ctx, staged.length));
    fs.writeFileSync(stagedFile, JSON.stringify(staged), "utf8");
    fs.writeFileSync(path.join(afterDir, FLUSH_FILE), "lanes warp flush\n", "utf8");
    return;
  }

  // Standalone: one more tab for whatever folder this is, after any already written.
  const tabConfigsDir = getTabConfigsDir();
  fs.mkdirSync(tabConfigsDir, { recursive: true });
  const prefix = getLaneConfigPrefix(ctx.key);
  const index = fs.readdirSync(tabConfigsDir).filter((entry) => entry.startsWith(prefix)).length;
  const tab = stageTab(spec, ctx, index);
  fs.writeFileSync(path.join(tabConfigsDir, `${tab.configName}.toml`), buildTabConfigToml(tab), "utf8");
  if (spec.group) {
    console.log(pc.yellow("--group only applies when a lane's tabs are opened together; opening a plain tab."));
  }
  ensureWarpRunning();
  run("open", [`warp://tab_config/${encodeURIComponent(tab.configName)}${spec.newWindow ? "?new_window=true" : ""}`]);
  console.log(pc.green(`Opened Warp tab '${spec.title}' in ${tab.cwd}.`));
}

function readStaged(file: string): StagedTab[] {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as StagedTab[];
  } catch {
    return [];
  }
}

// `lanes warp flush`: writes the staged tabs' files and opens them together.
export function runFlushCommand(): void {
  const afterDir = process.env[ENV.afterDir];
  const tabs = afterDir ? readStaged(path.join(afterDir, STAGED_FILE)) : [];
  if (tabs.length === 0) {
    return;
  }
  const ctx = tabContext();

  const tabConfigsDir = getTabConfigsDir();
  fs.mkdirSync(tabConfigsDir, { recursive: true });
  removeTabConfigs(ctx.key);
  for (const tab of tabs) {
    fs.writeFileSync(path.join(tabConfigsDir, `${tab.configName}.toml`), buildTabConfigToml(tab), "utf8");
  }

  if (tabs.some((tab) => tab.group)) {
    const launchConfigsDir = getLaunchConfigsDir();
    const launchConfigName = getLaunchConfigName(ctx.key);
    fs.mkdirSync(launchConfigsDir, { recursive: true });
    fs.writeFileSync(
      path.join(launchConfigsDir, `${launchConfigName}.yaml`),
      buildLaunchConfigYaml(launchConfigName, ctx.label, tabs),
      "utf8"
    );
    ensureWarpRunning();
    // Warp matches the URI against the file stem, not a path.
    run("open", [`warp://launch/${encodeURIComponent(launchConfigName)}`]);
    console.log(pc.green(`Opened ${tabs.length} Warp tab(s) for ${ctx.label} as a tab group in a new window.`));
    return;
  }

  ensureWarpRunning();
  const newWindow = tabs.some((tab) => tab.newWindow);
  tabs.forEach((tab, index) => {
    // Spacing the URIs apart keeps the tabs in the configured order.
    if (index > 0) {
      sleepSync(WARP_TAB_INTERVAL_MS);
    }
    // Only the first tab requests a window; the rest join it as the active window.
    const target = newWindow && index === 0 ? "?new_window=true" : "";
    run("open", [`warp://tab_config/${encodeURIComponent(tab.configName)}${target}`]);
  });
  console.log(pc.green(`Opened ${tabs.length} Warp tab(s) for ${ctx.label}.`));
}

function sleepSync(milliseconds: number): void {
  const buffer = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(buffer, 0, 0, milliseconds);
}

