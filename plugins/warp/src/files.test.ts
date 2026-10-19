import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLaunchConfigYaml, buildTabConfigToml } from "./files.js";

const paneName = (title: string) => `export WARP_DISABLE_AUTO_TITLE=true; printf '\\033]0;%s\\007' "${title}"`;
const tabs = [
  { configName: "lanes-ABC-1-0-api", cwd: "/w/lanes/ABC-1/server", color: "red", commands: [paneName("API - ABC-1"), "make run"] },
  { configName: "lanes-ABC-1-1-cli", cwd: "/w/lanes/ABC-1", commands: [paneName("CLI - ABC-1")] }
];

test("a tab config names the pane and runs its command", () => {
  assert.equal(
    buildTabConfigToml(tabs[0]),
    [
      'name = "lanes-ABC-1-0-api"',
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
    buildLaunchConfigYaml("lanes-ABC-1", "ABC-1", tabs),
    [
      "---",
      'name: "lanes-ABC-1"',
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
