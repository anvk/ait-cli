// Loads the installed plugins at startup. A plugin that fails to load never stops a
// command; it is reported by doctor and `lanes plugin list`.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { API_VERSION } from "lanes-plugin-api";
import { errorMessage } from "../core/util.js";
import { pluginEntry, readInstalled, type InstalledPlugin } from "./state.js";
import type { Plugin } from "./types.js";

export interface BrokenPlugin {
  name: string;
  reason: string;
}

export interface LoadedPlugins {
  plugins: Plugin[];
  broken: BrokenPlugin[];
  installed: InstalledPlugin[];
}

const REQUIRED_METHODS = ["register", "validate", "setupCommands", "doctor", "forget", "findLeftovers"] as const;

// Imports one plugin folder and checks it is a Plugin written against this API.
export async function importPlugin(dir: string, expectedName?: string): Promise<Plugin> {
  const entry = pluginEntry(dir);
  if (!fs.existsSync(entry)) {
    throw new Error(`${entry} does not exist; is the plugin built?`);
  }
  const module = (await import(pathToFileURL(entry).href)) as { default?: unknown };
  const plugin = module.default as Partial<Plugin> | undefined;
  if (!plugin || typeof plugin !== "object") {
    throw new Error(`${entry} does not export a plugin as its default export`);
  }
  if (plugin.api !== API_VERSION) {
    throw new Error(
      `built against plugin API ${String(plugin.api)}, this version of lanes speaks ${API_VERSION}; update the plugin or lanes`
    );
  }
  if (typeof plugin.name !== "string" || !/^[a-z][a-z0-9-]*$/.test(plugin.name)) {
    throw new Error(`plugin name ${JSON.stringify(plugin.name)} must be lowercase letters, digits and dashes`);
  }
  if (expectedName && plugin.name !== expectedName) {
    throw new Error(`the plugin calls itself '${plugin.name}', but it was installed as '${expectedName}'`);
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof plugin[method] !== "function") {
      throw new Error(`plugin is missing ${method}()`);
    }
  }
  return plugin as Plugin;
}

export async function loadPlugins(): Promise<LoadedPlugins> {
  const installed = readInstalled();
  const plugins: Plugin[] = [];
  const broken: BrokenPlugin[] = [];
  for (const entry of installed) {
    try {
      plugins.push(await importPlugin(entry.dir, entry.name));
    } catch (error) {
      broken.push({ name: entry.name, reason: errorMessage(error).split("\n")[0] });
    }
  }
  return { plugins, broken, installed };
}
