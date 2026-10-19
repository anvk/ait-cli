// lane compiles against the same interface plugins do.
export type { Asker, CommandList, DoctorLine, Leftover, Plugin, TaskCommands, TaskContext } from "lane-plugin-api";

export const COMMAND_LISTS = ["open", "create", "remove"] as const;
