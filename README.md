# AIT CLI

`ait` is a local command-line tool for managing task worktrees from a base git repository.

It is designed for workflows where you keep one configurable "base" repo (for example `myproject`) and quickly spin up task folders like `tasks/AIT-1437`.

## What it does

- Initializes per-directory config with `.ait.json`
- Creates task worktrees from a configured base git ref (default `origin/main`)
- Mirrors local `baseFolder` contents into new task folders (including dotfiles, excluding `.git`)
- Opens task folders as a color-coded, multi-tab Warp workspace
- Supports smart open-or-create with a single command
- Lists, removes, and purges old task folders safely (with typed confirmation)
- Runs diagnostics via `doctor`

## Quick start

### Step 1: Install AIT

#### One-line install (recommended)

Using `curl`:

```bash
sh -c "$(curl -fsSL https://raw.githubusercontent.com/anvk/ait-cli/main/tools/install.sh)"
```

Using `wget`:

```bash
sh -c "$(wget -qO- https://raw.githubusercontent.com/anvk/ait-cli/main/tools/install.sh)"
```

This installs the project to `~/.ait-cli`, runs build, and links the `ait` command globally.

#### Manual setup (alternative)

1. Install dependencies

```bash
cd ~/ait-cli
npm install
```

2. Build and install globally

```bash
npm run build
npm link
```

Now the `ait` command is available globally.

### Step 2: Initialize a workspace (required per root folder)

Your workspace should contain (or point to) your main/base project folder - the repository `ait` will use as the source when creating each task worktree.
In other words, this is the parent/root folder where `ait` will manage `.ait.json`, your `tasks` directory, and your configured `baseFolder`.

```bash
cd /path/to/your/workspace
ait init
```

`ait init` asks questions and writes `.ait.json` in the current directory.
This step is required for each workspace root where you want to use `ait`.

## Configuration

`ait` reads `.ait.json` from the current directory (or parent directories).

Example:

```json
{
  "taskPrefix": "AIT-",
  "branchPrefix": "alex/",
  "tasksDir": "tasks",
  "baseRef": "origin/main",
  "baseFolder": "myproject",
  "oldTaskDays": 14,
  "warpTabs": [
    { "title": "API", "path": "go", "color": "red" },
    { "title": "UI", "path": "ui", "color": "blue" },
    { "title": "CLI", "path": "." },
    { "title": "Claude", "path": ".", "color": "yellow", "command": "claude" }
  ]
}
```

Field meanings:

- `taskPrefix`: literal task prefix (`AIT-` + `1437` -> `AIT-1437`)
- `branchPrefix`: optional branch prefix (`alex/` + `AIT-1437` -> `alex/AIT-1437`)
- `tasksDir`: where task folders are created relative to config directory
- `baseRef`: git ref used for creating new task branches/worktrees
- `baseFolder`: folder (relative to config dir) that points to the base git repository
- `oldTaskDays`: threshold used by `ait tasks`/`ait list` to split recent vs old tasks, and default threshold for `ait purge`
- `warpTabs`: the Warp tabs opened for a task (see below)

## Warp workspace

Opening a task adds one tab per `warpTabs` entry to Warp's active window, starting Warp first if it is not running.
Each pane is named `<title> - <taskName>`, for example `API - AIT-1437`.

Per-tab fields:

- `title`: pane name prefix
- `path`: folder to open, relative to the task folder (`.` is the task root). A missing folder falls back to the task root with a warning.
- `color`: optional tab color. Warp supports only `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`. Omit for no color.
- `command`: optional command run when the tab opens (for example `claude`)

Opening the same task again adds another set of tabs rather than focusing the existing ones, since Warp cannot reuse tabs that are already open.

`ait create`/`ait task` accept two flags:

- `--new-window`: open the tabs in a new Warp window instead of the active one
- `--close-current-tab`: close the tab you ran the command from once the new tabs are open. It signals that tab's shell to exit, so anything still running there stops, and is ignored outside Warp and when combined with `--no-open`.

Tabs are written as configs to `~/.warp/tab_configs/ait-<taskName>-*.toml` and removed by `ait remove`/`ait purge`.
A command that sets its own terminal title (such as `claude`) overrides the pane name.

## Common command usage

### Smart task command (recommended)

```bash
ait task 1437
ait task 1437 --new-window
ait task 1437 --new-window --close-current-tab
```

- If `tasks/AIT-1437` exists, it opens it.
- If it does not exist, it fetches/rebases the base repository onto `baseRef`, creates it from `baseRef`, and opens it.
- New branches are named `${branchPrefix}${taskName}` (for example `alex/AIT-1437`).

Creating a task copies `baseFolder` into the new task folder, which can take a while on large repositories.

### Create only

```bash
ait create 1437
ait create 1437 --no-open
ait create 1437 --new-window
```

### Open existing

```bash
ait open 1437
```

### List tasks

```bash
ait list
ait tasks
```

`oldTaskDays` from config controls which tasks appear in the `old` section (default: `14`) and is used as the default threshold for `ait purge`.

### Remove one task (with typed confirmation)

```bash
ait remove 1437
```

You can pass either the raw id (`1437`) or full task name (`AIT-1437`).
You must type `delete` to confirm.
After confirmation, removal is forced (`git worktree remove --force`), so uncommitted changes in that task worktree are discarded.

### Purge old tasks (default: config `oldTaskDays`, usually 14)

```bash
ait purge
ait purge --days 21
```

You must type a confirmation token (`PURGE <count>`) before deletion.
After confirmation, each worktree removal is forced, so uncommitted changes in purged task worktrees are discarded.

### Diagnostics

```bash
ait doctor
ait status
```

`status` is an alias for `doctor`.
Checks config validity, base folder/repo, base ref, Warp availability, and each configured Warp tab.

### Version/help

```bash
ait version
ait --version
ait help
```

## Running from another directory

`ait` normally finds `.ait.json` by searching the current directory and its parents, so it works anywhere inside a workspace.

To run it from anywhere else, set a default workspace in your shell profile:

```bash
echo 'export AIT_REPO=/path/to/workspace' >> ~/.zshrc
```

`ait init` and `ait doctor` both print this command with your workspace path filled in.

`AIT_REPO` is only used when the current directory is not inside a workspace, so it never overrides the workspace you are standing in.

To target one specific workspace for a single command:

```bash
ait --repo /path/to/workspace doctor
```

`--repo` wins over `AIT_REPO`.

## Notes

- `ait` expects Warp to be installed (macOS), and any tab `command` to be in `PATH`.
- `create` fails if a target task folder already exists (use `open` or `task`).
- `remove` and `purge` are intentionally guarded by typed confirmations.
