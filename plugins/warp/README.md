# lanes-plugin-warp

Opens a lane's folders as [Warp](https://www.warp.dev) tabs. Install it once, then use
`lanes warp tab …` lines in a base's `open` list:

```bash
lanes plugin install https://github.com/anvk/lanes.git#plugins/warp
```

```json
"open": [
  "lanes warp tab Server --path server --color red --setup 'npm run dev'",
  "lanes warp tab Web --path web --color blue",
  "lanes warp tab Claude --color yellow --command 'claude --continue || claude'"
]
```

## `lanes warp tab`

```
lanes warp tab <title> [--path <dir>] [--color <c>] [--command <cmd>] [--setup <cmd>] [--group] [--new-window]
```

| Flag | Meaning |
| --- | --- |
| `<title>` | Pane name; the lane is appended: `Server - ABC-1437`, or `Server - ABC-1437 (api)` with several bases. A command that sets its own title (like `claude`) overrides it. |
| `--path <dir>` | Folder relative to the lane (default `.`). A missing folder falls back to the lane root with a warning. |
| `--color <c>` | `red`, `green`, `yellow`, `blue`, `magenta` or `cyan`. |
| `--command <cmd>` | Run when the tab opens. |
| `--setup <cmd>` | Run in this tab, after `--command`, only right after the lane is created and if you agreed to the setup prompt. |
| `--group` | Open the lane's tabs as one Warp tab group named after the lane (always a new window). Any tab with it makes the whole set a group. |
| `--new-window` | Open the lane's tabs in a new Warp window instead of the active one. |

When `lanes` runs a lane's `open` list, the Warp tabs in it are collected and opened together at
the end, so they land in one window in the configured order. Run from your own shell,
`lanes warp tab Logs --command 'tail -f app.log'` opens a single tab for the current folder
right away.

Commands run as you write them; the plugin knows nothing about any particular agent. To
resume an agent's last session where there may not be one yet, say so in the command:
`--command 'claude --continue || claude'` resumes the lane's last Claude Code session, and
starts a fresh one when `--continue` finds none.

## Files and cleanup

Tab configs are written to `~/.warp/tab_configs/lanes~<base>-<lane>~<n>-<title>.toml` and deleted
when the lane is removed or pruned. The `~` separates the lane's key from the rest, so one lane's
files are never mistaken for another's (`lanes prune` also clears `lanes-*` files from earlier
versions). Groups go through a launch configuration
(`~/.warp/launch_configurations/lanes~<base>-<lane>.yaml`), the only Warp format
that can declare them; this needs a Warp release from mid-September 2026 or later, and older
ones open the tabs ungrouped in a new window. Opening the same lane again adds another set
of tabs; Warp cannot reuse open tabs.

`lanes warp doctor` checks that Warp is installed and the folders are writable; `lanes doctor`
runs it for you when some base uses Warp tabs.

## Development

```bash
cd plugins/warp
npm install
npm test
npm run build
lanes plugin install .      # link this folder as the installed plugin
```
