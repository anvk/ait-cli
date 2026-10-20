import os from "node:os";
import path from "node:path";

// Where lanes keeps its own files: update state, installed plugins and their record.
export function lanesHome(): string {
  return path.join(os.homedir(), ".lanes");
}

export function pluginsRoot(): string {
  return path.join(lanesHome(), "plugins");
}

export function pluginsFile(): string {
  return path.join(lanesHome(), "plugins.json");
}

// The package inside the managed checkout the curl installer creates.
export function defaultInstallDir(): string {
  return path.join(os.homedir(), ".lanes-cli", "cli");
}

// `~` and `~/x` as typed in a path, made absolute. `~name/x` (another user's home) is left
// as written rather than read as a folder inside yours.
export function expandHome(p: string): string {
  if (p === "~") {
    return os.homedir();
  }
  return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}
