import { test } from "node:test";
import assert from "node:assert/strict";
import { charLength, classifyKey, escapeCount, paintLine, scrollWindow } from "./tui.js";

const mark = (text: string) => `<${text}>`;

test("paintLine truncates to the width before painting", () => {
  assert.equal(paintLine([{ text: "abc" }, { text: "def", paint: mark }], 5), "abc<de>");
  assert.equal(
    paintLine(
      [
        { text: "abcdef", paint: mark },
        { text: "gh", paint: mark }
      ],
      3
    ),
    "<abc>"
  );
  assert.equal(paintLine([{ text: "ab" }], 10), "ab");
});

test("charLength counts code points", () => {
  assert.equal(charLength("▸ ☠"), 3);
});

const lines = ["a", "b", "c", "d", "e", "f"];
// eslint-disable-next-line no-control-regex -- matches the terminal colour codes the TUI writes
const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

test("scrollWindow keeps the highlighted line visible and marks cut-off lines", () => {
  const top = scrollWindow(lines, -1, 3, 2, 80);
  assert.equal(top.scrollTop, 0);
  assert.deepEqual(top.visible.map(strip), ["a", "b", "    ↓ 3 more"]);

  const bottom = scrollWindow(lines, 5, 3, 0, 80);
  assert.equal(bottom.scrollTop, 3);
  assert.deepEqual(bottom.visible.map(strip), ["    ↑ 3 more", "e", "f"]);

  const fits = scrollWindow(["a", "b"], 1, 3, 0, 80);
  assert.deepEqual(fits.visible, ["a", "b"]);
});

test("classifyKey and escapeCount decode keys", () => {
  assert.equal(classifyKey({ name: "tab", shift: true }).basePrev, true);
  assert.equal(classifyKey({ name: "n", ctrl: true }).down, true);
  assert.equal(classifyKey({ name: "c", ctrl: true }).interrupt, true);
  assert.equal(escapeCount({ name: "escape", sequence: "\x1b\x1b" }), 2);
  assert.equal(escapeCount({ name: "escape" }), 1);
});
