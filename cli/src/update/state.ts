// Where lane remembers what the last background check found. Deliberately outside the
// managed checkout: the updater resets that tree, and a file inside it would also show up
// in lane's own "is the checkout clean" guard.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface UpdateState {
  // The sha origin/main pointed at when the last check finished. An update is pending when
  // this differs from local HEAD, which also means a manual install.sh run clears it for free.
  remoteSha?: string;
  checkedAt?: number;
  // A commit that failed to build. Retrying it on every invocation would cost half a minute
  // each time while main is broken, so it is skipped until the remote moves past it.
  failedSha?: string;
}

interface InstallMarker {
  installDir?: string;
}

const LOCK_STALE_MS = 10 * 60 * 1000;

function stateDir(): string {
  return path.join(os.homedir(), ".lane");
}

function statePath(): string {
  return path.join(stateDir(), "state.json");
}

function markerPath(): string {
  return path.join(stateDir(), "install.json");
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    // Missing or corrupt is the same as "nothing recorded"; never throw from here.
    return null;
  }
}

// Written tmp-then-rename so two background checks finishing at once cannot leave a
// half-written file behind.
function writeJson(file: string, value: unknown): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(tmp, file);
  } catch {
    // State is an optimisation. Failing to record it must never break a command.
  }
}

export function readState(): UpdateState {
  return readJson<UpdateState>(statePath()) ?? {};
}

export function writeState(patch: Partial<UpdateState>): void {
  writeJson(statePath(), { ...readState(), ...patch });
}

export function readInstallMarker(): InstallMarker {
  return readJson<InstallMarker>(markerPath()) ?? {};
}

interface LockBody {
  pid?: number;
  startedAt?: number;
}

// mkdir is atomic everywhere, so it is the lock. A lock is stale only when it is both old
// and its owner is gone, so a slow update is never stolen and a crashed one never blocks.
export function acquireLock(): (() => void) | null {
  const lockDir = path.join(stateDir(), "update.lock");
  const bodyFile = path.join(lockDir, "owner.json");
  const release = () => {
    try {
      fs.rmSync(lockDir, { recursive: true, force: true });
    } catch {
      // Nothing useful to do if the lock cannot be removed.
    }
  };

  try {
    fs.mkdirSync(stateDir(), { recursive: true });
    fs.mkdirSync(lockDir);
    writeJson(bodyFile, { pid: process.pid, startedAt: Date.now() } satisfies LockBody);
    return release;
  } catch {
    // Someone holds it. Take it over only if it is old and its owner has gone away.
    const body = readJson<LockBody>(bodyFile);
    const age = Date.now() - (body?.startedAt ?? 0);
    if (age < LOCK_STALE_MS) {
      return null;
    }
    if (body?.pid) {
      try {
        process.kill(body.pid, 0);
        return null; // Still running, however long it has taken.
      } catch {
        // ESRCH: the owner is gone.
      }
    }
    release();
    try {
      fs.mkdirSync(lockDir);
      writeJson(bodyFile, { pid: process.pid, startedAt: Date.now() } satisfies LockBody);
      return release;
    } catch {
      return null;
    }
  }
}
