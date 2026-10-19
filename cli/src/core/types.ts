import type { LaneCommands } from "../plugins/types.js";

// One base git repository a workspace creates lanes from. A workspace can hold
// several (for example `api` and `web`); each keeps its lanes in its own `lanesDir`.
export interface BaseConfig extends Partial<LaneCommands> {
  // Short label used in lane paths, plugin command file names and the picker. Only
  // letters, digits, `.`, `_` and `-`.
  name: string;
  // Folder of the git clone, relative to the config directory.
  folder: string;
  // Git ref new lane branches start from, e.g. `origin/main`.
  ref: string;
  // Where this base's lane folders live, relative to the config directory.
  lanesDir: string;
  // Optional override of the top-level branch prefix.
  branchPrefix?: string;
  // `open`, `create` and `remove`: the command lines run for this base's lanes. A list
  // falls back to the top-level one when absent; a base with no `open` anywhere is rejected.
  // File path or URL the lists were loaded from, so `lanes commands update` can refresh them.
  template?: string;
}

export interface LanesConfig extends Partial<LaneCommands> {
  lanePrefix: string;
  branchPrefix: string;
  oldLaneDays: number;
  bases: BaseConfig[];
  // `open`, `create` and `remove`: shared fallbacks for bases without their own lists.
  // Where to install each plugin the lists use (`lanes <name> …`): name → git URL or path.
  plugins?: Record<string, string>;
}
