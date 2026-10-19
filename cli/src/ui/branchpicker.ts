import type readline from "node:readline";
import pc from "picocolors";
import { formatRelativeTime } from "../core/format.js";
import {
  baseSwitcherLine,
  charLength,
  classifyKey,
  frameWidth,
  inputHeaderLine,
  isPrintable,
  listCapacity,
  openRawScreen,
  paintLine,
  scrollWindow,
  type Paint
} from "./tui.js";
import { cycle, errorMessage } from "../core/util.js";

export interface BranchPickerItem {
  name: string;
  // Known only for branches an earlier fetch brought down.
  committedAtMs: number | null;
  subject: string | null;
  // Where the branch is already checked out ("task LANE-1437", "checked out in api-base"),
  // or `null` when it is free.
  note: string | null;
}

export type BranchPickerResult =
  | { kind: "select"; baseName: string; branch: string }
  // `esc`: back to the task picker.
  | { kind: "back" }
  | { kind: "cancel" };

export interface BranchPickerOptions {
  // Asks the base's origin for the best matches of `query` and how many matched in all.
  // Called only on ⏎, never per keystroke or base switch.
  search: (baseName: string, query: string) => { items: BranchPickerItem[]; total: number };
  // With more than one, a `Base: ‹ api ›` line under the search field switches between
  // them, like the task picker's create prompt.
  bases: string[];
  initialBase: string;
  initialQuery: string;
}

// Laid out like the task picker, but nothing is listed until a search runs: typing only
// edits the query, `⏎` in the search field asks origin and highlights the top result,
// and `⏎` on a highlighted branch picks it. `highlighted` is -1 while the search field
// has focus.
export function pickBranch(options: BranchPickerOptions): Promise<BranchPickerResult> {
  const { search, bases } = options;
  const multiBase = bases.length > 1;

  let baseName = options.initialBase;
  let query = options.initialQuery;
  // The query the shown results belong to, and those results; `null` before any search.
  let searched: string | null = null;
  let results: BranchPickerItem[] = [];
  let total = 0;
  const hint = { text: "Type part of a branch name and press ⏎ to search origin.", paint: pc.dim };
  let message: { text: string; paint: Paint } | null = hint;
  let highlighted = -1;
  let scrollTop = 0;

  function frame(): string[] {
    const width = frameWidth();

    const scope = multiBase ? ` in ${baseName}` : "";
    const right =
      searched === null
        ? `origin${scope}`
        : query.trim() !== searched
          ? "⏎ to search"
          : total > results.length
            ? `top ${results.length} of ${total} matches${scope} · type more to narrow`
            : `${total} match${total === 1 ? "" : "es"}${scope}`;
    const header = inputHeaderLine("  Branch: ", pc.magenta, query, highlighted < 0, right, width);

    const nameWidth = Math.max(0, ...results.map((item) => charLength(item.name)));
    const relativeLabels = results.map((item) =>
      item.committedAtMs === null ? "" : formatRelativeTime(item.committedAtMs)
    );
    const relativeWidth = Math.max(0, ...relativeLabels.map((label) => charLength(label)));

    const rows = results.map((item, index) => {
      const active = index === highlighted;
      const emphasize: Paint = active ? pc.bold : (text) => text;
      return paintLine(
        [
          { text: `  ${active ? "▸ " : "  "}`, paint: emphasize },
          { text: item.name.padEnd(nameWidth + 2), paint: (text) => emphasize(pc.green(text)) },
          {
            text: relativeWidth > 0 ? relativeLabels[index].padEnd(relativeWidth + 2) : "",
            paint: (text) => emphasize(pc.yellow(text))
          },
          { text: item.subject ?? "", paint: (text) => emphasize(pc.white(text)) },
          { text: item.note ? `  (${item.note})` : "", paint: pc.magenta }
        ],
        width
      );
    });

    let body: string[];
    if (message) {
      body = [paintLine([{ text: `    ${message.text}`, paint: message.paint }], width)];
    } else {
      // The base line is one more fixed row with several bases.
      const window = scrollWindow(rows, highlighted, listCapacity(multiBase ? 1 : 0), scrollTop, width);
      scrollTop = window.scrollTop;
      body = window.visible;
    }

    const footer = paintLine(
      [
        {
          text: multiBase
            ? "  type a name · ⏎ search / check out · ↑↓ move · tab/←→ base · esc back"
            : "  type a name · ⏎ search / check out · ↑↓ move · esc back",
          paint: pc.dim
        }
      ],
      width
    );
    if (!multiBase) {
      return [header, "", ...body, "", footer];
    }
    // Padded to line the base name up under the branch query.
    return [header, baseSwitcherLine("  Base:   ", baseName, width), "", ...body, "", footer];
  }

  function runSearch(render: () => void): void {
    const needle = query.trim();
    if (!needle) {
      message = { text: "Type part of a branch name first.", paint: pc.yellow };
      return;
    }
    // `search` blocks on the network, so the frame says so before it starts.
    message = { text: `Searching origin for '${needle}'…`, paint: pc.dim };
    results = [];
    render();
    try {
      ({ items: results, total } = search(baseName, needle));
      searched = needle;
      message = results.length === 0 ? { text: `No branches on origin match '${needle}'.`, paint: pc.yellow } : null;
      highlighted = results.length > 0 ? 0 : -1;
    } catch (error) {
      searched = null;
      const reason = errorMessage(error).split("\n").pop();
      message = { text: `Search failed: ${reason}`, paint: pc.red };
    }
  }

  // Results belong to one base, so switching drops them; the query stays for the next ⏎.
  function cycleBase(step: 1 | -1): void {
    baseName = cycle(bases, baseName, step);
    searched = null;
    results = [];
    total = 0;
    highlighted = -1;
    message = hint;
  }

  return new Promise<BranchPickerResult>((resolve) => {
    const screen = openRawScreen(frame, onKeypress);

    function finish(result: BranchPickerResult): void {
      if (screen.close()) {
        resolve(result);
      }
    }

    function onKeypress(str: string | undefined, key: readline.Key): void {
      const keys = classifyKey(key);
      if (keys.interrupt || keys.escape) {
        finish(keys.escape ? { kind: "back" } : { kind: "cancel" });
        return;
      }

      if (keys.enter) {
        if (highlighted >= 0) {
          finish({ kind: "select", baseName, branch: results[highlighted].name });
          return;
        }
        runSearch(screen.redraw);
      } else if (multiBase && (keys.baseNext || keys.basePrev)) {
        cycleBase(keys.baseNext ? 1 : -1);
      } else if (keys.down) {
        highlighted = Math.min(highlighted + 1, results.length - 1);
      } else if (keys.up) {
        highlighted = Math.max(highlighted - 1, -1);
      } else if (key.name === "backspace" || isPrintable(str, key)) {
        query = key.name === "backspace" ? [...query].slice(0, -1).join("") : query + str;
        highlighted = -1;
        // Earlier results stay listed (the header says they are stale); a warning does not.
        if (searched === null) {
          message = hint;
        }
      }
      screen.redraw();
    }
  });
}
