// Runtime half of the plugin API: the version a plugin was written against, and the names
// of the environment variables lanes sets for a lane's commands. See index.d.ts for the
// interface and plugins/README.md for how to write a plugin.

// Bumped when the Plugin interface changes in a way an existing plugin would not survive.
export const API_VERSION = 1;

export const ENV = {
  // The lane name, e.g. `ABC-1437`.
  lane: "LANE_NAME",
  // The lane folder, also the working directory of every command.
  lanePath: "LANE_PATH",
  // Unique across the workspace (`<base>-<lane>` with several bases); file things under it.
  laneKey: "LANE_KEY",
  // What people see: `ABC-1437`, or `ABC-1437 (api)` with several bases.
  laneLabel: "LANE_LABEL",
  branch: "LANE_BRANCH",
  base: "LANE_BASE",
  // The workspace folder.
  root: "LANE_ROOT",
  // `1` while the lane is being opened right after its creation.
  created: "LANE_CREATED",
  // A folder a command may drop a `<anything>.flush` file into, holding one command line
  // that lanes runs once the whole list has run. Set only while lanes runs a list.
  afterDir: "LANE_AFTER_DIR",
  // `1` when the setup prompt was accepted: include your setup commands.
  runSetup: "LANE_RUN_SETUP"
};
