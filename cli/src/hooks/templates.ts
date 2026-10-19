import { WARP_PLUGIN_SOURCE, type CommandDocument } from "../core/config.js";

// Command documents that ship with lane, loaded by name instead of a path or URL. Each one
// is also published under templates/ at the root of the repository; a test keeps the two
// copies the same.
export const BUILTIN_TEMPLATES: Readonly<Record<string, CommandDocument>> = {
  // A Claude tab and a plain terminal, both in the task folder.
  default: {
    plugins: { warp: WARP_PLUGIN_SOURCE },
    open: ["lane warp tab Claude --color yellow --command 'claude --continue'", "lane warp tab Terminal"]
  }
};

export const DEFAULT_TEMPLATE = "default";

export function builtinTemplate(name: string): CommandDocument | undefined {
  return Object.hasOwn(BUILTIN_TEMPLATES, name) ? BUILTIN_TEMPLATES[name] : undefined;
}
