// Terminal primitives shared by the full-screen pickers and the init wizard: painting
// width-limited lines, decoding keys, and redrawing a frame in place in raw mode.
import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import pc from "picocolors";
import { paintBase } from "../core/format.js";

export type Paint = (text: string) => string;

export interface Segment {
  text: string;
  paint?: Paint;
}

const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR_TO_END = "\x1b[0J";

// Lines a frame spends outside its list: header, blank, blank, footer, plus a safety row
// so the frame never reaches the last terminal line and scrolls.
const FRAME_OVERHEAD = 5;
const MIN_LIST_LINES = 3;
const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;

// How long a lone Esc waits to see whether it starts an arrow-key sequence. Node's own
// default is 500ms, which makes every `esc` feel stuck; a terminal sends a whole
// sequence at once, so a short wait tells the two apart just as well.
const ESCAPE_CODE_TIMEOUT_MS = 50;

function cursorUp(lines: number): string {
  return lines > 0 ? `\x1b[${lines}A` : "";
}

// Node wires keypress decoding to a stream once, with the settings of the first call,
// so every raw-mode screen goes through here.
export function emitKeypresses(): void {
  readline.emitKeypressEvents(input, { escapeCodeTimeout: ESCAPE_CODE_TIMEOUT_MS } as unknown as readline.Interface);
}

// Usable width: one column short of the terminal, so a full line never wraps.
export function frameWidth(): number {
  return (output.columns || DEFAULT_COLUMNS) - 1;
}

// How many list lines fit beside the header and footer, and `extraLines` more fixed rows.
export function listCapacity(extraLines = 0): number {
  return Math.max(MIN_LIST_LINES, (output.rows || DEFAULT_ROWS) - FRAME_OVERHEAD - extraLines);
}

export function charLength(text: string): number {
  return [...text].length;
}

// Colors are applied only after truncation so a line never exceeds `width`
// visible cells: a wrapped line would count as two rows and break the redraw.
export function paintLine(segments: Segment[], width: number): string {
  let remaining = width;
  let out = "";
  for (const segment of segments) {
    if (remaining <= 0) {
      break;
    }
    const chars = [...segment.text];
    const text = chars.length > remaining ? chars.slice(0, remaining).join("") : segment.text;
    remaining -= Math.min(chars.length, remaining);
    out += segment.paint ? segment.paint(text) : text;
  }
  return out;
}

export function isPrintable(str: string | undefined, key: readline.Key): str is string {
  if (!str || key.ctrl || key.meta) {
    return false;
  }
  // Control characters (including \r, \n, \x7f) arrive with a `name`; real text does not need one.
  return charLength(str) === 1 && str.charCodeAt(0) >= 0x20 && str.charCodeAt(0) !== 0x7f;
}

export interface KeyKind {
  enter: boolean;
  up: boolean;
  down: boolean;
  baseNext: boolean;
  basePrev: boolean;
  escape: boolean;
  interrupt: boolean;
}

export function classifyKey(key: readline.Key): KeyKind {
  return {
    enter: key.name === "return" || key.name === "enter",
    up: key.name === "up" || (Boolean(key.ctrl) && key.name === "p"),
    down: key.name === "down" || (Boolean(key.ctrl) && key.name === "n"),
    // Shift-tab arrives as `tab` with shift set.
    baseNext: (key.name === "tab" && !key.shift) || key.name === "right",
    basePrev: (key.name === "tab" && Boolean(key.shift)) || key.name === "left",
    escape: key.name === "escape",
    interrupt: Boolean(key.ctrl) && key.name === "c"
  };
}

// Node folds Esc presses that land within its escape-sequence timeout into one `escape`
// keypress whose sequence is "\x1b\x1b…", so a quick double Esc would otherwise count once.
export function escapeCount(key: readline.Key): number {
  return Math.max(1, [...(key.sequence ?? "")].filter((char) => char === "\x1b").length);
}

export interface RawScreen {
  redraw(): void;
  isOpen(): boolean;
  // Erases the frame and hands the terminal back. Returns false if it was already closed.
  close(): boolean;
}

// Takes over the terminal in raw mode and draws `frame()` in place: each redraw moves the
// cursor back over the previous frame and clears it, so the frame never scrolls.
export function openRawScreen(
  frame: () => string[],
  onKeypress: (str: string | undefined, key: readline.Key) => void
): RawScreen {
  let lastLineCount = 0;
  let open = true;

  function redraw(): void {
    const lines = frame();
    output.write(cursorUp(lastLineCount) + CLEAR_TO_END + lines.join("\n") + "\n");
    lastLineCount = lines.length;
  }

  function handleKeypress(str: string | undefined, key: readline.Key = {}): void {
    if (open) {
      onKeypress(str, key);
    }
  }

  function close(): boolean {
    if (!open) {
      return false;
    }
    open = false;
    output.write(cursorUp(lastLineCount) + CLEAR_TO_END);
    lastLineCount = 0;
    input.off("keypress", handleKeypress);
    output.off("resize", redraw);
    input.setRawMode(false);
    input.pause();
    output.write(SHOW_CURSOR);
    return true;
  }

  emitKeypresses();
  input.setRawMode(true);
  input.resume();
  input.on("keypress", handleKeypress);
  output.on("resize", redraw);
  output.write(HIDE_CURSOR);
  redraw();
  return { redraw, isOpen: () => open, close };
}

// The slice of `lines` that fits in `capacity` rows, scrolled the least amount that keeps
// `highlightedLine` visible (-1 for none, which scrolls to the top). The first and last
// visible lines turn into "↑/↓ N more" markers when lines are cut off there.
export function scrollWindow(
  lines: string[],
  highlightedLine: number,
  capacity: number,
  scrollTop: number,
  width: number
): { visible: string[]; scrollTop: number } {
  let top = scrollTop;
  if (highlightedLine < 0) {
    top = 0;
  } else if (highlightedLine < top) {
    top = highlightedLine;
  } else if (highlightedLine >= top + capacity) {
    top = highlightedLine - capacity + 1;
  }
  top = Math.max(0, Math.min(top, Math.max(0, lines.length - capacity)));

  const visible = lines.slice(top, top + capacity);
  const hiddenBelow = lines.length - (top + visible.length);
  if (top > 0) {
    visible[0] = paintLine([{ text: `    ↑ ${top} more`, paint: pc.dim }], width);
  }
  if (hiddenBelow > 0) {
    visible[visible.length - 1] = paintLine([{ text: `    ↓ ${hiddenBelow} more`, paint: pc.dim }], width);
  }
  return { visible, scrollTop: top };
}

// `  Search: text▏            12/40 lanes`: an input field with a caret while focused and
// a dim note right-aligned beside it, dropped when the two would not fit.
export function inputHeaderLine(
  label: string,
  labelPaint: Paint,
  query: string,
  focused: boolean,
  note: string,
  width: number
): string {
  const caret = focused ? "▏" : "";
  const gap = width - charLength(label + query + caret) - charLength(note) - 2;
  return paintLine(
    [
      { text: label, paint: labelPaint },
      { text: query, paint: pc.bold },
      { text: caret, paint: pc.dim },
      { text: gap > 0 ? " ".repeat(gap) + note : "", paint: pc.dim }
    ],
    width
  );
}

// `  Base: ‹ api ›   (tab or ←→ to switch)`, for screens that act on one base at a time.
export function baseSwitcherLine(label: string, baseName: string, width: number): string {
  return paintLine(
    [
      { text: label, paint: pc.blueBright },
      { text: "‹ ", paint: pc.blueBright },
      { text: baseName, paint: (text) => pc.bold(paintBase(text)) },
      { text: " ›", paint: pc.blueBright },
      { text: "   (tab or ←→ to switch)", paint: pc.dim }
    ],
    width
  );
}

// Esc pressed in readLine, `steps` times in quick succession.
export class EscapePressed extends Error {
  constructor(readonly steps: number) {
    super("escape");
  }
}

// A line editor just big enough for answers: type, backspace, ctrl+u to clear, enter
// to submit. Esc rejects with EscapePressed, counting the presses. Raw mode is what lets a bare
// Esc be seen at all; readline's question() would swallow it.
export function readLine(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";

    function cleanup(): void {
      input.off("keypress", onKeypress);
      input.setRawMode(false);
      input.pause();
      output.write("\n");
    }

    function onKeypress(str: string | undefined, key: readline.Key = {}): void {
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(130);
      }
      if (key.name === "escape") {
        cleanup();
        reject(new EscapePressed(escapeCount(key)));
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        cleanup();
        resolve(buffer);
        return;
      }
      if (key.name === "backspace") {
        if (buffer) {
          buffer = [...buffer].slice(0, -1).join("");
          output.write("\b \b");
        }
        return;
      }
      if (key.ctrl && key.name === "u") {
        output.write("\b \b".repeat([...buffer].length));
        buffer = "";
        return;
      }
      if (isPrintable(str, key)) {
        buffer += str;
        output.write(str);
      }
    }

    output.write(prompt);
    emitKeypresses();
    input.setRawMode(true);
    input.resume();
    input.on("keypress", onKeypress);
  });
}
