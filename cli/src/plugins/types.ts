// lanes compiles against the same interface plugins do.
export type { Asker, CommandList, DoctorLine, Leftover, Plugin, LaneCommands, LaneContext } from "lanes-plugin-api";

export const COMMAND_LISTS = ["open", "create", "remove"] as const;
