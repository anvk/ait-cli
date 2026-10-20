import { test } from "node:test";
import assert from "node:assert/strict";
import { looksLikeLaneId, toLaneName } from "./lanes.js";

test("raw ids and prefixed lane names take the `lanes <id>` shortcut", () => {
  for (const word of ["1437", "558-fix", "ABC-1437", "abc-12", "ABC-558-fix-login"]) {
    assert.equal(looksLikeLaneId(word), true, word);
  }
});

test("plain words do not, so a mistyped command is not taken for a lane", () => {
  for (const word of ["lst", "lsit", "login", "ABC-login", "-1437", ""]) {
    assert.equal(looksLikeLaneId(word), false, word);
  }
});

test("without a prefix a lane is named by its id", () => {
  assert.equal(toLaneName("", "1437"), "1437");
  assert.equal(toLaneName("ABC-", "1437"), "ABC-1437");
  assert.equal(toLaneName("ABC-", "ABC-1437"), "ABC-1437");
});

test("a lane's key is always base and lane, so adding a base does not rename it", async () => {
  const { laneIdentity } = await import("./workspace.js");
  const base = { name: "app", folder: "app", ref: "origin/main", lanesDir: "lanes/app" };
  const one = { lanePrefix: "", branchPrefix: "", oldLaneDays: 14, bases: [base] };
  const two = { ...one, bases: [base, { ...base, name: "web", folder: "web", lanesDir: "lanes/web" }] };
  assert.deepEqual(laneIdentity(one as never, base, "1437"), { key: "app-1437", label: "1437" });
  assert.deepEqual(laneIdentity(two as never, base, "1437"), { key: "app-1437", label: "1437 (app)" });
});
