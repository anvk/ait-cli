// Before a workspace's lists run, every plugin they mention has to be installed. With a
// terminal lanes offers to install a missing one from the source the config names.
import { stdin as input } from "node:process";
import pc from "picocolors";
import type { LanesConfig } from "../core/types.js";
import { ask } from "../core/util.js";
import { installPlugin } from "./install.js";
import { loadPlugins } from "./load.js";
import { missingPlugins, setPlugins } from "./registry.js";

export async function ensurePlugins(config: LanesConfig): Promise<void> {
  for (const name of missingPlugins(config)) {
    const source = config.plugins?.[name];
    if (!source) {
      throw new Error(
        `Plugin '${name}' is not installed, and the config does not say where to get it.\nAdd it under "plugins" in .lanes.json, or run: lanes plugin install <git URL or path>`
      );
    }
    const command = `lanes plugin install ${source}`;
    if (!input.isTTY) {
      throw new Error(`Plugin '${name}' is not installed. Run: ${command}`);
    }
    console.log(pc.yellow(`This workspace uses plugin '${name}', which is not installed.`));
    const answer = (await ask(`Install it from ${source}? [Y/n] `)).trim();
    if (answer && !/^y(es)?$/i.test(answer)) {
      throw new Error(`Plugin '${name}' is not installed. Run: ${command}`);
    }
    const record = await installPlugin(source);
    if (record.name !== name) {
      throw new Error(`${source} installed plugin '${record.name}', but the config needs '${name}'.`);
    }
    const loaded = await loadPlugins();
    setPlugins(loaded.plugins, loaded.broken);
  }
}
