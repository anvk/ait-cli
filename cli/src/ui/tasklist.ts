// Every task of a workspace with its age and last commit, as `lane list` prints it and the
// picker shows it.
import fs from "node:fs";
import pc from "picocolors";
import { formatRelativeTime, paintBase } from "../core/format.js";
import { lastCommit } from "../core/git.js";
import { getTaskLastUpdatedMs, getTaskPath, listTaskFolders, resolveTasksRoot } from "../core/tasks.js";
import { charLength, paintLine, type Paint, type Segment } from "./tui.js";
import type { LaneConfig } from "../core/types.js";
import { DAY_MS, mapLimit } from "../core/util.js";

export interface TaskDisplayItem {
  taskName: string;
  taskPath: string;
  baseName: string;
  lastUpdatedMs: number;
  lastCommitSubject: string | null;
  lastCommitAtMs: number | null;
}

export function isOlderThan(item: TaskDisplayItem, days: number, now = Date.now()): boolean {
  return now - item.lastUpdatedMs >= days * DAY_MS;
}

export function splitTasksByAge(
  items: TaskDisplayItem[],
  oldTaskDays: number,
  now = Date.now()
): { recent: TaskDisplayItem[]; old: TaskDisplayItem[] } {
  return {
    recent: items.filter((item) => !isOlderThan(item, oldTaskDays, now)),
    old: items.filter((item) => isOlderThan(item, oldTaskDays, now))
  };
}

// A folder the walk cannot get through (a dangling symlink, say) falls back to its own mtime.
async function getTaskActivityMs(taskPath: string): Promise<number> {
  try {
    return await getTaskLastUpdatedMs(taskPath);
  } catch {
    return fs.statSync(taskPath).mtimeMs;
  }
}

// Each task costs a walk of its whole folder and a `git log`, so a few run at once.
const GATHER_CONCURRENCY = 8;

// Most recently active first.
export async function gatherTaskDisplayItems(configDir: string, config: LaneConfig): Promise<TaskDisplayItem[]> {
  const tasks = config.bases.flatMap((base) =>
    listTaskFolders(configDir, base.tasksDir, config.taskPrefix).map((taskName) => ({
      taskName,
      taskPath: getTaskPath(configDir, base.tasksDir, taskName),
      baseName: base.name
    }))
  );
  const items = await mapLimit(tasks, GATHER_CONCURRENCY, async (task) => {
    // Age is how recently the files changed, not when the branch tip was committed. A
    // task branched from an old base ref would otherwise be born "old", and `purge`
    // (which removes worktrees with --force) would target active tasks whose work is
    // not yet committed.
    const [lastUpdatedMs, commit] = await Promise.all([getTaskActivityMs(task.taskPath), lastCommit(task.taskPath)]);
    return {
      ...task,
      lastUpdatedMs,
      lastCommitSubject: commit ? commit.subject : null,
      lastCommitAtMs: commit ? commit.committedAtMs : null
    };
  });
  return items.sort((a, b) => b.lastUpdatedMs - a.lastUpdatedMs);
}

export interface RowWidths {
  name: number;
  // 0 when the `[base]` column is not shown (a single-base workspace).
  base: number;
  relative: number;
}

export function rowWidths(items: TaskDisplayItem[], showBase: boolean): RowWidths {
  return {
    name: Math.max(0, ...items.map((item) => charLength(item.taskName))),
    base: showBase ? Math.max(0, ...items.map((item) => charLength(`[${item.baseName}]`))) : 0,
    relative: Math.max(0, ...items.map((item) => charLength(formatRelativeTime(item.lastUpdatedMs))))
  };
}

// One task's columns: name, `[base]`, age, last commit subject and when it was made.
// Old tasks are red throughout; `emphasize` wraps every column but the commit age.
export function taskRowSegments(
  item: TaskDisplayItem,
  old: boolean,
  widths: RowWidths,
  emphasize: Paint = (text) => text
): Segment[] {
  const namePaint: Paint = old ? pc.red : pc.green;
  const relativePaint: Paint = old ? pc.red : pc.yellow;
  const subjectPaint: Paint = item.lastCommitSubject ? (old ? pc.red : pc.white) : pc.dim;
  const segments: Segment[] = [{ text: item.taskName.padEnd(widths.name + 2), paint: (text) => emphasize(namePaint(text)) }];
  if (widths.base > 0) {
    segments.push({ text: `[${item.baseName}]`.padEnd(widths.base + 2), paint: (text) => emphasize(paintBase(text)) });
  }
  segments.push(
    {
      text: formatRelativeTime(item.lastUpdatedMs).padEnd(widths.relative + 2),
      paint: (text) => emphasize(relativePaint(text))
    },
    { text: item.lastCommitSubject ?? "no commits yet", paint: (text) => emphasize(subjectPaint(text)) },
    {
      text: item.lastCommitAtMs === null ? "" : ` (committed ${formatRelativeTime(item.lastCommitAtMs)})`,
      paint: pc.dim
    }
  );
  return segments;
}

function printTaskSection(title: string, items: TaskDisplayItem[], options: { old: boolean; showBase: boolean }): void {
  if (items.length === 0) {
    return;
  }
  console.log((options.old ? pc.red : pc.cyan)(`-- ${title} --`));
  const widths = rowWidths(items, options.showBase);
  const icon = options.old ? "☠" : "*";
  for (const item of items) {
    console.log(paintLine([{ text: `${icon} ` }, ...taskRowSegments(item, options.old, widths)], Infinity));
  }
  console.log("");
}

export function noTasksHint(configDir: string, config: LaneConfig): string {
  if (config.bases.length === 1) {
    const [base] = config.bases;
    const tasksRoot = resolveTasksRoot(configDir, base.tasksDir);
    return fs.existsSync(tasksRoot)
      ? `No task folders found in '${base.tasksDir}' (directory is empty).`
      : `No task folders found. '${base.tasksDir}' does not exist yet; it will be created when you run 'lane create <taskId>'.`;
  }
  const dirs = config.bases.map((base) => `'${base.tasksDir}'`).join(", ");
  return `No task folders found in ${dirs}. They are created when you run 'lane create <taskId> --base <name>'.`;
}

export async function printRichTaskList(configDir: string, config: LaneConfig): Promise<void> {
  const taskItems = await gatherTaskDisplayItems(configDir, config);
  if (taskItems.length === 0) {
    console.log(pc.yellow(noTasksHint(configDir, config)));
    return;
  }

  const showBase = config.bases.length > 1;
  const { recent, old } = splitTasksByAge(taskItems, config.oldTaskDays);
  printTaskSection("recent", recent, { old: false, showBase });
  printTaskSection(`old (${config.oldTaskDays}+ days)`, old, { old: true, showBase });
}
