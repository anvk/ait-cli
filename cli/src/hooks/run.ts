// Runs a base's command lists for a lane.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pc from "picocolors";
import { ENV } from "lanes-plugin-api";
import { runInteractive } from "../core/process.js";
import { errorMessage } from "../core/util.js";
import { shellJoin, shellQuote, shellSplit } from "./shell.js";
import type { LaneContext } from "../plugins/types.js";

// The lane as LANES_* variables; the names are the plugin API's, so plugins and lanes agree.
export function laneEnv(ctx: LaneContext): NodeJS.ProcessEnv {
  return {
    [ENV.lane]: ctx.laneName,
    [ENV.lanePath]: ctx.lanePath,
    [ENV.laneKey]: ctx.key,
    [ENV.laneLabel]: ctx.label,
    [ENV.branch]: ctx.branch,
    [ENV.base]: ctx.base,
    [ENV.root]: ctx.root,
    [ENV.created]: ctx.created ? "1" : ""
  };
}

const PLACEHOLDERS: Record<string, (ctx: LaneContext) => string> = {
  lane: (ctx) => ctx.laneName,
  path: (ctx) => ctx.lanePath,
  branch: (ctx) => ctx.branch,
  base: (ctx) => ctx.base,
  root: (ctx) => ctx.root
};

// `{lane}` and friends become their values, quoted to fit where they stand: shell-quoted
// when bare, escaped for a double-quoted string inside "…", and spliced out of a '…'
// string, so `cd {path}` and `echo "{path}"` both work for a folder with spaces. A line
// that starts with `lanes` runs this same lanes, so a config works when `lanes` is not on
// PATH (and under tests).
export function substitute(line: string, ctx: LaneContext): string {
  let out = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const placeholder = /^\{(lane|path|branch|base|root)\}/.exec(line.slice(i));
    if (placeholder) {
      const value = PLACEHOLDERS[placeholder[1]](ctx);
      out +=
        quote === '"'
          ? value.replace(/(["\\$`])/g, "\\$1")
          : quote === "'"
            ? `'${shellQuote(value)}'`
            : shellQuote(value);
      i += placeholder[0].length - 1;
      continue;
    }
    const char = line[i];
    if (char === "\\" && quote !== "'" && i + 1 < line.length) {
      out += char + line[i + 1];
      i += 1;
      continue;
    }
    if ((char === "'" || char === '"') && (quote === null || quote === char)) {
      quote = quote === null ? char : null;
    }
    out += char;
  }
  return isLanesLine(out) ? `${selfCommand()} ${out.trimStart().slice("lanes".length)}` : out;
}

export function isLanesLine(line: string): boolean {
  return /^\s*lanes(\s|$)/.test(line);
}

// The words after `lanes` in a line that invokes lanes, or null for any other command.
export function lanesWords(line: string): string[] | null {
  if (!isLanesLine(line)) {
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

// Runs each line with `sh -c` in the lane folder, in order, with the terminal attached.
// A failing line is reported and the rest still run. Then every `*.flush` left in the
// after-directory runs once.
export function runList(ctx: LaneContext, lines: string[], options: RunListOptions = {}): void {
  if (lines.length === 0) {
    return;
  }
  const afterDir = options.after ? fs.mkdtempSync(path.join(os.tmpdir(), "lanes-after-")) : undefined;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...laneEnv(ctx),
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
      for (const entry of fs
        .readdirSync(afterDir)
        .filter((name) => name.endsWith(".flush"))
        .sort()) {
        runLine(fs.readFileSync(path.join(afterDir, entry), "utf8").trim(), ctx, env, options.failureNote);
      }
    }
  } finally {
    if (afterDir) {
      fs.rmSync(afterDir, { recursive: true, force: true });
    }
  }
}

function runLine(line: string, ctx: LaneContext, env: NodeJS.ProcessEnv, failureNote?: string): void {
  try {
    runInteractive("sh", ["-c", substitute(line, ctx)], { cwd: ctx.lanePath, env });
  } catch (error) {
    const note = failureNote ? ` (${failureNote})` : "";
    console.log(pc.yellow(`Command failed${note}: ${line}\n  ${errorMessage(error).split("\n").pop()}`));
  }
}
