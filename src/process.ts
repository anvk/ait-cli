import { spawnSync, type SpawnSyncOptionsWithBufferEncoding } from "node:child_process";

interface RunResult {
  stdout: string;
  stderr: string;
}

function normalizeOutput(value: string | Buffer | null | undefined): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value == null) {
    return "";
  }
  return value.toString("utf8").trim();
}

function formatCommand(command: string, args: string[]): string {
  return `${command} ${args.join(" ")}`.trim();
}

export function run(
  command: string,
  args: string[],
  options: SpawnSyncOptionsWithBufferEncoding = {}
): RunResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
    ...options
  });

  if (result.status !== 0) {
    const stderr = normalizeOutput(result.stderr);
    const stdout = normalizeOutput(result.stdout);
    const details = stderr || stdout || "Command failed with no output";
    throw new Error(`${formatCommand(command, args)}\n${details}`);
  }

  return {
    stdout: normalizeOutput(result.stdout),
    stderr: normalizeOutput(result.stderr)
  };
}

export function runInteractive(
  command: string,
  args: string[],
  options: SpawnSyncOptionsWithBufferEncoding = {}
): void {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options
  });

  if (result.status !== 0) {
    throw new Error(`${formatCommand(command, args)} failed`);
  }
}

export function commandExists(command: string): boolean {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  return result.status === 0;
}
