// Talking to the Warp application: is it installed, is it running, start it, close a tab.
import pc from "picocolors";
import { commandSucceeds, run } from "./support.js";

const WARP_APP_NAME = "Warp";
const WARP_STARTUP_TIMEOUT_MS = 10_000;
const WARP_POLL_INTERVAL_MS = 250;
const WARP_SETTLE_MS = 1_500;
export const WARP_TAB_INTERVAL_MS = 300;

function isWarpRunning(): boolean {
  // Warp's executable is named `stable`, not `Warp`, so matching on process name fails.
  try {
    return run("osascript", ["-e", `application "${WARP_APP_NAME}" is running`]) === "true";
  } catch {
    return false;
  }
}

export function isWarpInstalled(): boolean {
  return commandSucceeds("open", ["-Ra", WARP_APP_NAME]);
}

export function ensureWarpRunning(): void {
  if (isWarpRunning()) {
    return;
  }

  if (!isWarpInstalled()) {
    throw new Error(`${WARP_APP_NAME} is not installed. Install Warp from https://www.warp.dev and retry.`);
  }

  console.log(pc.cyan("Starting Warp..."));
  run("open", ["-a", WARP_APP_NAME]);

  const deadline = Date.now() + WARP_STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (isWarpRunning()) {
      // A cold-started Warp drops URIs until it registers its handler.
      sleepSync(WARP_SETTLE_MS);
      return;
    }
    sleepSync(WARP_POLL_INTERVAL_MS);
  }

  // Opening the URI starts Warp on its own, so a slow start is not fatal.
  console.log(
    pc.yellow(`Warp did not report as running within ${WARP_STARTUP_TIMEOUT_MS / 1000}s; opening anyway.`)
  );
}

// Warp exposes no URI for closing a tab, so the pane's shell is signalled to exit and
// Warp closes the tab with it. Returns false when this is not a Warp tab.
export function closeCurrentWarpTab(): boolean {
  if (process.env.TERM_PROGRAM !== "WarpTerminal") {
    return false;
  }
  // Give Warp a moment to act on the tab URIs before this shell goes away.
  sleepSync(WARP_TAB_INTERVAL_MS);
  process.kill(process.ppid, "SIGHUP");
  return true;
}

// Every lanes command is synchronous, so this blocks the thread instead of awaiting a timer.
export function sleepSync(milliseconds: number): void {
  const buffer = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(buffer, 0, 0, milliseconds);
}
