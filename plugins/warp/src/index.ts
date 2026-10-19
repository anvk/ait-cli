// Warp as a lane plugin: `lane warp tab` opens a task's folders as Warp tabs. See
// plugins/README.md for what lane asks of a plugin.
import fs from "node:fs";
import type { Asker, DoctorLine, Plugin } from "lane-plugin-api";
import { closeCurrentWarpTab, isWarpInstalled } from "./app.js";
import {
  WARP_COLORS,
  findOrphanedTabConfigs,
  getLaunchConfigsDir,
  getTabConfigsDir,
  removeTabConfigs,
  type WarpColor
} from "./files.js";
import { configureTabCommand, parseTabWords, runFlushCommand, runTabCommand, tabLine, type WarpTabSpec } from "./tab.js";
import { shellSplit } from "./support.js";

function specOf(words: string[]): WarpTabSpec {
  if (words[0] !== "tab") {
    throw new Error(`only \`lane warp tab\` can be used here, not \`lane warp ${words[0] ?? ""}\`.`);
  }
  return parseTabWords(words.slice(1));
}

function writableDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function validateWith(check: () => unknown): string | null {
  try {
    check();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const NONE = "none";

// The tab's questions for `lane init`. Flags without a question (--setup, --group,
// --new-window) are kept from the line being edited.
async function promptTab(ask: Asker, existing?: string[]): Promise<string[]> {
  let current: WarpTabSpec | undefined;
  try {
    current = existing ? specOf(existing) : undefined;
  } catch {
    current = undefined;
  }
  const validateTitle = (value: string): string | null => validateWith(() => parseTabWords([value]));
  const title = current
    ? await ask.validated("Tab title", current.title, validateTitle)
    : await ask.required("Tab title (e.g. Agent)", validateTitle);
  const tabPath = await ask.validated(
    "Folder to open (relative to the task folder, '.' for the task root)",
    current?.path ?? ".",
    (value) => validateWith(() => parseTabWords([title, "--path", value]))
  );
  const color = await ask.choice("Tab color", [NONE, ...WARP_COLORS], current?.color ?? NONE);
  const command = await ask.optional("Command to run when the tab opens (e.g. claude --continue)", current?.command ?? "");
  const line = tabLine({
    title,
    path: tabPath,
    color: color === NONE ? undefined : (color as WarpColor),
    command: command || undefined,
    setup: current?.setup,
    group: current?.group ?? false,
    newWindow: current?.newWindow ?? false
  });
  // `lane warp tab …` back to the words after `lane warp`.
  return shellSplit(line).slice(2);
}

const warpPlugin: Plugin = {
  api: 1,
  name: "warp",
  description: "Warp terminal tabs, for use in a base's `open` list",
  register(warp) {
    configureTabCommand(warp.command("tab")).action((title: string, options) => {
      runTabCommand(parseTabWords([title, ...optionWords(options)]));
    });
    warp
      .command("flush", { hidden: true })
      .description("Open the tabs staged by `lane warp tab` while lane ran a task's commands")
      .action(() => runFlushCommand());
    warp
      .command("doctor")
      .description("Check that Warp is installed and lane can write its tab configs")
      .action(() => {
        let failed = false;
        for (const line of warpPlugin.doctor()) {
          failed ||= line.level === "fail";
          console.log(`${line.level.toUpperCase()} ${line.message}`);
        }
        if (failed) {
          process.exitCode = 1;
        }
      });
  },
  validate(words) {
    specOf(words);
  },
  setupCommands(words) {
    const spec = specOf(words);
    return spec.setup ? [`${spec.title}: ${spec.setup}`] : [];
  },
  doctor(): DoctorLine[] {
    const lines: DoctorLine[] = [];
    if (isWarpInstalled()) {
      lines.push({ level: "ok", message: "Warp is installed" });
    } else {
      lines.push({ level: "fail", message: "Warp is not installed (get it from https://www.warp.dev)" });
    }
    const tabConfigsDir = getTabConfigsDir();
    lines.push(
      writableDir(tabConfigsDir)
        ? { level: "ok", message: `Warp tab configs directory is writable: ${tabConfigsDir}` }
        : { level: "fail", message: `Warp tab configs directory is not writable: ${tabConfigsDir}` }
    );
    const launchConfigsDir = getLaunchConfigsDir();
    lines.push(
      writableDir(launchConfigsDir)
        ? { level: "ok", message: `Warp launch configs directory is writable: ${launchConfigsDir}` }
        : { level: "warn", message: `Warp launch configs directory is not writable (needed for --group): ${launchConfigsDir}` }
    );
    return lines;
  },
  forget: removeTabConfigs,
  findLeftovers: findOrphanedTabConfigs,
  closeCurrentTab: closeCurrentWarpTab,
  prompt: promptTab
};

// Back to words, so the CLI action and config validation share one parser.
function optionWords(options: Record<string, unknown>): string[] {
  const words: string[] = [];
  for (const [name, value] of Object.entries(options)) {
    const flag = `--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
    if (value === true) {
      words.push(flag);
    } else if (typeof value === "string") {
      words.push(flag, value);
    }
  }
  return words;
}

export default warpPlugin;
