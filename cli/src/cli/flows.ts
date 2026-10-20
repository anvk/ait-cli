// The parts of creating, checking out and removing a lane that talk to you: the setup
// question and the typed confirmations. The work itself is in core/lifecycle.ts.
import fs from "node:fs";
import { stdin as input } from "node:process";
import pc from "picocolors";
import { resolveBaseCommands } from "../core/config.js";
import { uncommittedPaths } from "../core/git.js";
import { checkoutBranchLane, deleteLane, MAX_LISTED_DIRTY_ITEMS, openLane, type ForceOption, type OpenOptions } from "../core/lifecycle.js";
import type { BaseConfig, LanesConfig } from "../core/types.js";
import { ask } from "../core/util.js";
import { laneIdentity, resolveBaseRepoRoot, type LaneLocation } from "../core/workspace.js";
import { setupCommandsOf } from "../plugins/registry.js";

export async function checkoutAndOpen(
  configDir: string,
  config: LanesConfig,
  base: BaseConfig,
  branchName: string,
  options: OpenOptions & ForceOption
): Promise<void> {
  const { location, created } = checkoutBranchLane(configDir, config, base, branchName, options);
  const runSetup = created ? await askToRunSetup(config, base) : false;
  openLane(configDir, config, location, { ...options, created, runSetup });
}

// Asked once per new lane, and only when there is something to run: the base's `create`
// list, or a setup command carried by one of its `open` lines (a Warp tab's --setup).
export async function askToRunSetup(config: LanesConfig, base: BaseConfig): Promise<boolean> {
  const lists = resolveBaseCommands(config, base);
  const commands = [...lists.open.flatMap(setupCommandsOf), ...lists.create];
  if (commands.length === 0 || !input.isTTY) {
    return false;
  }
  const answer = await ask(`Run the env setup script (${commands.join(", ")})? [y/N] `);
  return /^y(es)?$/i.test(answer.trim());
}

export async function promptForExactConfirmation(prompt: string, expected: string): Promise<void> {
  const answer = (await ask(`${prompt}\n> `)).trim();
  if (answer !== expected) {
    throw new Error("Confirmation text did not match. Aborting.");
  }
}

export async function confirmAndRemoveLane(configDir: string, config: LanesConfig, location: LaneLocation): Promise<void> {
  const baseRepoRoot = resolveBaseRepoRoot(configDir, location.base);
  if (!fs.existsSync(location.lanePath)) {
    throw new Error(`Lane folder does not exist: ${location.lanePath}`);
  }

  const { label } = laneIdentity(config, location.base, location.laneName);
  // Say what would be lost before asking: removal discards uncommitted changes.
  const changed = await uncommittedPaths(location.lanePath);
  if (changed && changed.length > 0) {
    const shown = changed.slice(0, MAX_LISTED_DIRTY_ITEMS).map((p) => `    ${p}`);
    const more = changed.length > shown.length ? [`    ...and ${changed.length - shown.length} more`] : [];
    console.log(pc.red([`  ${label} has ${changed.length} file(s) with uncommitted changes, which removal discards:`, ...shown, ...more].join("\n")));
  }
  await promptForExactConfirmation(`Type 'delete' to permanently remove the lane worktree ${label}:`, "delete");
  deleteLane(configDir, config, location, baseRepoRoot);
  console.log(pc.green(`Removed lane: ${location.lanePath}`));
}
