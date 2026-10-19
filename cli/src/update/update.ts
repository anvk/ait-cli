import pc from "picocolors";
import { applyUpdate, probeRemote, recoveryHint, updatePluginsQuietly } from "./index.js";
import { checkoutBlockers, describeVersion, resolveInstall, settingBlockers } from "./install.js";

export function runUpdateCommand(options: { check?: boolean }): void {
  const info = resolveInstall();
  console.log(`lanes ${describeVersion(info)}`);

  if (!info.gitRoot) {
    console.error(pc.red("lanes is not running from a git checkout, so it cannot update itself."));
    console.error(recoveryHint());
    process.exitCode = 1;
    return;
  }
  if (!info.managed) {
    console.error(
      pc.yellow(`lanes is linked from ${info.packageRoot}, which is a developer checkout, not the managed install.`)
    );
    console.error(pc.dim("Self-update stays off there. Build it yourself, or re-link the managed install."));
    process.exitCode = 1;
    return;
  }

  // Asked for explicitly, so not being in a terminal is no reason to refuse.
  const blockers = [...settingBlockers(), ...checkoutBlockers(info)];
  if (blockers.length > 0) {
    for (const reason of blockers) {
      console.error(pc.yellow(`Cannot update: ${reason}`));
    }
    process.exitCode = 1;
    return;
  }

  if (options.check) {
    // Ask the remote rather than trusting the cache.
    const remote = probeRemote(info);
    if (!remote) {
      console.error(pc.yellow("Could not reach the remote."));
      process.exitCode = 1;
      return;
    }
    if (remote === info.sha) {
      console.log("Up to date.");
      return;
    }
    console.log(`An update is ready: ${remote.slice(0, 7)}`);
    process.exitCode = 1;
    return;
  }

  const outcome = applyUpdate(info);
  switch (outcome.status) {
    case "updated":
      console.log(pc.green(`Updated to ${outcome.to}`));
      for (const line of updatePluginsQuietly()) {
        console.log(pc.dim(line));
      }
      break;
    case "current":
      console.log("Already up to date.");
      break;
    case "skipped":
      console.log(pc.yellow(`Skipped: ${outcome.reason}`));
      break;
    case "failed":
      console.error(pc.red(`Update failed: ${outcome.reason}`));
      console.error(recoveryHint());
      process.exitCode = 1;
      break;
  }
}
