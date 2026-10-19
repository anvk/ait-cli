# lane

**Work on several AI coding sessions at once, each in its own lane.** `lane` is a small, fast command-line tool for
running one to N coding agents in parallel, across one project or many, without them stepping on each other's files or
branches. It works with any agent that has a command line: you decide what runs for each task.

Every task gets its own git worktree on its own branch. `lane 1437` creates `tasks/api/LANE-1437`, clones in the
base's `node_modules` and env files so it is ready to run straight away, and opens your setup for it: an agent in one
Warp tab and a terminal in another, an editor such as `cursor .`, a tmux window, or anything else with a command line.
Run `lane` to jump between tasks, and `lane remove 1437` to clean one up when it is merged.

This repository holds the `lane` command (`cli/`), its plugins (`plugins/`) and its templates (`templates/`).

## Out of the box

The built-in `default` setup is made for [Warp](https://www.warp.dev) and [Claude Code](https://www.anthropic.com/claude-code).
Each task opens as two Warp tabs in the task folder:

- **Claude** runs `claude --continue`, which picks up that task's last Claude Code session. A task with no session
  yet starts a fresh one.
- **Terminal** is a plain shell, for git, tests and anything else.

You only need both installed: when you choose `default`, `lane init` offers to install lane's Warp plugin for you.
Nothing else in lane is tied to either tool. To use a different agent, change the tab's
command in `.lane.json`, for example `"lane warp tab Agent --color yellow --command 'codex'"`. To skip Warp, replace
the tabs with any command lines, such as `cursor .` or `tmux new-window -c {path} -n {task}`.

## Quick start

You need `git`, `node` (22 or later) and `npm`.

1. Install `lane`:

```bash
sh -c "$(curl -fsSL https://raw.githubusercontent.com/anvk/lane/main/tools/install.sh)"
```

2. Make a workspace folder and clone the projects you want to work on into it (one or several):

```bash
mkdir ~/work && cd ~/work
git clone git@github.com:you/app.git app
```

3. Set up the workspace with the default Claude and Terminal tabs:

```bash
lane init default
```

Press Enter through the questions: `lane init` suggests your clone folder, fills in the template, and offers to install
the Warp plugin it needs. With several clones, answer `y` to "Add another base repository?" for each one.

4. Start a task:

```bash
lane 1437
```

That creates `tasks/app/LANE-1437` on its own branch and opens it. Run `lane` to pick between tasks. The sections below
explain each step, how updates work, and every command.

## Install

You need `git`, `node` (22 or later) and `npm`. With `curl`:

```bash
sh -c "$(curl -fsSL https://raw.githubusercontent.com/anvk/lane/main/tools/install.sh)"
```

or with `wget`:

```bash
sh -c "$(wget -qO- https://raw.githubusercontent.com/anvk/lane/main/tools/install.sh)"
```

This clones the repository into `~/.lane-cli`, builds `lane` from `cli/`, and links the command globally. Set `LANE_HOME`
before running it to install somewhere else. The [GitHub CLI](https://cli.github.com) (`gh`) is optional. When it is
logged in, `lane` uses it to search GitHub branches and to read command documents from private repositories.

**Updates are automatic.** Every start checks `main` in the background without waiting on the network. When there is
something newer, the next start updates, rebuilds and re-runs your command (a pause of 10–20 seconds). If a build
fails to start, it is rolled back and that commit is skipped until `main` moves on. Self-update only touches the
managed `~/.lane-cli` install. It stands aside when that checkout has uncommitted changes, is not on `main`, or output
is not a terminal.

| | |
| --- | --- |
| `lane update` | Update now |
| `lane update --check` | Report whether an update is waiting (exits non-zero when behind) |
| `LANE_NO_AUTO_UPDATE=1` | Turn self-update off |

`lane --version` prints the commit date and short sha of the install, e.g. `2026-09-30 (a1b2c3d)`.

**Uninstall:** `npm rm -g lane-cli && rm -rf ~/.lane-cli ~/.lane`. Task folders are plain git worktrees and keep working.
If you like, remove them first with `lane remove`/`lane purge`. If you used Warp tabs, you can also delete
`~/.warp/tab_configs/lane-*.toml` and `~/.warp/launch_configurations/lane-*.yaml`.

## Set up a workspace

A workspace is a folder holding your base clones (for example `api-base/` and `web-base/`). Clone them first, then:

```bash
cd /path/to/workspace
lane init
```

`lane init <template>` (for example `lane init default`, or a path or URL) suggests that template for every base, so
you only press Enter. Without one, `lane init` still suggests `default` for a new base.

`lane init` asks for the task prefix (`LANE-`), the branch prefix (`alex/`), the "old task" threshold, then each base
in turn: its folder, a short name, the ref to branch from (`origin/main`), its tasks directory (`tasks/<name>`), and
the [commands run for its tasks](#what-runs-with-a-task). The commands come from one of three places:

1. **Copy an earlier base's commands**, offered once a previous base has some.
2. **Load a [command document](#command-documents)**: the built-in `default` (the answer Enter gives), a path or a
   URL. It is validated and shown before you accept it, and saved as `template` for `lane commands update`.
3. **Type them in** (answer `none` to the load question). Each `open` entry is either a Warp tab, asked as title,
   folder, color and command, or any command line such as `cursor .`. Then the `create` and `remove` lists, which
   are usually empty.

Enter accepts the default shown in parentheses. `esc` goes back a question (press again to go further). Nothing is
written until you accept the summary. Re-running `lane init` starts from the saved answers.

Every base must be a git clone: tasks are worktrees of it. `lane init` warns about a folder that is not, and other
commands refuse to run until it is.

## Daily use

Run `lane <id>` anywhere inside the workspace to go straight to a task (creating it if needed), or `lane` on its own
to open the picker over your tasks:

| Key | In the search field | In the list |
| --- | --- | --- |
| type | filter by task name or last commit subject | jump back to search and filter |
| `↓` / `↑` | move into the list | move; `↑` from the top returns to search |
| `tab` / `→` / `←` | cycle the base filter (several bases) | same |
| `⏎` | highlight the top match, or create when nothing matches | open the task, or the create/checkout row |
| `n` | | create a task, prefilled with the filter |
| `b` | | check out a branch, prefilled with the filter |
| `d` | | remove the task (type `delete` to confirm) |
| `esc` / `ctrl+c` | quit | quit |

The first two rows are always `+ Create new task` and `⇣ Check out a branch`; tasks follow, split into `recent` and
`old`. With several bases each task is tagged `[base]`, and the create prompt and branch search show which base
they act on (`tab`/`←→` switch it).

The branch search asks origin only when you press `⏎`, and shows the best 10 matches: whole-name matches, then a
name part (split at `/ - _ .`) starting with the text, then anywhere, most recently committed first within each.
On github.com with `gh` logged in it searches GitHub, which knows every branch's last commit; otherwise it uses
`git ls-remote`, which has dates only for branches you have fetched. Rows note where a branch is already checked out.

Outside a terminal (`lane | cat`), `lane` prints the same report as `lane list`.

## Commands

| Command | What it does |
| --- | --- |
| `lane init [template]` | Set up or change the workspace's `.lane.json`, suggesting `template` for each base. |
| `lane <id>` / `lane task <id>` | Open the task, or create it and open it. The usual way in. |
| `lane create <id>` | Create only. `--no-open` skips the open commands. Fails if the task exists. |
| `lane checkout <branch>` | Make a task of an existing branch (see below); opens the task that already has it. |
| `lane open <id>` | Run the open commands for an existing task. |
| `lane` / `lane tasks` | The picker. |
| `lane list` | Print tasks, recent and old. |
| `lane remove <id>` | Remove one task after you type `delete`. |
| `lane purge [--days N]` | Remove every task untouched for N days (default `oldTaskDays`) after you type `PURGE <count>`. |
| `lane prune` | Clean up after task folders deleted by hand (see below). |
| `lane commands update [--base X]` | Re-fetch each base's command lists from its `template`. |
| `lane plugin install\|list\|update\|uninstall` | Manage [plugins](#plugins), the `lane <plugin> …` commands lists can use. |
| `lane doctor` / `lane status` | Check the install, config, bases, plugins, the commands and their programs, and leftovers. |
| `lane update [--check]` | Update lane now. |

`<id>` is a raw id (`1437`) or a full task name (`LANE-1437`). The `lane <id>` shortcut takes only words that start
with a digit or look like `PREFIX-<digit>…`, so a mistyped command such as `lane lst` fails instead of creating a task.
For a task with any other name, use `lane task <name>`.

Flags shared by the commands that open tasks:

- `--base <name>`: which base. Required to create or check out in a workspace with several bases; for an existing
  task, only needed when the name exists in more than one.
- `--close-current-tab`: close the terminal tab you ran the command from once the task is open (its shell is
  signalled to exit). Works in Warp.
- `--force`: create even when the base is not clean.

### Creating a task

`lane task`/`lane create` fetch origin, check the base is clean, rebase the base onto its `ref`, add a worktree on a new
branch `<branchPrefix><taskName>` (e.g. `alex/LANE-1437`), and copy over what git ignores. If the base has `create`
commands, or a Warp tab with `--setup`, lane asks once whether to run them, then runs the `open` list.

**Clean base check.** A task branches from `ref`, so work that lives only in the base would not be on it. Creation
stops when the base has uncommitted changes to tracked files or commits not on `ref`, and lists them. Untracked
files do not block (they are not copied and stay in the base), and being behind `ref` is fine (the rebase fixes
that). `--force` skips the check and also copies the base's modified tracked files over the worktree's.

### Checking out a branch

`lane checkout someone/LANE-558-fix-login` (an `origin/` prefix is dropped) fetches that one branch and checks it out as a
local branch tracking origin, so `git push` goes back to it. An existing local branch is used as is, with a warning
when it is behind. The base is not rebased.

Task names: a branch with your `branchPrefix` maps back to its task (`alex/LANE-1437` → `LANE-1437`); any other is named
after its last `/` part with the task prefix added or respelled (`someone/LANE-558-x` → `LANE-558-x`, `feat/login` →
`LANE-login`, `someone/lane-701` → `LANE-701`). If that name is taken by another branch's task, the whole branch name is
used (`LANE-someone-LANE-558-x`). A branch already checked out in the base or a non-task worktree is refused, since git
keeps a branch in one worktree.

### Removing tasks

`remove` and `purge` run the base's `remove` commands first (a failure only warns), then force-remove the worktree,
discarding uncommitted changes, then delete its branch with `git branch -d`, which keeps a branch with unmerged or
unpushed commits, and finally delete whatever lane's own commands wrote for the task (Warp tab configs). Task age is
the newest file change in the folder (ignoring `.git` and `node_modules`), not the last commit.

`lane prune` handles folders deleted by hand: it removes the files left for them (Warp tab configs) and the stale
worktree records in each base. Warp keeps every workspace's configs in one folder and `prune` only knows this
workspace's tasks, so running it while another workspace has tasks removes that workspace's configs too (they are
rewritten on next open).

## What runs with a task

Each base has up to three lists of shell command lines:

| List | Runs |
| --- | --- |
| `open` | every time the task opens: `lane task`, `lane create`, `lane checkout`, `lane open` and the picker |
| `create` | once, right after the task is created, when you answer yes to the setup prompt (before `open`) |
| `remove` | before `lane remove`/`lane purge` deletes the task, while its folder still exists |

Commands run with `sh -c` in the task folder, in order, with your terminal attached; one that fails is reported and
the rest still run. They are told about the task through the environment and through placeholders:

| Variable | Placeholder | Value |
| --- | --- | --- |
| `LANE_TASK` | `{task}` | task name, e.g. `LANE-1437` |
| `LANE_TASK_PATH` | `{path}` | the task folder (also the working directory) |
| `LANE_BRANCH` | `{branch}` | the branch checked out there |
| `LANE_BASE` | `{base}` | the base's name |
| `LANE_ROOT` | `{root}` | the workspace folder |
| `LANE_TASK_KEY`, `LANE_TASK_LABEL` | | the task's unique key and display label (`api-LANE-1437`, `LANE-1437 (api)`) |
| `LANE_CREATED` | | `1` while the task is being opened right after its creation |

Placeholders are substituted shell-quoted, so `{path}` is safe in any folder name. A line that starts with `lane` runs
this same `lane`, which is how [plugins](#plugins) such as Warp tabs work:

```json
"open": [
  "lane warp tab Server --path server --color red --setup 'npm run dev'",
  "lane warp tab Claude --color yellow --command 'claude --continue'",
  "cursor ."
],
"remove": ["cd server && npm run stop"]
```

Other setups are just other commands. Cursor only: `"open": ["cursor ."]`. tmux:
`"open": ["tmux new-window -c {path} -n {task}"]`. A dependency install once per task:
`"create": ["npm install"]`.

### Plugins

A plugin is a command lane gains, `lane <name> …`, for a tool that cannot be driven by a plain command line because it
works through files or URIs: something has to write the file and remove it when the task goes. Warp is one. Plugins
are installed per person from a git URL (optionally `#folder` inside the repository) or a local folder, and lane
updates them whenever it updates itself:

```bash
lane plugin install https://github.com/anvk/lane.git#plugins/warp
lane plugin list
lane plugin update        # also done by lane's own update
lane plugin uninstall warp
```

A workspace says where its plugins come from, so a teammate who opens it without one is offered the install (outside
a terminal, lane fails with the command to run):

```json
"plugins": { "warp": "https://github.com/anvk/lane.git#plugins/warp" }
```

The plugins that ship with lane live in [`plugins/`](plugins), along with a [guide to writing one](plugins/README.md).
The Warp plugin's `lane warp tab` flags are in [its README](plugins/warp/README.md).

### Command documents

A command document is a JSON object with any of `open`, `create` and `remove`, so you can keep one per project
and load it in every workspace. `default` is built in: a `Claude` tab running `claude --continue` and a plain
`Terminal` tab, both Warp tabs in the task folder. [`templates/`](templates) has its source. Another workspace's
`.lane.json` works as a source too, since it has the same keys. A source is a built-in name, a local path (relative
to the workspace, `~` allowed) or an `http(s)` URL. When `gh` is logged in, GitHub URLs are fetched through it, so
private repositories work. `lane commands update` prints `updated`, `unchanged`, `skipped` or `failed` per base and
only rewrites `.lane.json` when something changed. Lists the document does not mention are left as they are.

## Configuration

`.lane.json` sits in the workspace root:

```json
{
  "taskPrefix": "LANE-",
  "branchPrefix": "alex/",
  "oldTaskDays": 14,
  "bases": [
    {
      "name": "api", "folder": "api-base", "ref": "origin/main", "tasksDir": "tasks/api",
      "template": "default",
      "open": [
        "lane warp tab Claude --color yellow --command 'claude --continue'",
        "lane warp tab Terminal"
      ],
      "create": ["npm install"]
    },
    {
      "name": "web", "folder": "web-base", "ref": "origin/main", "tasksDir": "tasks/web",
      "open": ["cursor ."]
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `taskPrefix` | Prepended to ids: `1437` → `LANE-1437`. |
| `branchPrefix` | Prepended to new branch names: `alex/LANE-1437`. Optional. |
| `oldTaskDays` | Splits recent from old tasks; the default for `purge`. Default `14`. |
| `bases[].name` | Short label for listings and file names. Letters, digits, `.`, `_`, `-`. |
| `bases[].folder` | The base clone, relative to the workspace. |
| `bases[].ref` | Ref new task branches start from. |
| `bases[].tasksDir` | Where this base's tasks go. Each base needs its own, not nested in another's. |
| `bases[].branchPrefix` | Overrides the top-level branch prefix. Optional. |
| `bases[].open`, `create`, `remove` | This base's command lists. `open` is required here or at the top level; the others default to empty. |
| `bases[].template` | Built-in name, path or URL the lists came from, for `lane commands update`. Optional. |
| `open`, `create`, `remove` | Shared lists for bases without their own. Optional. |
| `plugins` | Where to install each plugin the lists use: `{ "warp": "<git URL or path>" }`. Optional. |

A task belongs to the base whose `tasksDir` holds it, so the same task name can exist in two bases.

`"plugins": { "warp": "https://github.com/anvk/lane.git#plugins/warp" }` goes at the top level when a list uses
`lane warp tab`. The `default` template adds it for you.

**Coming from `ait`:** this tool used to be called `ait`. Its single-base `.ait.json` is not read. Run `lane init`
once in the workspace, then remove the old install with `npm rm -g ait-cli && rm -rf ~/.ait-cli`.

### How a task folder is built

`git worktree add` writes the tracked files; lane then copies what git ignores (`node_modules`, build output, `.env`).
Untracked files that are not ignored stay in the base, and lane says how many. On APFS the copy is a copy-on-write
clone, which is near-instant and takes no extra space until a file changes.
Without the `clonedir` helper (built at install when a compiler exists) or across volumes, lane falls back to `cp`,
then to Node. `LANE_COPY=clone|cp|node` picks where to start; lane still falls back if that fails.

## Running from another directory

lane finds `.lane.json` in the current directory or a parent. Elsewhere, it uses `LANE_REPO`:

```bash
echo 'export LANE_REPO=/path/to/workspace' >> ~/.zshrc && export LANE_REPO=/path/to/workspace
```

`lane init` and `lane doctor` print this line with your path. `LANE_REPO` never overrides the workspace you are in;
`lane --repo <path> <command>` targets one explicitly.

## Development

The repository is laid out like this:

| Folder | What it is |
| --- | --- |
| `cli/` | The `lane` command (package `lane-cli`) |
| `plugins/api/` | `lane-plugin-api`, the interface plugins implement |
| `plugins/warp/` | The Warp plugin (`lane warp tab`) |
| `templates/` | Command documents; `default.json` is also built into `lane` |
| `tools/install.sh` | The installer |

```bash
git clone https://github.com/anvk/lane.git && cd lane/cli
npm install
npm test
npm run build && npm link       # point the global `lane` at this checkout
cd ~/.lane-cli/cli && npm link   # point it back at the managed install
```

Self-update stays off in a linked development checkout. `readlink -f "$(command -v lane)"` shows which one is active.

lane knows no plugin by name. `cli/src/plugins/` loads what `lane plugin install` put under `~/.lane/plugins/`, registers
`lane <plugin>` for each, and asks every plugin the same three things: validate its lines when a config is read, check
itself in `lane doctor` when a base uses it, and forget a task's files when the task is removed or pruned. Writing one
is described in [`plugins/README.md`](plugins/README.md). Anything that is an ordinary program needs none of that and
is just a line in a list.
