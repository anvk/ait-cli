import { test } from "node:test";
import assert from "node:assert/strict";
import { looksLikeTaskId } from "./tasks.js";

test("raw ids and prefixed task names take the `lane <id>` shortcut", () => {
  for (const word of ["1437", "558-fix", "LANE-1437", "abc-12", "LANE-558-fix-login"]) {
    assert.equal(looksLikeTaskId(word), true, word);
  }
});

test("plain words do not, so a mistyped command is not taken for a task", () => {
  for (const word of ["lst", "lsit", "login", "LANE-login", "-1437", ""]) {
    assert.equal(looksLikeTaskId(word), false, word);
  }
});
