export interface AitConfig {
  taskPrefix: string;
  branchPrefix: string;
  tasksDir: string;
  baseRef: string;
  baseFolder: string;
  oldTaskDays: number;
}

export interface CreateOrAttachWorktreeArgs {
  repoRoot: string;
  taskPath: string;
  branchName: string;
  baseRef: string;
}
