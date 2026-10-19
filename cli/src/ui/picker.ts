import type readline from "node:readline";
import pc from "picocolors";
import { paintBase, paintUpdate } from "../core/format.js";
import { versionBanner } from "../update/banner.js";
import { rowWidths, laneRowSegments, type LaneDisplayItem } from "./lanelist.js";
import { toLaneName } from "../core/lanes.js";
import {
  baseSwitcherLine,
  charLength,
  classifyKey,
  escapeCount,
  frameWidth,
  inputHeaderLine,
  isPrintable,
  listCapacity,
  openRawScreen,
  paintLine,
  scrollWindow,
  type Paint,
  type Segment
} from "./tui.js";
import { cycle } from "../core/util.js";

export interface PickerItem extends LaneDisplayItem {
  isOld: boolean;
}

export type PickerResult =
  | { kind: "open"; item: PickerItem }
  | { kind: "create"; laneId: string; baseName: string }
  | { kind: "remove"; item: PickerItem }
  // `baseName` is the base the branch search starts on; `query` is what was typed in
  // the search field, handed on as the branch search text.
  | { kind: "checkout"; baseName: string; query: string }
  | { kind: "cancel" };

export interface PickerOptions {
  items: PickerItem[];
  lanePrefix: string;
  oldLaneDays: number;
  emptyHint: string;
  // Names of the configured bases, in config order. With more than one, the list
  // shows a base filter row and a `[base]` tag per lane.
  bases: string[];
  // Base the filter starts on; `undefined` means "All".
  initialBase?: string;
}

// Focus starts in the search field; `down` moves into the list, where row 0 is
// always "Create new lane", row 1 "Check out a branch" and the rows from
// FIRST_LANE_ROW on are the filtered lanes. The create prompt is a third mode
// inside the same raw-mode loop, so `esc` can return to the list instead of
// leaving the picker. `baseName` is the base the new lane is created in; it only
// matters (and is only shown) with several bases.
type Focus =
  | { area: "search" }
  | { area: "list"; index: number }
  | { area: "create"; draft: string; baseName: string };

const CREATE_ROW = 0;
const CHECKOUT_ROW = 1;
const FIRST_LANE_ROW = 2;

function matchesQuery(item: PickerItem, query: string): boolean {
  if (!query) {
    return true;
  }
  const needle = query.toLowerCase();
  if (item.laneName.toLowerCase().includes(needle)) {
    return true;
  }
  return item.lastCommitSubject?.toLowerCase().includes(needle) ?? false;
}

function resolvedNameLabel(lanePrefix: string, raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return toLaneName(lanePrefix, trimmed);
  } catch {
    return null;
  }
}

export function pickLane(options: PickerOptions): Promise<PickerResult> {
  const { items, lanePrefix, oldLaneDays, emptyHint, bases } = options;
  const multiBase = bases.length > 1;

  let query = "";
  // `null` is "All". The filter is only offered with several bases.
  let baseFilter: string | null = multiBase && options.initialBase ? options.initialBase : null;
  let focus: Focus = { area: "search" };
  let scrollTop = 0;

  function filteredItems(): PickerItem[] {
    return items.filter((item) => (baseFilter === null || item.baseName === baseFilter) && matchesQuery(item, query));
  }

  // All → first base → … → last base → All.
  function cycleBaseFilter(step: 1 | -1): void {
    baseFilter = cycle([null, ...bases], baseFilter, step);
    scrollTop = 0;
    if (focus.area === "list") {
      focus = { area: "list", index: Math.min(focus.index, rowCount() - 1) };
    }
  }

  function cycleCreateBase(step: 1 | -1): void {
    if (focus.area !== "create") {
      return;
    }
    focus = { ...focus, baseName: cycle(bases, focus.baseName, step) };
  }

  function startCreate(draft: string): Focus {
    return { area: "create", draft, baseName: baseFilter ?? bases[0] };
  }

  function rowCount(): number {
    return filteredItems().length + FIRST_LANE_ROW;
  }

  function renderCreate(draft: string, baseName: string): string[] {
    const width = frameWidth();
    const resolved = resolvedNameLabel(lanePrefix, draft);
    const header = paintLine(
      [
        { text: "  New lane id: ", paint: pc.cyan },
        { text: draft, paint: pc.bold },
        { text: "▏", paint: pc.dim },
        { text: resolved ? `   → will create ${resolved}` : "", paint: pc.dim }
      ],
      width
    );
    if (!multiBase) {
      const footer = paintLine([{ text: "  ⏎ create · esc back", paint: pc.dim }], width);
      return [header, "", footer];
    }
    const baseLine = baseSwitcherLine("  Base: ", baseName, width);
    const footer = paintLine([{ text: "  ⏎ create · tab/←→ base · esc back", paint: pc.dim }], width);
    return [header, baseLine, "", footer];
  }

  // `    Base: [All] api web` in blues, the active choice bright and bold.
  function renderBaseFilterRow(width: number): string {
    const segments: Segment[] = [{ text: "    Base: ", paint: pc.blueBright }];
    const choices: (string | null)[] = [null, ...bases];
    choices.forEach((choice, index) => {
      const label = choice ?? "All";
      const active = choice === baseFilter;
      segments.push({
        text: `${index > 0 ? " " : ""}${active ? `[${label}]` : ` ${label} `}`,
        paint: active ? (text) => pc.bold(paintBase(text)) : pc.blue
      });
    });
    return paintLine(segments, width);
  }

  function renderList(): string[] {
    const width = frameWidth();
    const version = versionBanner();
    const filtered = filteredItems();
    const highlighted = focus.area === "list" ? focus.index : -1;
    const header = inputHeaderLine(
      "  Search: ",
      pc.cyan,
      query,
      focus.area === "search",
      `${filtered.length}/${items.length} lanes`,
      width
    );

    const widths = rowWidths(filtered, multiBase);

    // Each entry is either a selectable row (tracked by `rowIndex`) or a
    // section separator that only takes up a line.
    const entries: { text: string; rowIndex: number | null }[] = [];

    const createName = resolvedNameLabel(lanePrefix, query);
    const createMarker = highlighted === CREATE_ROW ? "▸ " : "  ";
    const createPaint: Paint = highlighted === CREATE_ROW ? (text) => pc.bold(pc.green(text)) : pc.green;
    entries.push({
      rowIndex: CREATE_ROW,
      text: paintLine(
        [
          { text: `  ${createMarker}`, paint: pc.green },
          { text: "+ Create new lane", paint: createPaint },
          { text: createName ? `  ${createName}` : "", paint: pc.dim }
        ],
        width
      )
    });
    const checkoutActive = highlighted === CHECKOUT_ROW;
    entries.push({
      rowIndex: CHECKOUT_ROW,
      text: paintLine(
        [
          { text: `  ${checkoutActive ? "▸ " : "  "}`, paint: pc.magenta },
          { text: "⇣ Check out a branch", paint: checkoutActive ? (text) => pc.bold(pc.magenta(text)) : pc.magenta }
        ],
        width
      )
    });
    if (multiBase) {
      // Set off from the create row above and whatever follows below.
      entries.push({ rowIndex: null, text: "" });
      entries.push({ rowIndex: null, text: renderBaseFilterRow(width) });
    }

    let currentSection: "recent" | "old" | null = null;
    filtered.forEach((item, position) => {
      const section = item.isOld ? "old" : "recent";
      if (section !== currentSection) {
        currentSection = section;
        const title = section === "old" ? `-- old (${oldLaneDays}+ days) --` : "-- recent --";
        // A blank line ahead of each section keeps the list from reading as one block.
        entries.push({ rowIndex: null, text: "" });
        entries.push({
          rowIndex: null,
          text: paintLine([{ text: `    ${title}`, paint: section === "old" ? pc.red : pc.cyan }], width)
        });
      }

      const rowIndex = position + FIRST_LANE_ROW;
      const active = rowIndex === highlighted;
      const emphasize: Paint = active ? pc.bold : (text) => text;
      entries.push({
        rowIndex,
        text: paintLine(
          [
            { text: `  ${active ? "▸ " : "  "}${item.isOld ? "☠" : "*"} `, paint: emphasize },
            ...laneRowSegments(item, item.isOld, widths, emphasize)
          ],
          width
        )
      });
    });

    if (items.length === 0) {
      entries.push({ rowIndex: null, text: "" });
      entries.push({ rowIndex: null, text: paintLine([{ text: `    ${emptyHint}`, paint: pc.yellow }], width) });
    } else if (filtered.length === 0) {
      const scope = baseFilter === null ? "" : ` in base '${baseFilter}'`;
      const message = query ? `No lanes match '${query}'${scope}.` : `No lanes${scope}.`;
      entries.push({ rowIndex: null, text: "" });
      entries.push({
        rowIndex: null,
        text: paintLine([{ text: `    ${message}`, paint: pc.yellow }], width)
      });
    }

    // Keep the highlighted row inside the visible window.
    const highlightedLine = highlighted < 0 ? -1 : entries.findIndex((entry) => entry.rowIndex === highlighted);
    const window = scrollWindow(
      entries.map((entry) => entry.text),
      highlightedLine,
      listCapacity(),
      scrollTop,
      width
    );
    scrollTop = window.scrollTop;
    const body = window.visible;

    const hints = multiBase
      ? "  ↑↓ move · type to filter · tab/←→ base · ⏎ open · n new · b branch · d remove · esc quit"
      : "  ↑↓ move · type to filter · ⏎ open · n new · b branch · d remove · esc quit";
    const hintWidth = charLength(hints);
    const label = version.candidates.find((c) => hintWidth + charLength(c) + 2 <= width) ?? "";
    const footerGap = width - hintWidth - charLength(label);
    const footer = paintLine(
      [
        { text: hints, paint: pc.dim },
        {
          text: label ? " ".repeat(Math.max(1, footerGap)) + label : "",
          paint: version.pending ? paintUpdate : pc.dim
        }
      ],
      width
    );

    return [header, "", ...body, "", footer];
  }

  function frame(): string[] {
    return focus.area === "create" ? renderCreate(focus.draft, focus.baseName) : renderList();
  }

  return new Promise<PickerResult>((resolve) => {
    const screen = openRawScreen(frame, onKeypress);
    const render = screen.redraw;

    function finish(result: PickerResult): void {
      if (screen.close()) {
        resolve(result);
      }
    }

    // The branch search has its own base switch; it starts on the active filter.
    function startCheckout(): void {
      finish({ kind: "checkout", baseName: baseFilter ?? bases[0], query });
    }

    function onKeypress(str: string | undefined, key: readline.Key): void {
      // A quick double Esc (create prompt → list → quit) arrives as one keypress.
      if (key.name === "escape") {
        const presses = escapeCount(key);
        for (let i = 0; i < presses && screen.isOpen(); i += 1) {
          handleKey(undefined, { ...key, sequence: "\x1b" });
        }
        return;
      }
      handleKey(str, key);
    }

    function handleKey(str: string | undefined, key: readline.Key): void {
      const keys = classifyKey(key);
      if (keys.interrupt) {
        finish({ kind: "cancel" });
        return;
      }
      const switchBase = multiBase && (keys.baseNext || keys.basePrev);

      if (focus.area === "create") {
        if (keys.escape) {
          focus = { area: "list", index: CREATE_ROW };
        } else if (keys.enter) {
          const laneId = focus.draft.trim();
          if (laneId) {
            finish({ kind: "create", laneId, baseName: focus.baseName });
            return;
          }
        } else if (switchBase) {
          cycleCreateBase(keys.baseNext ? 1 : -1);
        } else if (key.name === "backspace") {
          focus = { ...focus, draft: [...focus.draft].slice(0, -1).join("") };
        } else if (isPrintable(str, key)) {
          focus = { ...focus, draft: focus.draft + str };
        }
        render();
        return;
      }

      if (switchBase) {
        cycleBaseFilter(keys.baseNext ? 1 : -1);
        render();
        return;
      }

      if (keys.escape) {
        finish({ kind: "cancel" });
        return;
      }

      if (focus.area === "search") {
        if (keys.down) {
          focus = { area: "list", index: CREATE_ROW };
        } else if (keys.enter) {
          // Only highlight the top match; opening takes a second ⏎ on a selected row.
          focus = filteredItems().length > 0 ? { area: "list", index: FIRST_LANE_ROW } : startCreate(query);
        } else if (key.name === "backspace") {
          query = [...query].slice(0, -1).join("");
        } else if (isPrintable(str, key)) {
          query += str;
        }
        render();
        return;
      }

      // focus.area === "list"
      const index = Math.min(focus.index, rowCount() - 1);
      const letter = key.ctrl || key.meta ? undefined : str;
      if (keys.up) {
        focus = index === CREATE_ROW ? { area: "search" } : { area: "list", index: index - 1 };
      } else if (keys.down) {
        focus = { area: "list", index: Math.min(index + 1, rowCount() - 1) };
      } else if (keys.enter) {
        if (index === CREATE_ROW) {
          focus = startCreate(query);
        } else if (index === CHECKOUT_ROW) {
          startCheckout();
          return;
        } else {
          finish({ kind: "open", item: filteredItems()[index - FIRST_LANE_ROW] });
          return;
        }
      } else if (letter === "n") {
        focus = startCreate(query);
      } else if (letter === "b") {
        startCheckout();
        return;
      } else if (letter === "d") {
        if (index >= FIRST_LANE_ROW) {
          finish({ kind: "remove", item: filteredItems()[index - FIRST_LANE_ROW] });
          return;
        }
      } else if (key.name === "backspace") {
        focus = { area: "search" };
        query = [...query].slice(0, -1).join("");
      } else if (isPrintable(str, key)) {
        // Any other typing goes back to the search field, fzf-style.
        focus = { area: "search" };
        query += str;
      }
      render();
    }
  });
}
