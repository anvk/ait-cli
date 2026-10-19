import type { TaskCommands } from "../plugins/types.js";

// One base git repository a workspace creates tasks from. A workspace can hold
// several (for example `api` and `web`); each keeps its tasks in its own `tasksDir`.
export interface BaseConfig extends Partial<TaskCommands> {
  // Short label used in task paths, plugin command file names and the picker. Only
  // letters, digits, `.`, `_` and `-`.
  name: string;
  // Folder of the git clone, relative to the config directory.
  folder: string;
  // Git ref new task branches start from, e.g. `origin/main`.
  ref: string;
  // Where this base's task folders live, relative to the config directory.
  tasksDir: string;
  // Optional override of the top-level branch prefix.
  branchPrefix?: string;
  // `open`, `create` and `remove`: the command lines run for this base's tasks. A list
  // falls back to the top-level one when absent; a base with no `open` anywhere is rejected.
  // File path or URL the lists were loaded from, so `lane commands update` can refresh them.
  template?: string;
}

export interface LaneConfig extends Partial<TaskCommands> {
  taskPrefix: string;
  branchPrefix: string;
  oldTaskDays: number;
  bases: BaseConfig[];
  // `open`, `create` and `remove`: shared fallbacks for bases without their own lists.
  // Where to install each plugin the lists use (`lane <name> …`): name → git URL or path.
  plugins?: Record<string, string>;
}
