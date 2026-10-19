// Small helpers the plugin needs and cannot import from lanes.
import { spawnSync, type SpawnSyncOptionsWithBufferEncoding } from "node:child_process";
import fs from "node:fs";

export function isDirectory(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

// Runs a command and returns its trimmed output, throwing with the command and its
// stderr when it fails.
export function run(command: string, args: string[], options: SpawnSyncOptionsWithBufferEncoding = {}): string {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: "pipe", ...options });
  const stdout = String(result.stdout ?? "").trim();
  if (result.status !== 0) {
    const details = String(result.stderr ?? "").trim() || stdout || "Command failed with no output";
    throw new Error(`${command} ${args.join(" ")}\n${details}`);
  }
  return stdout;
}

export function commandSucceeds(command: string, args: string[]): boolean {
  return spawnSync(command, args, { stdio: "ignore" }).status === 0;
}

// A word safe to paste into a shell command line; plain words stay as they are.
export function shellQuote(word: string): string {
  if (/^[A-Za-z0-9_./:=@%+,-]+$/.test(word)) {
    return word;
  }
  return `'${word.replace(/'/g, `'\\''`)}'`;
}

export function shellJoin(words: string[]): string {
  return words.map(shellQuote).join(" ");
}

// Splits a command line the way a POSIX shell would, far enough for the lanes config lines:
// single quotes, double quotes with `\"` and `\\`, backslash escapes outside quotes.
export function shellSplit(line: string): string[] {
  const words: string[] = [];
  let current = "";
  let inWord = false;
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quote === "'") {
      if (char === "'") {
        quote = null;
      } else {
        current += char;
      }
    } else if (quote === '"') {
      if (char === '"') {
        quote = null;
      } else if (char === "\\" && i + 1 < line.length && '"\\$`'.includes(line[i + 1])) {
        current += line[++i];
      } else {
        current += char;
      }
    } else if (char === "'" || char === '"') {
      quote = char;
      inWord = true;
    } else if (char === "\\" && i + 1 < line.length) {
      current += line[++i];
      inWord = true;
    } else if (/\s/.test(char)) {
      if (inWord) {
        words.push(current);
        current = "";
        inWord = false;
      }
    } else {
      current += char;
      inWord = true;
    }
  }
  if (quote) {
    throw new Error(`unterminated ${quote === "'" ? "single" : "double"} quote`);
  }
  if (inWord) {
    words.push(current);
  }
  return words;
}
