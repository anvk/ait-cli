import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { shellJoin, shellSplit } from "./shell.js";
import { isLaneLine, laneWords, runList, substitute, taskEnv } from "./run.js";
import type { TaskContext } from "../plugins/types.js";

const ctx: TaskContext = {
  taskName: "LANE-1",
  taskPath: "/w/tasks/api/LANE-1",
  key: "api-LANE-1",
  label: "LANE-1 (api)",
  branch: "alex/LANE-1",
  base: "api",
  root: "/w",
  created: true
};

test("shellSplit handles quotes and escapes", () => {
  assert.deepEqual(shellSplit(`lane warp tab API --command 'claude --continue' --path server`), [
    "lane", "warp", "tab", "API", "--command", "claude --continue", "--path", "server"
  ]);
  assert.deepEqual(shellSplit(`echo "a \\"b\\" c" d\\ e ''`), ["echo", 'a "b" c', "d e", ""]);
  assert.throws(() => shellSplit("echo 'open"), /unterminated single quote/);
});

test("shellJoin quotes only what needs it and round-trips", () => {
  const words = ["lane", "warp", "tab", "My Tab", "--command", "claude --continue", "--path", "server/api", "it's"];
  const line = shellJoin(words);
  assert.equal(line, `lane warp tab 'My Tab' --command 'claude --continue' --path server/api 'it'\\''s'`);
  assert.deepEqual(shellSplit(line), words);
});

test("placeholders are substituted shell-quoted", () => {
  assert.equal(substitute("tmux new-window -c {path} -n {task}", ctx), "tmux new-window -c /w/tasks/api/LANE-1 -n LANE-1");
  assert.equal(substitute("echo {branch} {base} {root}", ctx), "echo alex/LANE-1 api /w");
  assert.equal(substitute("echo {a,b} {task}", { ...ctx, taskName: "DEV 1" }), "echo {a,b} 'DEV 1'");
});

test("a line starting with lane runs this same lane", () => {
  assert.ok(isLaneLine("lane warp tab API") && isLaneLine("  lane") && !isLaneLine("lanes merge") && !isLaneLine("cursor ."));
  assert.deepEqual(laneWords("lane warp tab API --color red"), ["warp", "tab", "API", "--color", "red"]);
  assert.equal(laneWords("cursor ."), null);
  const line = substitute("lane warp tab API", ctx);
  assert.ok(line.startsWith(shellJoin([process.execPath, process.argv[1]])), line);
  assert.ok(line.endsWith(" warp tab API"), line);
});

test("runList runs lines in order, then what was left in the after-directory, and goes on past a failure", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lane-runlist-"));
  const log = path.join(dir, "log");
  const quiet = console.log;
  console.log = () => {};
  try {
    runList(
      { ...ctx, taskPath: dir },
      [
        `echo first >> ${log}`,
        `echo 'echo flushed >> ${log}' > "$LANE_AFTER_DIR/x.flush"`,
        "exit 3",
        `echo second {task} $LANE_TASK_KEY >> ${log}`
      ],
      { after: true }
    );
  } finally {
    console.log = quiet;
  }
  assert.equal(fs.readFileSync(log, "utf8"), "first\nsecond LANE-1 api-LANE-1\nflushed\n");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the task reaches commands through LANE_* variables", () => {
  assert.deepEqual(taskEnv(ctx), {
    LANE_TASK: "LANE-1",
    LANE_TASK_PATH: "/w/tasks/api/LANE-1",
    LANE_TASK_KEY: "api-LANE-1",
    LANE_TASK_LABEL: "LANE-1 (api)",
    LANE_BRANCH: "alex/LANE-1",
    LANE_BASE: "api",
    LANE_ROOT: "/w",
    LANE_CREATED: "1"
  });
});
