# lane-plugin-warp

Opens a task's folders as [Warp](https://www.warp.dev) tabs. Install it once, then use
`lane warp tab …` lines in a base's `open` list:

```bash
lane plugin install https://github.com/anvk/lane-cli.git#plugins/warp
```

```json
"open": [
  "lane warp tab Server --path server --color red --setup 'npm run dev'",
  "lane warp tab Web --path web --color blue",
  "lane warp tab Claude --color yellow --command 'claude --continue'"
]
```

## `lane warp tab`

```
lane warp tab <title> [--path <dir>] [--color <c>] [--command <cmd>] [--setup <cmd>] [--group] [--new-window]
```

| Flag | Meaning |
| --- | --- |
| `<title>` | Pane name; the task is appended: `Server - LANE-1437`, or `Server - LANE-1437 (api)` with several bases. A command that sets its own title (like `claude`) overrides it. |
| `--path <dir>` | Folder relative to the task (default `.`). A missing folder falls back to the task root with a warning. |
| `--color <c>` | `red`, `green`, `yellow`, `blue`, `magenta` or `cyan`. |
| `--command <cmd>` | Run when the tab opens. |
| `--setup <cmd>` | Run in this tab, after `--command`, only right after the task is created and if you agreed to the setup prompt. |
| `--group` | Open the task's tabs as one Warp tab group named after the task (always a new window). Any tab with it makes the whole set a group. |
| `--new-window` | Open the task's tabs in a new Warp window instead of the active one. |

When lane runs a task's `open` list, the Warp tabs in it are collected and opened together at
the end, so they land in one window in the configured order. Run from your own shell,
`lane warp tab Logs --command 'tail -f app.log'` opens a single tab for the current folder
right away.

Claude Code keeps sessions per folder, so `--command 'claude --continue'` resumes that task's
last session. In a task with no session yet, the flag is dropped so Claude starts fresh
instead of exiting.

## Files and cleanup

Tab configs are written to `~/.warp/tab_configs/lane-<task>-*.toml` (`lane-<base>-<task>-*`
with several bases) and deleted when the task is removed or pruned. Groups go through a
launch configuration (`~/.warp/launch_configurations/lane-<task>.yaml`), the only Warp format
that can declare them; this needs a Warp release from mid-September 2026 or later, and older
ones open the tabs ungrouped in a new window. Opening the same task again adds another set
of tabs; Warp cannot reuse open tabs.

`lane warp doctor` checks that Warp is installed and the folders are writable; `lane doctor`
runs it for you when some base uses Warp tabs.

## Development

```bash
cd plugins/warp
npm install
npm test
npm run build
lane plugin install .      # link this folder as the installed plugin
```
