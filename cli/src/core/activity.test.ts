import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { uncommittedPaths } from "./git.js";
import { getLaneActivityMs } from "./lanes.js";

const DAY = 24 * 60 * 60 * 1000;

// A base repository whose only commit is 30 days old, and a lane worktree made from it now.
function laneFromOldCommit(): { lane: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lanes-activity-"));
  const base = path.join(root, "base");
  fs.mkdirSync(base);
  const old = new Date(Date.now() - 30 * DAY).toISOString();
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
    GIT_AUTHOR_DATE: old,
    GIT_COMMITTER_DATE: old
  };
  const git = (args: string[], cwd = base) =>
    assert.equal(spawnSync("git", args, { cwd, env }).status, 0, args.join(" "));
  git(["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(base, "a.txt"), "a\n");
  fs.writeFileSync(path.join(base, "b.txt"), "b\n");
  git(["add", "."]);
  git(["commit", "-qm", "old"]);
  const lane = path.join(root, "lanes", "1");
  git(["worktree", "add", "-q", "-b", "lane-1", lane]);
  return { lane };
}

test("a new lane made from an old commit counts as new, not old", async () => {
  const { lane } = laneFromOldCommit();
  assert.ok(Date.now() - (await getLaneActivityMs(lane, [])) < DAY);
});

test("a symlink loop in a lane does not break its age", async () => {
  const { lane } = laneFromOldCommit();
  fs.symlinkSync("..", path.join(lane, "up"));
  const changed = await uncommittedPaths(lane);
  assert.ok(Date.now() - (await getLaneActivityMs(lane, changed)) < DAY);
});

test("uncommitted changes, new files and renames are what removal would lose", async () => {
  const { lane } = laneFromOldCommit();
  assert.deepEqual(await uncommittedPaths(lane), []);
  fs.appendFileSync(path.join(lane, "a.txt"), "edit\n");
  fs.mkdirSync(path.join(lane, "notes"));
  fs.writeFileSync(path.join(lane, "notes", "todo.md"), "x\n");
  spawnSync("git", ["mv", "b.txt", "c.txt"], { cwd: lane });
  assert.deepEqual((await uncommittedPaths(lane))?.sort(), ["a.txt", "c.txt", "notes"]);
  assert.equal(await uncommittedPaths(path.join(lane, "..", "missing")), null);
});
