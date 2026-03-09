import { commandExists, runInteractive } from "./process.js";

export function openInCursor(targetPath: string): void {
  if (!commandExists("cursor")) {
    throw new Error("Cursor CLI is unavailable. Install the `cursor` command and retry.");
  }
  runInteractive("cursor", [targetPath]);
}
