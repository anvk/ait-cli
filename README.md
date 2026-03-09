# AIT CLI

`ait` is a local command-line tool for managing task worktrees from a base git repository.

It is designed for workflows where you keep one configurable "base" repo (for example `myproject`) and quickly spin up task folders like `tasks/AIT-1437`.

## What it does

- Initializes per-directory config with `.ait.json`
- Creates task worktrees from a configured base git ref (default `origin/main`)
- Opens existing task folders in Cursor
- Supports smart open-or-create with a single command
- Lists, removes, and purges old task folders safely (with typed confirmation)
- Runs diagnostics via `doctor`

## Quick start

### 1) Install dependencies

```bash
cd ~/ait-cli
npm install
```

### 2) Build and install globally

```bash
npm run build
npm link
```

Now the `ait` command is available globally.

### 3) Initialize config in your workspace directory

```bash
cd /path/to/your/workspace
ait init
```

`ait init` asks questions and writes `.ait.json` in the current directory.

## Configuration

`ait` reads `.ait.json` from the current directory (or parent directories).

Example:

```json
{
  "prefix": "AIT",
  "tasksDir": "tasks",
  "baseRef": "origin/main",
  "baseFolder": "myproject"
}
```

Field meanings:

- `prefix`: task folder prefix (`AIT` -> `AIT-1437`)
- `tasksDir`: where task folders are created relative to config directory
- `baseRef`: git ref used for creating new task branches/worktrees
- `baseFolder`: folder (relative to config dir) that points to the base git repository

## Common command usage

### Smart task command (recommended)

```bash
ait task 1437
```

- If `tasks/AIT-1437` exists, it opens it.
- If it does not exist, it creates it from `baseRef` and opens it.

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

### Remove one task (with typed confirmation)

```bash
ait remove 1437
```

You must type the exact task name (for example `AIT-1437`) to confirm.

### Purge old tasks (default: 14 days)

```bash
ait purge-old
ait purge-old --days 21
```

You must type a confirmation token (`PURGE <count>`) before deletion.

### Diagnostics

```bash
ait doctor
```

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
- `remove` and `purge-old` are intentionally guarded by typed confirmations.
