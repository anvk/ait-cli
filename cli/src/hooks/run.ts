// Runs a base's command lists for a task.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pc from "picocolors";
import { ENV } from "lane-plugin-api";
import { runInteractive } from "../core/process.js";
import { errorMessage } from "../core/util.js";
import { shellJoin, shellQuote, shellSplit } from "./shell.js";
import type { TaskContext } from "../plugins/types.js";

// The task as LANE_* variables; the names are the plugin API's, so plugins and lane agree.
export function taskEnv(ctx: TaskContext): NodeJS.ProcessEnv {
  return {
    [ENV.task]: ctx.taskName,
    [ENV.taskPath]: ctx.taskPath,
    [ENV.taskKey]: ctx.key,
    [ENV.taskLabel]: ctx.label,
    [ENV.branch]: ctx.branch,
    [ENV.base]: ctx.base,
    [ENV.root]: ctx.root,
    [ENV.created]: ctx.created ? "1" : ""
  };
}

const PLACEHOLDERS: Record<string, (ctx: TaskContext) => string> = {
  task: (ctx) => ctx.taskName,
  path: (ctx) => ctx.taskPath,
  branch: (ctx) => ctx.branch,
  base: (ctx) => ctx.base,
  root: (ctx) => ctx.root
};

// `{task}` and friends become shell-quoted values. A line that starts with `lane` runs
// this same lane, so a config works when `lane` is not on PATH (and under tests).
export function substitute(line: string, ctx: TaskContext): string {
  const expanded = line.replace(/\{(task|path|branch|base|root)\}/g, (_match, name: string) =>
    shellQuote(PLACEHOLDERS[name](ctx))
  );
  return isLaneLine(expanded) ? `${selfCommand()} ${expanded.trimStart().slice("lane".length)}` : expanded;
}

export function isLaneLine(line: string): boolean {
  return /^\s*lane(\s|$)/.test(line);
}

// The words after `lane` in a line that invokes lane, or null for any other command.
export function laneWords(line: string): string[] | null {
  if (!isLaneLine(line)) {
    return null;
  }
  return shellSplit(line).slice(1);
}

function selfCommand(): string {
  return shellJoin([process.execPath, process.argv[1]]);
}

export interface RunListOptions {
  // Give plugins somewhere to stage work for the end of the list (`*.flush` files).
  after?: boolean;
  runSetup?: boolean;
  // Print each line before it runs.
  announce?: boolean;
  // Said after a failing line, so the warning tells what happens next.
  failureNote?: string;
}

// Runs each line with `sh -c` in the task folder, in order, with the terminal attached.
// A failing line is reported and the rest still run. Then every `*.flush` left in the
// after-directory runs once.
export function runList(ctx: TaskContext, lines: string[], options: RunListOptions = {}): void {
  if (lines.length === 0) {
    return;
  }
  const afterDir = options.after ? fs.mkdtempSync(path.join(os.tmpdir(), "lane-after-")) : undefined;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...taskEnv(ctx),
    ...(afterDir ? { [ENV.afterDir]: afterDir } : {}),
    ...(options.runSetup ? { [ENV.runSetup]: "1" } : {})
  };

  try {
    for (const line of lines) {
      if (options.announce) {
        console.log(pc.cyan(line));
      }
      runLine(line, ctx, env, options.failureNote);
    }
    if (afterDir) {
      for (const entry of fs.readdirSync(afterDir).filter((name) => name.endsWith(".flush")).sort()) {
        runLine(fs.readFileSync(path.join(afterDir, entry), "utf8").trim(), ctx, env, options.failureNote);
      }
    }
  } finally {
    if (afterDir) {
      fs.rmSync(afterDir, { recursive: true, force: true });
    }
  }
}

function runLine(line: string, ctx: TaskContext, env: NodeJS.ProcessEnv, failureNote?: string): void {
  try {
    runInteractive("sh", ["-c", substitute(line, ctx)], { cwd: ctx.taskPath, env });
  } catch (error) {
    const note = failureNote ? ` (${failureNote})` : "";
    console.log(pc.yellow(`Command failed${note}: ${line}\n  ${errorMessage(error).split("\n").pop()}`));
  }
}
