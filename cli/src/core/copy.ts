import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// How a base folder's contents were mirrored into a lane folder.
export type CopyStrategy = "clone" | "cp" | "node";

export interface CopyPair {
  source: string;
  destination: string;
}

// Built by `npm run build` at the root of dist/; absent when the host has
// no compiler or is not macOS, which is why every caller can fall back.
const CLONE_HELPER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "clonedir");

// Measured on a 1.8 GB repository: four parallel copies were twice as fast as one,
// and more than four was slower again as the processes contended for the disk.
const CP_JOBS = 4;

const STRATEGY_ORDER: CopyStrategy[] = ["clone", "cp", "node"];

// Whether the fast path is available here, for `lanes doctor` to report.
export function cloneSupport(): { available: boolean; helper: string; reason?: string } {
  if (process.platform !== "darwin") {
    return { available: false, helper: CLONE_HELPER, reason: "cloning is macOS only" };
  }
  if (!fs.existsSync(CLONE_HELPER)) {
    return { available: false, helper: CLONE_HELPER, reason: "the helper was not built (no compiler when lanes was installed)" };
  }
  return { available: true, helper: CLONE_HELPER };
}

// `LANES_COPY=cp` (or `node`) starts lower down the list, to exercise or force a
// fallback. A strategy that fails still falls through to the next one.
function startingStrategy(): CopyStrategy {
  const requested = process.env.LANES_COPY?.trim().toLowerCase();
  return STRATEGY_ORDER.includes(requested as CopyStrategy) ? (requested as CopyStrategy) : "clone";
}

// Copies each source to its destination, which must not already exist, and reports
// which mechanism did the work. Cloning is tried first because on APFS it shares the
// blocks copy-on-write: a whole `node_modules` becomes one syscall instead of tens of
// thousands of file copies, and takes no extra disk space.
export function copyPaths(pairs: CopyPair[]): CopyStrategy {
  if (pairs.length === 0) {
    return "node";
  }

  for (const pair of pairs) {
    fs.mkdirSync(path.dirname(pair.destination), { recursive: true });
  }

  const from = STRATEGY_ORDER.indexOf(startingStrategy());
  if (from <= 0 && cloneAll(pairs)) {
    return "clone";
  }
  if (from <= 1 && cpAll(pairs)) {
    return "cp";
  }
  for (const pair of pairs) {
    fs.cpSync(pair.source, pair.destination, { recursive: true, force: true, errorOnExist: false });
  }
  return "node";
}

// The helper reads tab-separated pairs, one per line, so a path containing either
// character has to take another route.
function cloneAll(pairs: CopyPair[]): boolean {
  if (process.platform !== "darwin" || !fs.existsSync(CLONE_HELPER)) {
    return false;
  }
  if (pairs.some((pair) => /[\t\n]/.test(pair.source) || /[\t\n]/.test(pair.destination))) {
    return false;
  }

  const input = `${pairs.map((pair) => `${pair.source}\t${pair.destination}`).join("\n")}\n`;
  const result = spawnSync(CLONE_HELPER, { input, stdio: ["pipe", "ignore", "pipe"] });
  return result.status === 0;
}

// `cp -c` clones each file where the filesystem allows it and copies where it does
// not, and several copies run at once since one `cp` cannot saturate the disk.
// Directories are expanded one level so there is something to parallelise.
function cpAll(pairs: CopyPair[]): boolean {
  if (process.platform !== "darwin") {
    return false;
  }

  const listFile = path.join(os.tmpdir(), `lanes-copy-${process.pid}-${Date.now()}`);
  try {
    const expanded = pairs.flatMap((pair) => expandOneLevel(pair));
    // NUL separated, so no path needs quoting; `-n 2` hands cp one pair at a time.
    fs.writeFileSync(listFile, `${expanded.flatMap((pair) => [pair.source, pair.destination]).join("\0")}\0`);
    const result = spawnSync(
      "/bin/sh",
      ["-c", `exec xargs -0 -P ${CP_JOBS} -n 2 cp -Rc < "$1"`, "sh", listFile],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
    return result.status === 0;
  } catch {
    return false;
  } finally {
    fs.rmSync(listFile, { force: true });
  }
}

function expandOneLevel(pair: CopyPair): CopyPair[] {
  let children: string[];
  let mode: number;
  try {
    const stats = fs.statSync(pair.source);
    if (!stats.isDirectory()) {
      return [pair];
    }
    mode = stats.mode;
    children = fs.readdirSync(pair.source);
  } catch {
    return [pair];
  }
  if (children.length < 2) {
    return [pair];
  }

  // cp will not create the parent, and it keeps the source's permissions when it
  // creates a directory itself, so this stands in for that.
  fs.mkdirSync(pair.destination, { recursive: true });
  fs.chmodSync(pair.destination, mode);
  return children.map((child) => ({
    source: path.join(pair.source, child),
    destination: path.join(pair.destination, child)
  }));
}
