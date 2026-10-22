import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { importPlugin } from "./load.js";

// A plugin folder as `lanes plugin install` leaves it: a package.json and a built entry.
function fakePlugin(body: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lanes-fake-plugin-"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "lanes-plugin-fake", main: "dist/index.js", lanes: { name: "fake", api: 1 } })
  );
  fs.mkdirSync(path.join(dir, "dist"));
  fs.writeFileSync(path.join(dir, "dist", "index.js"), body);
  return dir;
}

const complete = `export default {
  api: 1, name: "fake", description: "a fake", register() {}, validate() {}, setupCommands() { return []; },
  doctor() { return []; }, forget() {}, findLeftovers() { return []; }
};`;

test("a built plugin with the right shape loads", async () => {
  const plugin = await importPlugin(fakePlugin(complete), "fake");
  assert.equal(plugin.name, "fake");
  assert.equal(plugin.api, 1);
});

test("plugins that would not work are refused with a reason", async () => {
  await assert.rejects(importPlugin(fakePlugin(complete), "other"), /calls itself 'fake'/);
  await assert.rejects(importPlugin(fakePlugin(complete.replace("api: 1", "api: 2"))), /plugin API 2/);
  await assert.rejects(importPlugin(fakePlugin(complete.replace("forget() {},", ""))), /missing forget/);
  await assert.rejects(importPlugin(fakePlugin("export const plugin = {};")), /default export/);
  const unbuilt = fakePlugin(complete);
  fs.rmSync(path.join(unbuilt, "dist"), { recursive: true });
  await assert.rejects(importPlugin(unbuilt), /is the plugin built/);
});
