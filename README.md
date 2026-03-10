# AIT CLI

`ait` is a local command-line tool for managing task worktrees from a base git repository.

It is designed for workflows where you keep one configurable "base" repo (for example `myproject`) and quickly spin up task folders like `tasks/AIT-1437`.

## What it does

- Initializes per-directory config with `.ait.json`
- Creates task worktrees from a configured base git ref (default `origin/main`)
- Mirrors local `baseFolder` contents into new task folders (including dotfiles, excluding `.git`)
- Opens existing task folders in Cursor
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
  "oldTaskDays": 14
}
```

Field meanings:

- `taskPrefix`: literal task prefix (`AIT-` + `1437` -> `AIT-1437`)
- `branchPrefix`: optional branch prefix (`alex/` + `AIT-1437` -> `alex/AIT-1437`)
- `tasksDir`: where task folders are created relative to config directory
- `baseRef`: git ref used for creating new task branches/worktrees
- `baseFolder`: folder (relative to config dir) that points to the base git repository
- `oldTaskDays`: threshold used by `ait tasks`/`ait list` to split recent vs old tasks, and default threshold for `ait purge`

## Common command usage

### Smart task command (recommended)

```bash
ait task 1437
```

- If `tasks/AIT-1437` exists, it opens it.
- If it does not exist, it creates it from `baseRef` and opens it.
- New branches are named `${branchPrefix}${taskName}` (for example `alex/AIT-1437`).

### Create only

```bash
ait create 1437
ait create 1437 --no-open
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
You must type the exact task name (for example `AIT-1437`) to confirm.
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
Checks config validity, base folder/repo, base ref, and Cursor CLI availability.

### Version/help

```bash
ait version
ait --version
ait help
```

## Running from another directory

You can target a specific config/workspace directory with:

```bash
ait --repo /path/to/workspace <command>
```

Example:

```bash
ait --repo /path/to/workspace doctor
```

## Notes

- `ait` expects `cursor` CLI to be installed and available in `PATH`.
- `create` fails if a target task folder already exists (use `open` or `task`).
- `remove` and `purge` are intentionally guarded by typed confirmations.
