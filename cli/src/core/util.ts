import fs from "node:fs";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";

export const DAY_MS = 24 * 60 * 60 * 1000;

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isDirectory(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

// The path of `fileName` in `startDir` or the nearest parent that has one.
export function findUp(startDir: string, fileName: string, maxDepth = Number.POSITIVE_INFINITY): string | null {
  let current = path.resolve(startDir);
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const candidate = path.join(current, fileName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
  return null;
}

// The entry `step` places from `current`, wrapping around either end.
export function cycle<T>(list: readonly T[], current: T, step: 1 | -1): T {
  const index = list.indexOf(current);
  return list[(index + step + list.length) % list.length];
}

export function realpathOrSelf(filePath: string): string {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return filePath;
  }
}

// `fn` over every item with at most `limit` running at once, results in input order.
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// One line of input in cooked mode, for questions asked outside the raw-mode screens.
export async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}
