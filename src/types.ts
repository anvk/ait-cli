export const WARP_COLORS = ["red", "green", "yellow", "blue", "magenta", "cyan"] as const;

export type WarpColor = (typeof WARP_COLORS)[number];

export interface WarpTabConfig {
  title: string;
  path: string;
  color?: WarpColor;
  command?: string;
}

export interface AitConfig {
  taskPrefix: string;
  branchPrefix: string;
  tasksDir: string;
  baseRef: string;
  baseFolder: string;
  oldTaskDays: number;
  warpTabs: WarpTabConfig[];
}

export interface CreateOrAttachWorktreeArgs {
  repoRoot: string;
  taskPath: string;
  branchName: string;
  baseRef: string;
}
