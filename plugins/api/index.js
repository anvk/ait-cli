// Runtime half of the plugin API: the version a plugin was written against, and the names
// of the environment variables lane sets for a task's commands. See index.d.ts for the
// interface and plugins/README.md for how to write a plugin.

// Bumped when the Plugin interface changes in a way an existing plugin would not survive.
export const API_VERSION = 1;

export const ENV = {
  // The task name, e.g. `LANE-1437`.
  task: "LANE_TASK",
  // The task folder, also the working directory of every command.
  taskPath: "LANE_TASK_PATH",
  // Unique across the workspace (`<base>-<task>` with several bases); file things under it.
  taskKey: "LANE_TASK_KEY",
  // What people see: `LANE-1437`, or `LANE-1437 (api)` with several bases.
  taskLabel: "LANE_TASK_LABEL",
  branch: "LANE_BRANCH",
  base: "LANE_BASE",
  // The workspace folder.
  root: "LANE_ROOT",
  // `1` while the task is being opened right after its creation.
  created: "LANE_CREATED",
  // A folder a command may drop a `<anything>.flush` file into, holding one command line
  // that lane runs once the whole list has run. Set only while lane runs a list.
  afterDir: "LANE_AFTER_DIR",
  // `1` when the setup prompt was accepted: include your setup commands.
  runSetup: "LANE_RUN_SETUP"
};
