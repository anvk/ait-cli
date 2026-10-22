import fs from "node:fs";
import { formatRelativeTime } from "../core/format.js";
import { runAllowFailure } from "../core/process.js";
import { updateIsPending } from "./index.js";
import { describeVersion, resolveInstall, type InstallInfo } from "./install.js";
import { readInstalled } from "../plugins/state.js";
import { readState } from "./state.js";

function formatCheckedAt(checkedAt?: number): string {
  if (!checkedAt) {
    return "never checked";
  }
  return `checked ${formatRelativeTime(checkedAt)}`;
}

// Printed at the top of doctor, before the config checks, so they show even in a directory
// that has no .lanes.json.
export function selfUpdateDiagnostics(): { level: "ok" | "warn"; message: string }[] {
  const lines: { level: "ok" | "warn"; message: string }[] = [];
  let info: InstallInfo;
  try {
    info = resolveInstall();
  } catch {
    return [{ level: "warn", message: "Could not determine which lanes install is running" }];
  }

  lines.push({ level: "ok", message: `lanes ${describeVersion(info)} on branch ${info.branch ?? "(detached)"}` });

  if (info.managed) {
    lines.push({ level: "ok", message: `Installed at ${info.packageRoot} (managed; self-update on)` });
  } else {
    lines.push({
      level: "warn",
      message: `Linked from ${info.packageRoot}, not the managed install — self-update is off`
    });
  }

  // The one failure this cannot report on its own is lanes being unrunnable, so doctor is
  // where it gets caught: `node <installdir>/dist/bin/lanes.js doctor` still works when the
  // `lanes` command itself does not.
  try {
    fs.accessSync(info.distEntry, fs.constants.X_OK);
  } catch {
    lines.push({
      level: "warn",
      message: `${info.distEntry} is not executable, so the 'lanes' command will fail. Fix with: chmod +x ${info.distEntry}`
    });
  }

  const plugins = readInstalled();
  if (plugins.length > 0) {
    lines.push({
      level: "ok",
      message: `${plugins.length} plugin(s) installed; they update with lanes (see 'lanes plugin list')`
    });
  }

  if (process.env.LANES_NO_AUTO_UPDATE) {
    lines.push({ level: "warn", message: "LANES_NO_AUTO_UPDATE is set, so lanes will not update itself" });
  }

  const { checkedAt } = readState();
  if (info.managed) {
    lines.push(
      updateIsPending(info)
        ? { level: "warn", message: `An update is ready and applies on the next start (${formatCheckedAt(checkedAt)})` }
        : { level: "ok", message: `Up to date (${formatCheckedAt(checkedAt)})` }
    );
  }

  if (info.gitRoot) {
    const untracked = runAllowFailure("git", ["ls-files", "--others", "--exclude-standard"], {
      cwd: info.gitRoot
    });
    if (untracked.status === 0 && untracked.stdout.length > 0) {
      const count = untracked.stdout.split("\n").length;
      lines.push({
        level: "warn",
        message: `${count} untracked file(s) in ${info.gitRoot} (they do not block updates, but nothing will clean them up)`
      });
    }
  }

  return lines;
}
