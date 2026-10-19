import { test } from "node:test";
import assert from "node:assert/strict";
import { laneNamesForBranch } from "./lifecycle.js";
import type { BaseConfig, LanesConfig } from "./types.js";

const base: BaseConfig = { name: "api", folder: "api-base", ref: "origin/main", lanesDir: "lanes/api" };
const config: LanesConfig = { lanePrefix: "ABC-", branchPrefix: "alex/", oldLaneDays: 14, bases: [base], warpTabGroup: false };

test("a branch lanes made maps back to its lane name", () => {
  assert.deepEqual(laneNamesForBranch(config, base, "alex/ABC-1437"), ["ABC-1437"]);
});

test("other branches are named after their last part, then the whole name", () => {
  assert.deepEqual(laneNamesForBranch(config, base, "someone/ABC-558-fix"), ["ABC-558-fix", "ABC-someone-ABC-558-fix"]);
  assert.deepEqual(laneNamesForBranch(config, base, "feat/login"), ["ABC-login", "ABC-feat-login"]);
  assert.deepEqual(laneNamesForBranch(config, base, "someone/abc-701"), ["ABC-701", "ABC-someone-abc-701"]);
  assert.deepEqual(laneNamesForBranch(config, base, "ABC-9"), ["ABC-9"]);
});

test("without a lane prefix, branches are named after their last part as is", () => {
  const plain: LanesConfig = { ...config, lanePrefix: "" };
  assert.deepEqual(laneNamesForBranch(plain, base, "alex/1437"), ["1437"]);
  assert.deepEqual(laneNamesForBranch(plain, base, "feat/login"), ["login", "feat-login"]);
});
