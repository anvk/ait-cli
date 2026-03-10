import fs from "node:fs";
import path from "node:path";

export function toTaskName(taskPrefix: string, taskIdOrName: string): string {
  const cleanTaskIdOrName = String(taskIdOrName).trim();
  if (!cleanTaskIdOrName) {
    throw new Error("Task id is required.");
  }

  if (cleanTaskIdOrName.startsWith(taskPrefix)) {
    return cleanTaskIdOrName;
  }

  return `${taskPrefix}${cleanTaskIdOrName}`;
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

function isPathInside(childPath: string, parentPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function syncBaseFolderIntoTask(baseFolderPath: string, taskPath: string): void {
  if (!fs.existsSync(baseFolderPath) || !fs.statSync(baseFolderPath).isDirectory()) {
    throw new Error(`Base folder does not exist: ${baseFolderPath}`);
  }

  if (!fs.existsSync(taskPath)) {
    fs.mkdirSync(taskPath, { recursive: true });
  }
  if (!fs.statSync(taskPath).isDirectory()) {
    throw new Error(`Task destination is not a directory: ${taskPath}`);
  }

  const sourceRoot = fs.realpathSync.native(baseFolderPath);
  const destinationRoot = fs.realpathSync.native(taskPath);
  const entries = fs.readdirSync(sourceRoot, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === ".git") {
      continue;
    }

    const sourcePath = path.join(sourceRoot, entry.name);
    if (isPathInside(destinationRoot, sourcePath)) {
      // Avoid copying the folder that contains the destination into itself.
      continue;
    }

    const destinationPath = path.join(destinationRoot, entry.name);
    fs.cpSync(sourcePath, destinationPath, {
      recursive: true,
      force: true,
      errorOnExist: false
    });
  }
}

export function listTaskFolders(
  repoRoot: string,
  tasksDir: string,
  taskPrefix: string,
  baseFolder = "."
): string[] {
  const absoluteTasksDir = resolveTasksRoot(repoRoot, tasksDir, baseFolder);
  if (!fs.existsSync(absoluteTasksDir)) {
    return [];
  }

  return fs
    .readdirSync(absoluteTasksDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(taskPrefix))
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
