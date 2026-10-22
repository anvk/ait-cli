// What is installed: `~/.lanes/plugins.json` lists the plugins, `~/.lanes/plugins/<name>` links
// to each one's folder, and git clones live under `~/.lanes/plugins/.repos/`.
import fs from "node:fs";
import path from "node:path";
import { pluginsFile, pluginsRoot } from "../core/paths.js";

export type PluginKind =
  // A folder on this machine, linked as is and never updated by lanes.
  | "path"
  // Cloned from a git URL into .repos; `lanes plugin update` and self-update pull it.
  | "git"
  // Lives in the lanes checkout (the URL was the lanes origin); moves when lanes updates.
  | "lanes";

export interface InstalledPlugin {
  name: string;
  // What `lanes plugin install` was given.
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

export { pluginsRoot };

export function reposRoot(): string {
  return path.join(pluginsRoot(), ".repos");
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

// The symlink lanes keeps per plugin, so `~/.lanes/plugins/<name>` is always the plugin folder.
export function pluginLink(name: string): string {
  return path.join(pluginsRoot(), name);
}

export function pluginPackage(dir: string): {
  name?: string;
  main?: string;
  lanes?: { name?: unknown; api?: unknown };
  scripts?: Record<string, string>;
} {
  return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as ReturnType<typeof pluginPackage>;
}

export function pluginEntry(dir: string): string {
  return path.join(dir, pluginPackage(dir).main ?? "dist/index.js");
}
