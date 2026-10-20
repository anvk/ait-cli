// Every lane of a workspace with its age and last commit, as `lanes list` prints it and the
// picker shows it.
import fs from "node:fs";
import pc from "picocolors";
import { formatRelativeTime, paintBase } from "../core/format.js";
import { lastCommit, uncommittedPaths } from "../core/git.js";
import { getLaneActivityMs, getLanePath, listLaneFolders, resolveLanesRoot } from "../core/lanes.js";
import { charLength, paintLine, type Paint, type Segment } from "./tui.js";
import type { LanesConfig } from "../core/types.js";
import { DAY_MS, mapLimit } from "../core/util.js";

export interface LaneDisplayItem {
  laneName: string;
  lanePath: string;
  baseName: string;
  lastUpdatedMs: number;
  lastCommitSubject: string | null;
  lastCommitAtMs: number | null;
  // Files with uncommitted changes, new files included: what removing the lane would lose.
  // null when git could not say.
  uncommitted: number | null;
}

export function isOlderThan(item: LaneDisplayItem, days: number, now = Date.now()): boolean {
  return now - item.lastUpdatedMs >= days * DAY_MS;
}

export function splitLanesByAge(
  items: LaneDisplayItem[],
  oldLaneDays: number,
  now = Date.now()
): { recent: LaneDisplayItem[]; old: LaneDisplayItem[] } {
  return {
    recent: items.filter((item) => !isOlderThan(item, oldLaneDays, now)),
    old: items.filter((item) => isOlderThan(item, oldLaneDays, now))
  };
}

// Each lane costs a `git status` and a `git log`, so a few run at once.
const GATHER_CONCURRENCY = 8;

// Most recently active first.
export async function gatherLaneDisplayItems(configDir: string, config: LanesConfig): Promise<LaneDisplayItem[]> {
  const lanes = config.bases.flatMap((base) =>
    listLaneFolders(configDir, base.lanesDir, config.lanePrefix).map((laneName) => ({
      laneName,
      lanePath: getLanePath(configDir, base.lanesDir, laneName),
      baseName: base.name
    }))
  );
  const items = await mapLimit(lanes, GATHER_CONCURRENCY, async (lane) => {
    const [changed, commit] = await Promise.all([uncommittedPaths(lane.lanePath), lastCommit(lane.lanePath)]);
    return {
      ...lane,
      lastUpdatedMs: await getLaneActivityMs(lane.lanePath, changed),
      lastCommitSubject: commit ? commit.subject : null,
      lastCommitAtMs: commit ? commit.committedAtMs : null,
      uncommitted: changed ? changed.length : null
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

export function rowWidths(items: LaneDisplayItem[], showBase: boolean): RowWidths {
  return {
    name: Math.max(0, ...items.map((item) => charLength(item.laneName))),
    base: showBase ? Math.max(0, ...items.map((item) => charLength(`[${item.baseName}]`))) : 0,
    relative: Math.max(0, ...items.map((item) => charLength(formatRelativeTime(item.lastUpdatedMs))))
  };
}

// One lane's columns: name, `[base]`, age, last commit subject and when it was made.
// Old lanes are red throughout; `emphasize` wraps every column but the commit age.
export function laneRowSegments(
  item: LaneDisplayItem,
  old: boolean,
  widths: RowWidths,
  emphasize: Paint = (text) => text
): Segment[] {
  const namePaint: Paint = old ? pc.red : pc.green;
  const relativePaint: Paint = old ? pc.red : pc.yellow;
  const subjectPaint: Paint = item.lastCommitSubject ? (old ? pc.red : pc.white) : pc.dim;
  const segments: Segment[] = [{ text: item.laneName.padEnd(widths.name + 2), paint: (text) => emphasize(namePaint(text)) }];
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

function printLaneSection(title: string, items: LaneDisplayItem[], options: { old: boolean; showBase: boolean }): void {
  if (items.length === 0) {
    return;
  }
  console.log((options.old ? pc.red : pc.cyan)(`-- ${title} --`));
  const widths = rowWidths(items, options.showBase);
  const icon = options.old ? "☠" : "*";
  for (const item of items) {
    console.log(paintLine([{ text: `${icon} ` }, ...laneRowSegments(item, options.old, widths)], Infinity));
  }
  console.log("");
}

export function noLanesHint(configDir: string, config: LanesConfig): string {
  if (config.bases.length === 1) {
    const [base] = config.bases;
    const lanesRoot = resolveLanesRoot(configDir, base.lanesDir);
    return fs.existsSync(lanesRoot)
      ? `No lane folders found in '${base.lanesDir}' (directory is empty).`
      : `No lane folders found. '${base.lanesDir}' does not exist yet; it will be created when you run 'lanes create <laneId>'.`;
  }
  const dirs = config.bases.map((base) => `'${base.lanesDir}'`).join(", ");
  return `No lane folders found in ${dirs}. They are created when you run 'lanes create <laneId> --base <name>'.`;
}

export async function printRichLaneList(configDir: string, config: LanesConfig): Promise<void> {
  const laneItems = await gatherLaneDisplayItems(configDir, config);
  if (laneItems.length === 0) {
    console.log(pc.yellow(noLanesHint(configDir, config)));
    return;
  }

  const showBase = config.bases.length > 1;
  const { recent, old } = splitLanesByAge(laneItems, config.oldLaneDays);
  printLaneSection("recent", recent, { old: false, showBase });
  printLaneSection(`old (${config.oldLaneDays}+ days)`, old, { old: true, showBase });
}
