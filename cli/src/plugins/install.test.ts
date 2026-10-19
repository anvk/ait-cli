import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseSource } from "./install.js";

test("a git URL may carry the folder of the plugin inside the repository", () => {
  assert.deepEqual(parseSource("https://github.com/anvk/lanes.git#plugins/warp"), {
    kind: "git",
    location: "https://github.com/anvk/lanes.git",
    subdir: "plugins/warp"
  });
  assert.deepEqual(parseSource("git@github.com:x/lanes-plugin-tmux.git"), {
    kind: "git",
    location: "git@github.com:x/lanes-plugin-tmux.git",
    subdir: ""
  });
  assert.deepEqual(parseSource("ssh://git@host/x/y.git#/plugins/a/"), { kind: "git", location: "ssh://git@host/x/y.git", subdir: "plugins/a" });
});

test("anything else is a folder that must exist", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lanes-plugin-src-"));
  assert.deepEqual(parseSource(dir), { kind: "path", location: dir, subdir: "" });
  assert.throws(() => parseSource(path.join(dir, "missing")), /is not a folder/);
  assert.throws(() => parseSource("  "), /Give a git URL/);
  fs.rmSync(dir, { recursive: true, force: true });
});
