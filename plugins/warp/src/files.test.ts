import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLaunchConfigYaml, buildTabConfigToml } from "./files.js";

const paneName = (title: string) => `export WARP_DISABLE_AUTO_TITLE=true; printf '\\033]0;%s\\007' "${title}"`;
const tabs = [
  { configName: "lane-LANE-1-0-api", cwd: "/w/tasks/LANE-1/server", color: "red", commands: [paneName("API - LANE-1"), "make run"] },
  { configName: "lane-LANE-1-1-cli", cwd: "/w/tasks/LANE-1", commands: [paneName("CLI - LANE-1")] }
];

test("a tab config names the pane and runs its command", () => {
  assert.equal(
    buildTabConfigToml(tabs[0]),
    [
      'name = "lane-LANE-1-0-api"',
      'color = "red"',
      "",
      "[[panes]]",
      'id = "main"',
      'type = "terminal"',
      'directory = "/w/tasks/LANE-1/server"',
      "commands = ['''export WARP_DISABLE_AUTO_TITLE=true; printf '\\033]0;%s\\007' \"API - LANE-1\"''', '''make run''']",
      ""
    ].join("\n")
  );
});

test("a launch config puts every tab in one colored group", () => {
  assert.equal(
    buildLaunchConfigYaml("lane-LANE-1", "LANE-1", tabs),
    [
      "---",
      'name: "lane-LANE-1"',
      "windows:",
      "  - tabs:",
      "      - color: red",
      "        group: 0",
      "        layout:",
      '          cwd: "/w/tasks/LANE-1/server"',
      "          commands:",
      "            - exec: \"export WARP_DISABLE_AUTO_TITLE=true; printf '\\\\033]0;%s\\\\007' \\\"API - LANE-1\\\"\"",
      '            - exec: "make run"',
      "      - group: 0",
      "        layout:",
      '          cwd: "/w/tasks/LANE-1"',
      "          commands:",
      "            - exec: \"export WARP_DISABLE_AUTO_TITLE=true; printf '\\\\033]0;%s\\\\007' \\\"CLI - LANE-1\\\"\"",
      "    tab_groups:",
      '      - name: "LANE-1"',
      "        color: red",
      "        collapsed: false",
      "        pinned: false",
      ""
    ].join("\n")
  );
});
