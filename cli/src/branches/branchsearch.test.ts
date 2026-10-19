import { test } from "node:test";
import assert from "node:assert/strict";
import { rankBranches } from "./branchsearch.js";

const branch = (name: string, committedAtMs: number | null = null) => ({ name, committedAtMs, subject: null });

test("whole-name matches rank first, then name parts, then anywhere", () => {
  const ranked = rankBranches([branch("anvk/api-1558-foo"), branch("someone/558-fix"), branch("558")], "558");
  assert.deepEqual(
    ranked.map((b) => b.name),
    ["558", "someone/558-fix", "anvk/api-1558-foo"]
  );
});

test("within a tier the most recent commit wins, then the name", () => {
  const ranked = rankBranches([branch("b/fix", 1), branch("c/fix", 5), branch("a/fix", 1)], "fix");
  assert.deepEqual(
    ranked.map((b) => b.name),
    ["c/fix", "a/fix", "b/fix"]
  );
});
