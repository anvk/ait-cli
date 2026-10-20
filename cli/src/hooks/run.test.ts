import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { shellJoin, shellSplit } from "./shell.js";
import { isLanesLine, lanesWords, runList, substitute, laneEnv } from "./run.js";
import type { LaneContext } from "../plugins/types.js";

const ctx: LaneContext = {
  laneName: "ABC-1",
  lanePath: "/w/lanes/api/ABC-1",
  key: "api-ABC-1",
  label: "ABC-1 (api)",
  branch: "alex/ABC-1",
  base: "api",
  root: "/w",
  created: true
};

test("shellSplit handles quotes and escapes", () => {
  assert.deepEqual(shellSplit(`lanes warp tab API --command 'claude --continue' --path server`), [
    "lanes", "warp", "tab", "API", "--command", "claude --continue", "--path", "server"
  ]);
  assert.deepEqual(shellSplit(`echo "a \\"b\\" c" d\\ e ''`), ["echo", 'a "b" c', "d e", ""]);
  assert.throws(() => shellSplit("echo 'open"), /unterminated single quote/);
});

test("shellJoin quotes only what needs it and round-trips", () => {
  const words = ["lanes", "warp", "tab", "My Tab", "--command", "claude --continue", "--path", "server/api", "it's"];
  const line = shellJoin(words);
  assert.equal(line, `lanes warp tab 'My Tab' --command 'claude --continue' --path server/api 'it'\\''s'`);
  assert.deepEqual(shellSplit(line), words);
});

test("placeholders are substituted shell-quoted", () => {
  assert.equal(substitute("tmux new-window -c {path} -n {lane}", ctx), "tmux new-window -c /w/lanes/api/ABC-1 -n ABC-1");
  assert.equal(substitute("echo {branch} {base} {root}", ctx), "echo alex/ABC-1 api /w");
  assert.equal(substitute("echo {a,b} {lane}", { ...ctx, laneName: "DEV 1" }), "echo {a,b} 'DEV 1'");
});

test("a line starting with lanes runs this same lanes", () => {
  assert.ok(isLanesLine("lanes warp tab API") && isLanesLine("  lanes") && !isLanesLine("lanesplitting is a thing") && !isLanesLine("cursor ."));
  assert.deepEqual(lanesWords("lanes warp tab API --color red"), ["warp", "tab", "API", "--color", "red"]);
  assert.equal(lanesWords("cursor ."), null);
  const line = substitute("lanes warp tab API", ctx);
  assert.ok(line.startsWith(shellJoin([process.execPath, process.argv[1]])), line);
  assert.ok(line.endsWith(" warp tab API"), line);
});

test("runList runs lines in order, then what was left in the after-directory, and goes on past a failure", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lanes-runlist-"));
  const log = path.join(dir, "log");
  const quiet = console.log;
  console.log = () => {};
  try {
    runList(
      { ...ctx, lanePath: dir },
      [
        `echo first >> ${log}`,
        `echo 'echo flushed >> ${log}' > "$LANE_AFTER_DIR/x.flush"`,
        "exit 3",
        `echo second {lane} $LANE_KEY >> ${log}`
      ],
      { after: true }
    );
  } finally {
    console.log = quiet;
  }
  assert.equal(fs.readFileSync(log, "utf8"), "first\nsecond ABC-1 api-ABC-1\nflushed\n");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the lane reaches commands through LANES_* variables", () => {
  assert.deepEqual(laneEnv(ctx), {
    LANE_NAME: "ABC-1",
    LANE_PATH: "/w/lanes/api/ABC-1",
    LANE_KEY: "api-ABC-1",
    LANE_LABEL: "ABC-1 (api)",
    LANE_BRANCH: "alex/ABC-1",
    LANE_BASE: "api",
    LANE_ROOT: "/w",
    LANE_CREATED: "1"
  });
});

test("placeholders survive the shell bare, in double quotes and in single quotes", async () => {
  const { spawnSync } = await import("node:child_process");
  const tricky = { ...ctx, lanePath: `/w/my lanes/it's a "$HOME" lane` };
  for (const line of ["printf %s {path}", 'printf %s "{path}"', "printf %s '{path}'", 'printf %s "dir: {path}!"']) {
    const out = spawnSync("sh", ["-c", substitute(line, tricky)], { encoding: "utf8" }).stdout;
    const expected = line.includes("dir: ") ? `dir: ${tricky.lanePath}!` : tricky.lanePath;
    assert.equal(out, expected, line);
  }
});
