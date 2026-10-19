import { test } from "node:test";
import assert from "node:assert/strict";
import { taskNamesForBranch } from "./lifecycle.js";
import type { BaseConfig, LaneConfig } from "./types.js";

const base: BaseConfig = { name: "api", folder: "api-base", ref: "origin/main", tasksDir: "tasks/api" };
const config: LaneConfig = { taskPrefix: "LANE-", branchPrefix: "alex/", oldTaskDays: 14, bases: [base], warpTabGroup: false };

test("a branch lane made maps back to its task name", () => {
  assert.deepEqual(taskNamesForBranch(config, base, "alex/LANE-1437"), ["LANE-1437"]);
});

test("other branches are named after their last part, then the whole name", () => {
  assert.deepEqual(taskNamesForBranch(config, base, "someone/LANE-558-fix"), ["LANE-558-fix", "LANE-someone-LANE-558-fix"]);
  assert.deepEqual(taskNamesForBranch(config, base, "feat/login"), ["LANE-login", "LANE-feat-login"]);
  assert.deepEqual(taskNamesForBranch(config, base, "someone/lane-701"), ["LANE-701", "LANE-someone-lane-701"]);
  assert.deepEqual(taskNamesForBranch(config, base, "LANE-9"), ["LANE-9"]);
});
