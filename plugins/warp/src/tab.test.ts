import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTabWords, tabLine } from "./tab.js";

test("a lanes warp tab line parses to a spec and back", () => {
  const spec = parseTabWords([
    "API",
    "--path",
    "server/",
    "--color",
    "Red",
    "--command",
    "make run",
    "--setup",
    "make dev",
    "--group"
  ]);
  assert.deepEqual(spec, {
    title: "API",
    path: "server",
    color: "red",
    command: "make run",
    setup: "make dev",
    group: true,
    newWindow: false
  });
  assert.equal(
    tabLine(spec),
    "lanes warp tab API --path server --color red --command 'make run' --setup 'make dev' --group"
  );
  assert.deepEqual(parseTabWords(["CLI"]), { title: "CLI", path: ".", group: false, newWindow: false });
  assert.equal(tabLine(parseTabWords(["CLI"])), "lanes warp tab CLI");
});

test("bad tab lines are rejected with a reason", () => {
  assert.throws(() => parseTabWords([]), /title/);
  assert.throws(() => parseTabWords(["API", "--color", "purple"]), /Warp only supports/);
  assert.throws(() => parseTabWords(["API", "--path", "~/x"]), /relative to the lane folder/);
  assert.throws(() => parseTabWords(["API", "--path", ".."]), /inside the lane folder/);
  assert.throws(() => parseTabWords(["API", "--bogus"]), /unknown option/);
  assert.throws(() => parseTabWords(["API", "extra"]), /too many arguments/);
});
