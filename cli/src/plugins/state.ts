// What is installed: `~/.lane/plugins.json` lists the plugins, `~/.lane/plugins/<name>` links
// to each one's folder, and git clones live under `~/.lane/plugins/.repos/`.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type PluginKind =
  // A folder on this machine, linked as is and never updated by lane.
  | "path"
  // Cloned from a git URL into .repos; `lane plugin update` and self-update pull it.
  | "git"
  // Lives in lane's own checkout (the URL was lane's origin); moves when lane updates.
  | "lane";

export interface InstalledPlugin {
  name: string;
  // What `lane plugin install` was given.
  source: string;
  kind: PluginKind;
  // The plugin package folder (holds package.json).
  dir: string;
  // For `git`: the clone the folder sits in.
  repo?: string;
}

interface PluginsFile {
  plugins: InstalledPlugin[];
}

export function pluginsRoot(): string {
  return path.join(os.homedir(), ".lane", "plugins");
}

export function reposRoot(): string {
  return path.join(pluginsRoot(), ".repos");
}

function pluginsFile(): string {
  return path.join(os.homedir(), ".lane", "plugins.json");
}

export function readInstalled(): InstalledPlugin[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(pluginsFile(), "utf8")) as Partial<PluginsFile>;
    return Array.isArray(parsed.plugins) ? parsed.plugins : [];
  } catch {
    return [];
  }
}

export function writeInstalled(plugins: InstalledPlugin[]): void {
  const file = pluginsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sorted = [...plugins].sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(file, `${JSON.stringify({ plugins: sorted } satisfies PluginsFile, null, 2)}\n`, "utf8");
}

// The symlink lane keeps per plugin, so `~/.lane/plugins/<name>` is always the plugin folder.
export function pluginLink(name: string): string {
  return path.join(pluginsRoot(), name);
}

export function pluginPackage(dir: string): { name?: string; main?: string; lane?: { name?: unknown; api?: unknown }; scripts?: Record<string, string> } {
  return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as ReturnType<typeof pluginPackage>;
}

export function pluginEntry(dir: string): string {
  return path.join(dir, pluginPackage(dir).main ?? "dist/index.js");
}
