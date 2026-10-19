import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { npmInstallNeeded } from "./index.js";

// A checkout like ~/.lane-cli: the package lives in a subfolder of the repository.
function repoWithPackage(): { root: string; packageRoot: string; git: (args: string[]) => string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lane-update-"));
  const git = (args: string[]): string => {
    const result = spawnSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" }
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(["init", "-q", "-b", "main"]);
  const packageRoot = path.join(root, "cli");
  fs.mkdirSync(packageRoot);
  fs.writeFileSync(path.join(packageRoot, "package.json"), '{"dependencies":{}}\n');
  fs.writeFileSync(path.join(packageRoot, "index.js"), "// v1\n");
  git(["add", "."]);
  git(["commit", "-qm", "one"]);
  return { root, packageRoot, git };
}

test("a dependency change in the package's own package.json calls for npm install", () => {
  const { root, packageRoot, git } = repoWithPackage();
  const from = git(["rev-parse", "HEAD"]);
  fs.writeFileSync(path.join(packageRoot, "package.json"), '{"dependencies":{"lane-plugin-api":"file:../plugins/api"}}\n');
  git(["commit", "-qam", "two"]);
  assert.equal(npmInstallNeeded({ packageRoot }, from), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a change elsewhere does not, and an unknown commit does", () => {
  const { root, packageRoot, git } = repoWithPackage();
  const from = git(["rev-parse", "HEAD"]);
  fs.writeFileSync(path.join(packageRoot, "index.js"), "// v2\n");
  git(["commit", "-qam", "two"]);
  assert.equal(npmInstallNeeded({ packageRoot }, from), false);
  assert.equal(npmInstallNeeded({ packageRoot }, "0000000000000000000000000000000000000000"), true);
  fs.rmSync(root, { recursive: true, force: true });
});
