// The plugins loaded for this run, and the questions lane asks them. Nothing in lane names
// a plugin: the list comes from what is installed.
import type { Command } from "commander";
import { laneWords } from "../hooks/run.js";
import { shellSplit } from "../hooks/shell.js";
import type { LaneConfig } from "../core/types.js";
import type { BrokenPlugin } from "./load.js";
import { COMMAND_LISTS, type DoctorLine, type Leftover, type Plugin } from "./types.js";

let loaded: Plugin[] = [];
let brokenPlugins: BrokenPlugin[] = [];

export function setPlugins(plugins: Plugin[], broken: BrokenPlugin[] = []): void {
  loaded = plugins;
  brokenPlugins = broken;
}

export function installedPlugins(): readonly Plugin[] {
  return loaded;
}

export function brokenPluginList(): readonly BrokenPlugin[] {
  return brokenPlugins;
}

export function pluginNamed(name: string | undefined): Plugin | undefined {
  return loaded.find((plugin) => plugin.name === name);
}

// `lane <plugin> ...` for every loaded plugin.
export function registerPlugins(program: Command): void {
  for (const plugin of loaded) {
    plugin.register(program.command(plugin.name).description(plugin.description));
  }
}

// The plugin a `lane <name> …` line needs, or undefined for any other command.
export function pluginNameOf(line: string): string | undefined {
  return laneWords(line)?.[0];
}

// Throws with a reason when `line` cannot be run: empty, badly quoted, or a line of an
// installed plugin that the plugin rejects. A line of a plugin that is not installed
// passes here; `ensurePlugins` deals with it before anything runs.
export function validateCommandLine(line: string, label: string): void {
  if (!line.trim()) {
    throw new Error(`Config \`${label}\` must be a non-empty command line.`);
  }
  let words: string[];
  try {
    words = shellSplit(line);
  } catch (error) {
    throw new Error(`Config \`${label}\`: ${error instanceof Error ? error.message : String(error)}.`);
  }
  const lane = laneWords(line);
  if (!lane) {
    return;
  }
  if (!lane[0]) {
    throw new Error(`Config \`${label}\`: \`lane\` on its own is not a command; use \`lane <plugin> …\`.`);
  }
  const plugin = pluginNamed(lane[0]);
  if (!plugin) {
    return;
  }
  try {
    plugin.validate(lane.slice(1));
  } catch (error) {
    throw new Error(`Config \`${label}\` (${words.slice(0, 3).join(" ")}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

// What a line would run once the task exists and the setup prompt is accepted.
export function setupCommandsOf(line: string): string[] {
  const lane = laneWords(line);
  const plugin = pluginNamed(lane?.[0]);
  return plugin && lane ? plugin.setupCommands(lane.slice(1)) : [];
}

function pluginNamesIn(config: LaneConfig): Set<string> {
  const names = new Set<string>();
  for (const holder of [config, ...config.bases]) {
    for (const list of COMMAND_LISTS) {
      for (const line of holder[list] ?? []) {
        const name = pluginNameOf(line);
        if (name) {
          names.add(name);
        }
      }
    }
  }
  return names;
}

// The plugins some base actually uses, so doctor checks only what matters here.
export function usedPlugins(config: LaneConfig): Plugin[] {
  return [...pluginNamesIn(config)].flatMap((name) => pluginNamed(name) ?? []);
}

// Plugins the config's lines need that are not loaded.
export function missingPlugins(config: LaneConfig): string[] {
  return [...pluginNamesIn(config)].filter((name) => !pluginNamed(name)).sort();
}

export function doctorChecks(config: LaneConfig): DoctorLine[] {
  return usedPlugins(config).flatMap((plugin) => plugin.doctor());
}

// Every plugin forgets the task, whatever the config says now: the task may have been
// opened under an earlier one.
export function forgetTask(key: string): void {
  for (const plugin of loaded) {
    plugin.forget(key);
  }
}

export function findLeftovers(knownKeys: string[]): Leftover[] {
  return loaded.flatMap((plugin) => plugin.findLeftovers(knownKeys));
}

// True when some plugin recognised the terminal and closed its tab.
export function closeCurrentTab(): boolean {
  return loaded.some((plugin) => plugin.closeCurrentTab?.() ?? false);
}
