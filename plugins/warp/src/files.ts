// The files Warp reads: tab configs (one tab each) and launch configurations (a whole
// window, the only Warp format that can declare tab groups).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Leftover } from "lanes-plugin-api";

export const WARP_COLORS = ["red", "green", "yellow", "blue", "magenta", "cyan"] as const;
export type WarpColor = (typeof WARP_COLORS)[number];

export interface ResolvedWarpTab {
  configName: string;
  cwd: string;
  color?: string;
  // Run in order when the tab opens: naming the pane first, then the tab's own command.
  commands: string[];
}

export function getTabConfigsDir(): string {
  return path.join(os.homedir(), ".warp", "tab_configs");
}

export function getLaunchConfigsDir(): string {
  return path.join(os.homedir(), ".warp", "launch_configurations");
}

export function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "-");
}

export function getLaunchConfigName(key: string): string {
  return `lanes-${sanitize(key)}`;
}

export function getLaneConfigPrefix(key: string): string {
  return `lanes-${sanitize(key)}-`;
}

export function tabConfigName(key: string, index: number, title: string): string {
  return `${getLaneConfigPrefix(key)}${index}-${sanitize(title).toLowerCase()}`;
}

export function removeTabConfigs(key: string): void {
  const tabConfigsDir = getTabConfigsDir();
  const prefix = getLaneConfigPrefix(key);
  try {
    for (const entry of fs.readdirSync(tabConfigsDir)) {
      if (entry.startsWith(prefix) && entry.endsWith(".toml")) {
        fs.rmSync(path.join(tabConfigsDir, entry), { force: true });
      }
    }
  } catch {
    // Leftover tab configs are harmless, so failures here are ignored.
  }
  fs.rmSync(path.join(getLaunchConfigsDir(), `${getLaunchConfigName(key)}.yaml`), { force: true });
}

// Tab configs are named `lanes-<key>-<index>-<slug>.toml` and launch configs `lanes-<key>.yaml`.
// Anything whose <key> no longer matches an existing lane is left over from a lane that
// was deleted outside `lanes remove`, and Warp keeps listing it in its new-tab and launch
// configuration menus.
const TAB_CONFIG_NAME = /^lanes-(.+)-\d+-[^/]*\.toml$/;
const LAUNCH_CONFIG_NAME = /^lanes-(.+)\.yaml$/;

export function findOrphanedTabConfigs(knownKeys: string[]): Leftover[] {
  const known = new Set(knownKeys.map(sanitize));
  const orphans = new Map<string, string[]>();
  const collect = (dir: string, pattern: RegExp): void => {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const match = pattern.exec(entry);
      if (!match || known.has(match[1])) {
        continue;
      }
      const files = orphans.get(match[1]) ?? [];
      files.push(path.join(dir, entry));
      orphans.set(match[1], files);
    }
  };
  collect(getTabConfigsDir(), TAB_CONFIG_NAME);
  collect(getLaunchConfigsDir(), LAUNCH_CONFIG_NAME);

  return [...orphans.entries()]
    .map(([key, files]) => ({ key, files: files.sort() }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function buildTabConfigToml(tab: ResolvedWarpTab): string {
  const lines = [`name = ${quoted(tab.configName)}`];
  if (tab.color) {
    lines.push(`color = ${quoted(tab.color)}`);
  }
  lines.push(
    "",
    "[[panes]]",
    `id = ${quoted("main")}`,
    `type = ${quoted("terminal")}`,
    `directory = ${quoted(tab.cwd)}`,
    `commands = [${tab.commands.map(tomlLiteral).join(", ")}]`
  );

  return `${lines.join("\n")}\n`;
}

// One window, every tab in group 0. The group takes the lane name and the first tab
// color that is set, so the group header matches the tabs it holds.
//
// Tabs carry no `title`: Warp shows a single-pane tab under that pane's name, and the
// pane is already named by the OSC sequence in its commands, so a title here would be a
// second name for the same tab to keep in step. `title` is optional in Warp's schema.
export function buildLaunchConfigYaml(name: string, groupName: string, tabs: ResolvedWarpTab[]): string {
  const groupColor = tabs.find((tab) => tab.color)?.color;
  const lines = ["---", `name: ${quoted(name)}`, "windows:", "  - tabs:"];
  for (const tab of tabs) {
    // Built as plain keys, then the first one takes the `- ` list marker, so dropping
    // a key never leaves the marker stranded on the wrong line.
    const keys: string[] = [];
    if (tab.color) {
      keys.push(`color: ${tab.color}`);
    }
    keys.push("group: 0", "layout:", `  cwd: ${quoted(tab.cwd)}`, "  commands:");
    for (const command of tab.commands) {
      keys.push(`    - exec: ${quoted(command)}`);
    }

    lines.push(`      - ${keys[0]}`, ...keys.slice(1).map((key) => `        ${key}`));
  }
  lines.push("    tab_groups:", `      - name: ${quoted(groupName)}`);
  if (groupColor) {
    lines.push(`        color: ${groupColor}`);
  }
  lines.push("        collapsed: false", "        pinned: false");
  return `${lines.join("\n")}\n`;
}

// Warp has no pane-level title field, so the name "Rename pane" edits is set with an
// OSC sequence; WARP_DISABLE_AUTO_TITLE stops Warp naming the pane after the command.
export function buildPaneNameCommand(title: string): string {
  return `export WARP_DISABLE_AUTO_TITLE=true; printf '\\033]0;%s\\007' ${doubleQuote(title)}`;
}

// A double-quoted string with backslashes and quotes escaped, which TOML basic strings
// and YAML double-quoted scalars both read the same way.
function quoted(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// Warp's TOML parser drops \u001B escapes from basic strings, so commands use a literal
// string and let printf resolve \033 instead.
function tomlLiteral(value: string): string {
  const safe = value.replace(/'''/g, "''").replace(/'$/, "");
  return `'''${safe}'''`;
}

function doubleQuote(value: string): string {
  return `"${value.replace(/(["$`\\])/g, "\\$1")}"`;
}
