import fs from "node:fs";
import path from "node:path";

export function toTaskName(prefix: string, taskIdOrName: string): string {
  const cleanTaskIdOrName = String(taskIdOrName).trim();
  if (!cleanTaskIdOrName) {
    throw new Error("Task id is required.");
  }

  const prefixWithDash = `${prefix}-`;
  if (cleanTaskIdOrName.startsWith(prefixWithDash)) {
    return cleanTaskIdOrName;
  }

  return `${prefixWithDash}${cleanTaskIdOrName}`;
}

export function getTaskPath(
  repoRoot: string,
  tasksDir: string,
  taskName: string,
  baseFolder = "."
): string {
  return path.join(resolveTasksRoot(repoRoot, tasksDir, baseFolder), taskName);
}

export function resolveTasksRoot(
  repoRoot: string,
  tasksDir: string,
  baseFolder = "."
): string {
  return path.join(repoRoot, baseFolder, tasksDir);
}

export function ensureTasksDir(repoRoot: string, tasksDir: string, baseFolder = "."): string {
  const absoluteTasksDir = resolveTasksRoot(repoRoot, tasksDir, baseFolder);
  fs.mkdirSync(absoluteTasksDir, { recursive: true });
  return absoluteTasksDir;
}

export function listTaskFolders(
  repoRoot: string,
  tasksDir: string,
  prefix: string,
  baseFolder = "."
): string[] {
  const absoluteTasksDir = resolveTasksRoot(repoRoot, tasksDir, baseFolder);
  if (!fs.existsSync(absoluteTasksDir)) {
    return [];
  }

  return fs
    .readdirSync(absoluteTasksDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${prefix}-`))
    .map((entry) => entry.name)
    .sort();
}

export function getTaskLastUpdatedMs(taskPath: string): number {
  if (!fs.existsSync(taskPath)) {
    throw new Error(`Task folder does not exist: ${taskPath}`);
  }

  return getLatestMtimeMs(taskPath);
}

function getLatestMtimeMs(targetPath: string): number {
  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) {
    return stat.mtimeMs;
  }

  let latest = 0;
  const entries = fs.readdirSync(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git") {
      continue;
    }

    const childPath = path.join(targetPath, entry.name);
    const childMtime = getLatestMtimeMs(childPath);
    if (childMtime > latest) {
      latest = childMtime;
    }
  }

  return latest || stat.mtimeMs;
}
