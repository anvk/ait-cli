// `lane plugin list|install|uninstall|update`.
import type { Command } from "commander";
import pc from "picocolors";
import { installPlugin, listPlugins, uninstallPlugin, updatePlugins } from "./install.js";
import { brokenPluginList } from "./registry.js";

export function registerPluginCommands(program: Command): void {
  const plugin = program.command("plugin").description("Install, update and list lane plugins (`lane <plugin> …` commands)");

  plugin
    .command("list")
    .description("Show the installed plugins, their versions and whether they load")
    .action(() => {
      for (const line of listPlugins([...brokenPluginList()])) {
        console.log(line);
      }
    });

  plugin
    .command("install")
    .description("Install a plugin from a git URL (optionally #<folder in the repo>) or a local folder")
    .argument("<source>", "e.g. https://github.com/anvk/lane.git#plugins/warp, or ../my-plugin")
    .action(async (source: string) => {
      await installPlugin(source);
    });

  plugin
    .command("uninstall")
    .description("Remove an installed plugin")
    .argument("<name>", "Plugin name, as shown by `lane plugin list`")
    .action((name: string) => uninstallPlugin(name));

  plugin
    .command("update")
    .description("Pull and rebuild the installed plugins (or one of them); lane also does this when it updates itself")
    .argument("[name]", "Only this plugin")
    .action((name?: string) => {
      const notes = updatePlugins(name);
      if (notes.length === 0) {
        console.log("All plugins are up to date.");
      }
      for (const note of notes) {
        console.log(note.includes("→") ? pc.green(note) : pc.yellow(note));
      }
    });
}
