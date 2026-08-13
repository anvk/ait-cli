import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pc from "picocolors";
import { commandSucceeds, run } from "./process.js";
import type { WarpTabConfig } from "./types.js";

const WARP_APP_NAME = "Warp";
const WARP_STARTUP_TIMEOUT_MS = 10_000;
const WARP_POLL_INTERVAL_MS = 250;
const WARP_SETTLE_MS = 1_500;
const WARP_TAB_INTERVAL_MS = 300;

interface ResolvedWarpTab {
  configName: string;
  title: string;
  cwd: string;
  color?: string;
  command?: string;
}

export function getTabConfigsDir(): string {
  return path.join(os.homedir(), ".warp", "tab_configs");
}

function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "-");
}

function getTaskConfigPrefix(taskName: string): string {
  return `ait-${sanitize(taskName)}-`;
}

export function removeTabConfigs(taskName: string): void {
  const tabConfigsDir = getTabConfigsDir();
  const prefix = getTaskConfigPrefix(taskName);
  try {
    for (const entry of fs.readdirSync(tabConfigsDir)) {
      if (entry.startsWith(prefix) && entry.endsWith(".toml")) {
        fs.rmSync(path.join(tabConfigsDir, entry), { force: true });
      }
    }
  } catch {
    // Leftover tab configs are harmless, so failures here are ignored.
  }
}

export function openTaskInWarp(
  taskPath: string,
  taskName: string,
  tabs: WarpTabConfig[],
  options: { newWindow?: boolean } = {}
): void {
  const resolvedTabs = resolveTabs(taskPath, taskName, tabs);
  const tabConfigsDir = getTabConfigsDir();

  fs.mkdirSync(tabConfigsDir, { recursive: true });
  removeTabConfigs(taskName);
  for (const tab of resolvedTabs) {
    fs.writeFileSync(path.join(tabConfigsDir, `${tab.configName}.toml`), buildTabConfigToml(tab), "utf8");
  }

  ensureWarpRunning();

  resolvedTabs.forEach((tab, index) => {
    // Spacing the URIs apart keeps the tabs in the configured order.
    if (index > 0) {
      sleepSync(WARP_TAB_INTERVAL_MS);
    }
    // Only the first tab requests a window; the rest join it as the active window.
    const target = options.newWindow && index === 0 ? "?new_window=true" : "";
    run("open", [`warp://tab_config/${encodeURIComponent(tab.configName)}${target}`]);
  });

  console.log(pc.green(`Opened ${resolvedTabs.length} Warp tab(s) for ${taskName}.`));
}

// Warp exposes no URI for closing a tab, so the pane's shell is signalled to exit and
// Warp closes the tab with it.
export function closeCurrentWarpTab(): void {
  if (process.env.TERM_PROGRAM !== "WarpTerminal") {
    console.log(pc.yellow("Not running inside Warp; leaving the current tab open."));
    return;
  }

  // Give Warp a moment to act on the tab URIs before this shell goes away.
  sleepSync(WARP_TAB_INTERVAL_MS);
  process.kill(process.ppid, "SIGHUP");
}

function resolveTabs(taskPath: string, taskName: string, tabs: WarpTabConfig[]): ResolvedWarpTab[] {
  const prefix = getTaskConfigPrefix(taskName);

  return tabs.map((tab, index) => {
    const candidate = path.resolve(taskPath, tab.path);
    let cwd = candidate;

    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
      console.log(
        pc.yellow(`Tab '${tab.title}' folder does not exist: ${candidate}\nUsing task root instead.`)
      );
      cwd = taskPath;
    }

    return {
      configName: `${prefix}${index}-${sanitize(tab.title).toLowerCase()}`,
      title: `${tab.title} - ${taskName}`,
      cwd,
      color: tab.color,
      command: tab.command
    };
  });
}

function buildTabConfigToml(tab: ResolvedWarpTab): string {
  const commands = [buildPaneNameCommand(tab.title)];
  if (tab.command) {
    commands.push(tab.command);
  }

  const lines = [`name = ${tomlString(tab.configName)}`];
  if (tab.color) {
    lines.push(`color = ${tomlString(tab.color)}`);
  }
  lines.push(
    "",
    "[[panes]]",
    `id = ${tomlString("main")}`,
    `type = ${tomlString("terminal")}`,
    `directory = ${tomlString(tab.cwd)}`,
    `commands = [${commands.map(tomlLiteral).join(", ")}]`
  );

  return `${lines.join("\n")}\n`;
}

// Warp has no pane-level title field, so the name "Rename pane" edits is set with an
// OSC sequence; WARP_DISABLE_AUTO_TITLE stops Warp naming the pane after the command.
function buildPaneNameCommand(title: string): string {
  return `export WARP_DISABLE_AUTO_TITLE=true; printf '\\033]0;%s\\007' ${shellQuote(title)}`;
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// Warp's TOML parser drops \u001B escapes from basic strings, so commands use a literal
// string and let printf resolve \033 instead.
function tomlLiteral(value: string): string {
  const safe = value.replace(/'''/g, "''").replace(/'$/, "");
  return `'''${safe}'''`;
}

function shellQuote(value: string): string {
  return `"${value.replace(/(["$`\\])/g, "\\$1")}"`;
}

export function isWarpRunning(): boolean {
  // Warp's executable is named `stable`, not `Warp`, so matching on process name fails.
  try {
    const { stdout } = run("osascript", ["-e", `application "${WARP_APP_NAME}" is running`]);
    return stdout === "true";
  } catch {
    return false;
  }
}

export function isWarpInstalled(): boolean {
  return commandSucceeds("open", ["-Ra", WARP_APP_NAME]);
}

function ensureWarpRunning(): void {
  if (isWarpRunning()) {
    return;
  }

  if (!isWarpInstalled()) {
    throw new Error(`${WARP_APP_NAME} is not installed. Install Warp from https://www.warp.dev and retry.`);
  }

  console.log(pc.cyan("Starting Warp..."));
  run("open", ["-a", WARP_APP_NAME]);

  const deadline = Date.now() + WARP_STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (isWarpRunning()) {
      // A cold-started Warp drops URIs until it registers its handler.
      sleepSync(WARP_SETTLE_MS);
      return;
    }
    sleepSync(WARP_POLL_INTERVAL_MS);
  }

  // Opening the URI starts Warp on its own, so a slow start is not fatal.
  console.log(
    pc.yellow(`Warp did not report as running within ${WARP_STARTUP_TIMEOUT_MS / 1000}s; opening anyway.`)
  );
}

// Every ait command is synchronous, so this blocks the thread instead of awaiting a timer.
function sleepSync(milliseconds: number): void {
  const buffer = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(buffer, 0, 0, milliseconds);
}
