export interface AitConfig {
  prefix: string;
  tasksDir: string;
  baseRef: string;
  baseFolder: string;
}

export interface CreateOrAttachWorktreeArgs {
  repoRoot: string;
  taskPath: string;
  branchName: string;
  baseRef: string;
}
