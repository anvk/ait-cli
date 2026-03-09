import fs from "node:fs";
import { run, runInteractive } from "./process.js";
import type { CreateOrAttachWorktreeArgs } from "./types.js";

export function fetchOrigin(repoRoot: string): void {
  runInteractive("git", ["fetch", "origin"], { cwd: repoRoot });
}

function localBranchExists(repoRoot: string, branchName: string): boolean {
  try {
    run("git", ["show-ref", "--verify", `refs/heads/${branchName}`], { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
}

export function createOrAttachWorktree({
  repoRoot,
  taskPath,
  branchName,
  baseRef
}: CreateOrAttachWorktreeArgs): void {
  if (fs.existsSync(taskPath)) {
    throw new Error(`Task folder already exists: ${taskPath}`);
  }

  if (localBranchExists(repoRoot, branchName)) {
    runInteractive("git", ["worktree", "add", taskPath, branchName], { cwd: repoRoot });
    return;
  }

  runInteractive("git", ["worktree", "add", "-b", branchName, taskPath, baseRef], {
    cwd: repoRoot
  });
}

export function removeWorktree(repoRoot: string, taskPath: string): void {
  runInteractive("git", ["worktree", "remove", taskPath], { cwd: repoRoot });
}

export function deleteLocalBranch(
  repoRoot: string,
  branchName: string
): { deleted: boolean; message?: string } {
  if (!localBranchExists(repoRoot, branchName)) {
    return { deleted: false, message: "branch not found" };
  }

  try {
    run("git", ["branch", "-d", branchName], { cwd: repoRoot });
    return { deleted: true };
  } catch (error) {
    return {
      deleted: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}
