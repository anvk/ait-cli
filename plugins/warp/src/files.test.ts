import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLaunchConfigYaml, buildTabConfigToml, findOrphanedTabConfigs, removeTabConfigs, tabConfigName } from "./files.js";

const paneName = (title: string) => `export WARP_DISABLE_AUTO_TITLE=true; printf '\\033]0;%s\\007' "${title}"`;
const tabs = [
  { configName: "lanes~ABC-1~0-api", cwd: "/w/lanes/ABC-1/server", color: "red", commands: [paneName("API - ABC-1"), "make run"] },
  { configName: "lanes~ABC-1~1-cli", cwd: "/w/lanes/ABC-1", commands: [paneName("CLI - ABC-1")] }
];

test("a tab config names the pane and runs its command", () => {
  assert.equal(
    buildTabConfigToml(tabs[0]),
    [
      'name = "lanes~ABC-1~0-api"',
      'color = "red"',
      "",
      "[[panes]]",
      'id = "main"',
      'type = "terminal"',
      'directory = "/w/lanes/ABC-1/server"',
      "commands = ['''export WARP_DISABLE_AUTO_TITLE=true; printf '\\033]0;%s\\007' \"API - ABC-1\"''', '''make run''']",
      ""
    ].join("\n")
  );
});

test("a launch config puts every tab in one colored group", () => {
  assert.equal(
    buildLaunchConfigYaml("lanes~ABC-1", "ABC-1", tabs),
    [
      "---",
      'name: "lanes~ABC-1"',
      "windows:",
      "  - tabs:",
      "      - color: red",
      "        group: 0",
      "        layout:",
      '          cwd: "/w/lanes/ABC-1/server"',
      "          commands:",
      "            - exec: \"export WARP_DISABLE_AUTO_TITLE=true; printf '\\\\033]0;%s\\\\007' \\\"API - ABC-1\\\"\"",
      '            - exec: "make run"',
      "      - group: 0",
      "        layout:",
      '          cwd: "/w/lanes/ABC-1"',
      "          commands:",
      "            - exec: \"export WARP_DISABLE_AUTO_TITLE=true; printf '\\\\033]0;%s\\\\007' \\\"CLI - ABC-1\\\"\"",
      "    tab_groups:",
      '      - name: "ABC-1"',
      "        color: red",
      "        collapsed: false",
      "        pinned: false",
      ""
    ].join("\n")
  );
});

test("one lane's files never match another's, and leftovers are found by exact key", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lanes-warp-files-"));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const dir = path.join(home, ".warp", "tab_configs");
    fs.mkdirSync(dir, { recursive: true });
    for (const name of [tabConfigName("app-1", 0, "Claude"), tabConfigName("app-1-fix", 0, "Claude"), tabConfigName("app-7", 1, "Step-2-Debug"), "lanes-app-3-0-old.toml"]) {
      fs.writeFileSync(path.join(dir, `${name}.toml`.replace(/\.toml\.toml$/, ".toml")), "");
    }
    assert.deepEqual(findOrphanedTabConfigs(["app-1", "app-1-fix", "app-7"]).map((o) => o.key), ["(earlier naming)"]);
    removeTabConfigs("app-1");
    assert.deepEqual(fs.readdirSync(dir).sort(), ["lanes-app-3-0-old.toml", "lanes~app-1-fix~0-claude.toml", "lanes~app-7~1-step-2-debug.toml"]);
  } finally {
    process.env.HOME = previousHome;
  }
});
