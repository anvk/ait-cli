// The interface a lane plugin implements. A plugin is a command lane ships as `lane <name> …`
// that a base's command lists may use; lane asks it to validate its lines when a config is
// read, to say what it needs in doctor, and to clean up what it left on disk for a task.
import type { Command } from "commander";

export declare const API_VERSION: 1;

export declare const ENV: {
  readonly task: "LANE_TASK";
  readonly taskPath: "LANE_TASK_PATH";
  readonly taskKey: "LANE_TASK_KEY";
  readonly taskLabel: "LANE_TASK_LABEL";
  readonly branch: "LANE_BRANCH";
  readonly base: "LANE_BASE";
  readonly root: "LANE_ROOT";
  readonly created: "LANE_CREATED";
  readonly afterDir: "LANE_AFTER_DIR";
  readonly runSetup: "LANE_RUN_SETUP";
};

// What a base runs around a task. Every entry is a shell command line.
export interface TaskCommands {
  // Every time the task opens.
  open: string[];
  // Once, right after the task is created, when the setup prompt is accepted.
  create: string[];
  // Before the task is deleted, while its folder still exists.
  remove: string[];
}

export type CommandList = keyof TaskCommands;

// The task a command line runs for; the same facts reach commands through ENV.
export interface TaskContext {
  taskName: string;
  taskPath: string;
  key: string;
  label: string;
  branch: string;
  base: string;
  root: string;
  created: boolean;
}

export interface DoctorLine {
  level: "ok" | "warn" | "fail";
  message: string;
}

export interface Leftover {
  // The task key the files were written under.
  key: string;
  files: string[];
}

// The questions `lane init` can ask on a plugin's behalf. Every answer is a trimmed string;
// a blank answer takes the default.
export interface Asker {
  ask(label: string, defaultValue?: string): Promise<string>;
  // Re-asks until `validate` returns null.
  validated(label: string, defaultValue: string | undefined, validate: (value: string) => string | null): Promise<string>;
  required(label: string, validate: (value: string) => string | null): Promise<string>;
  // Empty is a real answer: the default reads `none`, and typing `none` clears a value.
  optional(label: string, current: string): Promise<string>;
  yesNo(label: string, defaultYes: boolean): Promise<boolean>;
  choice(label: string, choices: readonly string[], current: string): Promise<string>;
}

export interface Plugin {
  // Which version of this interface the plugin was written against.
  readonly api: typeof API_VERSION;
  // The subcommand name: `lane <name>`. Letters, digits and dashes.
  readonly name: string;
  readonly description: string;
  // Adds the plugin's subcommands under `lane <name>`. Use `command.command("sub")` on the
  // given instance rather than constructing Commands of your own, so they share lane's
  // commander.
  register(command: Command): void;
  // Throws with a reason when the words after `lane <name>` are not a valid command line.
  // Called whenever a config or document mentioning the plugin is read.
  validate(words: string[]): void;
  // Human-readable setup commands a line carries, for the prompt shown when a task is
  // created ("API: make dev").
  setupCommands(words: string[]): string[];
  // Checks for `lane doctor`, asked only when some base in the workspace uses the plugin.
  doctor(): DoctorLine[];
  // Delete whatever the plugin wrote for the task with this key.
  forget(key: string): void;
  // Files written for tasks whose key is no longer in `knownKeys`, for `lane prune`.
  findLeftovers(knownKeys: string[]): Leftover[];
  // Close the terminal tab the current command runs in, when it is this plugin's terminal.
  // Return false when it is not.
  closeCurrentTab?(): boolean;
  // Ask the questions that make up one line, for `lane init`. Returns the words after
  // `lane <name>`. `existing` holds the words of the line being edited, when there is one.
  prompt?(ask: Asker, existing?: string[]): Promise<string[]>;
}
