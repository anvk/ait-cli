import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hasOrigin } from "./git.js";

const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

// A repository with one commit on `branch`, as `git init` or a project generator leaves it.
function localRepo(branch: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lanes-git-"));
  git(dir, ["init", "-q", "-b", branch]);
  git(dir, ["commit", "-q", "--allow-empty", "-m", "init"]);
  return dir;
}

function cloneOf(source: string): string {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lanes-clone-")), "clone");
  git(path.dirname(dir), ["clone", "-q", source, dir]);
  return dir;
}

test("only a repository with an origin remote is fetched", () => {
  const repo = localRepo("main");
  assert.equal(hasOrigin(repo), false);
  assert.equal(hasOrigin(cloneOf(repo)), true);
});
