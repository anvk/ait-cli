import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// The installer, self-update and plugin installs run `npm ci`, which fails when a
// lockfile does not match its package.json. Catch that here, before it reaches an install.
for (const dir of ["cli", "plugins/api", "plugins/warp"]) {
  test(`${dir}/package-lock.json matches its package.json`, () => {
    const read = (name: string) => JSON.parse(fs.readFileSync(path.join(repoRoot, dir, name), "utf8")) as Record<string, unknown>;
    const pkg = read("package.json");
    const locked = (read("package-lock.json").packages as Record<string, Record<string, unknown>>)[""];
    const bin = pkg.bin && Object.fromEntries(Object.entries(pkg.bin as Record<string, string>).map(([k, v]) => [k, v.replace(/^\.\//, "")]));
    assert.deepEqual(locked.bin, bin, `"bin" differs; run npm install --package-lock-only in ${dir}`);
    for (const key of ["name", "version", "license", "engines", "dependencies", "devDependencies", "peerDependencies"]) {
      assert.deepEqual(locked[key], pkg[key], `"${key}" differs; run npm install --package-lock-only in ${dir}`);
    }
  });
}
