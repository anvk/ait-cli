# lanes

**Work on several AI coding sessions at once, each in its own lane.** `lanes` is a small, fast command-line tool for
running one to N coding agents in parallel, across one project or many, without them stepping on each other's files or
branches. It works with any agent that has a command line: you decide what runs for each lane.

Every lane gets its own git worktree on its own branch. `lanes 1437` creates `lanes/api/1437`, clones in the
base's `node_modules` and env files so it is ready to run straight away, and opens your setup for it: an agent in one
Warp tab and a terminal in another, an editor such as `cursor .`, a tmux window, or anything else with a command line.
Run `lanes` to jump between lanes, and `lanes remove 1437` to clean one up when it is merged.

This repository holds the `lanes` command (`cli/`), its plugins (`plugins/`) and its templates (`templates/`).

## Quick start

1. Make sure `git`, `node` (22 or later) and `npm` are installed.

2. Install `lanes`:

```bash
sh -c "$(curl -fsSL https://raw.githubusercontent.com/anvk/lanes/main/tools/install.sh)"
```

3. In a folder holding git clones of your projects, run:

```bash
lanes init
```

Press Enter through the questions to use the built-in setup (see [Out of the box](#out-of-the-box)), or pass your
team's setup by URL: `lanes init https://github.com/your-org/dev-setup/blob/main/lanes.json`. Then run `lanes 1437` to
start a lane, or `lanes` to pick one.

## Out of the box

The built-in `default` setup is made for [Warp](https://www.warp.dev) and [Claude Code](https://www.anthropic.com/claude-code).
Each lane opens as two Warp tabs in the lane folder:

- **Claude** runs `claude --continue`, which picks up that lane's last Claude Code session. A lane with no session
  yet starts a fresh one.
- **Terminal** is a plain shell, for git, tests and anything else.

You only need both installed: when you choose `default`, `lanes init` offers to install its Warp plugin for you.
Nothing else in `lanes` is tied to either tool. To use a different agent, change the tab's
command in `.lanes.json`, for example `"lanes warp tab Agent --color yellow --command 'codex'"`. To skip Warp, replace
the tabs with any command lines, such as `cursor .` or `tmux new-window -c {path} -n {lane}`.

## Install

You need `git`, `node` (22 or later) and `npm`. With `curl`:

```bash
sh -c "$(curl -fsSL https://raw.githubusercontent.com/anvk/lanes/main/tools/install.sh)"
```

or with `wget`:

```bash
sh -c "$(wget -qO- https://raw.githubusercontent.com/anvk/lanes/main/tools/install.sh)"
```

This clones the repository into `~/.lanes-cli`, builds `lanes` from `cli/`, and links the command globally. Set `LANES_HOME`
before running it to install somewhere else. The [GitHub CLI](https://cli.github.com) (`gh`) is optional. When it is
logged in, `lanes` uses it to search GitHub branches and to read command documents from private repositories.

**Updates are automatic.** Every start checks `main` in the background without waiting on the network. When there is
something newer, the next start updates, rebuilds and re-runs your command (a pause of 10–20 seconds). If a build
fails to start, it is rolled back and that commit is skipped until `main` moves on. Self-update only touches the
managed `~/.lanes-cli` install. It stands aside when that checkout has uncommitted changes, is not on `main`, or output
is not a terminal.

| | |
| --- | --- |
| `lanes update` | Update now |
| `lanes update --check` | Report whether an update is waiting (exits non-zero when behind) |
| `LANES_NO_AUTO_UPDATE=1` | Turn self-update off |

`lanes --version` prints the commit date and short sha of the install, e.g. `2026-09-30 (a1b2c3d)`.

**Uninstall:** `npm rm -g lanes-cli && rm -rf ~/.lanes-cli ~/.lanes`. Lane folders are plain git worktrees and keep working.
If you like, remove them first with `lanes remove`/`lanes purge`. If you used Warp tabs, you can also delete
`~/.warp/tab_configs/lanes-*.toml` and `~/.warp/launch_configurations/lanes-*.yaml`.

## Set up a workspace

A workspace is a folder holding your base clones (for example `api-base/` and `web-base/`). Clone them first, then:

```bash
cd /path/to/workspace
lanes init
```

`lanes init <source>` suggests that setup for every base, so you only press Enter. A source is a URL (a GitHub file
link works for public repositories, and for private ones when `gh` is logged in), a file path, or `default`. Without
one, `lanes init` suggests `default` for a new base. This lets a team keep its setup in one place: see
[Command documents](#command-documents).

`lanes init` asks for an optional lane name prefix (`ABC-`), the branch prefix (`alex/`), the "old lane" threshold, then each base
in turn: its folder, a short name, the ref to branch from (`origin/main`), its lanes directory (`lanes/<name>`), and
the [commands run for its lanes](#what-runs-with-a-lane). The commands come from one of three places:

1. **Copy an earlier base's commands**, offered once a previous base has some.
2. **Load a [command document](#command-documents)**: a URL, a path, or the built-in `default` (the answer Enter
   gives). It is validated and shown before you accept it, and saved as `template` for `lanes commands update`.
3. **Type them in** (answer `none` to the load question). Each `open` entry is either a Warp tab, asked as title,
   folder, color and command, or any command line such as `cursor .`. Then the `create` and `remove` lists, which
   are usually empty.

Enter accepts the default shown in parentheses. `esc` goes back a question (press again to go further). Nothing is
written until you accept the summary. Re-running `lanes init` starts from the saved answers.

Every base must be a git clone: lanes are worktrees of it. `lanes init` warns about a folder that is not, and other
commands refuse to run until it is.

## Daily use

Run `lanes <id>` anywhere inside the workspace to go straight to a lane (creating it if needed), or `lanes` on its own
to open the picker over your lanes:

| Key | In the search field | In the list |
| --- | --- | --- |
| type | filter by lane name or last commit subject | jump back to search and filter |
| `↓` / `↑` | move into the list | move; `↑` from the top returns to search |
| `tab` / `→` / `←` | cycle the base filter (several bases) | same |
| `⏎` | highlight the top match, or create when nothing matches | open the lane, or the create/checkout row |
| `n` | | create a lane, prefilled with the filter |
| `b` | | check out a branch, prefilled with the filter |
| `d` | | remove the lane (type `delete` to confirm) |
| `esc` / `ctrl+c` | quit | quit |

The first two rows are always `+ Create new lane` and `⇣ Check out a branch`; lanes follow, split into `recent` and
`old`. With several bases each lane is tagged `[base]`, and the create prompt and branch search show which base
they act on (`tab`/`←→` switch it).

The branch search asks origin only when you press `⏎`, and shows the best 10 matches: whole-name matches, then a
name part (split at `/ - _ .`) starting with the text, then anywhere, most recently committed first within each.
On github.com with `gh` logged in it searches GitHub, which knows every branch's last commit; otherwise it uses
`git ls-remote`, which has dates only for branches you have fetched. Rows note where a branch is already checked out.

Outside a terminal (`lanes | cat`), `lanes` prints the same report as `lanes list`.

## Commands

| Command | What it does |
| --- | --- |
| `lanes init [source]` | Set up or change the workspace's `.lanes.json`, suggesting the setup at `source` (URL, path or `default`) for each base. |
| `lanes <id>` / `lanes open <id>` | Open the lane, or create it and open it. The usual way in. |
| `lanes create <id>` | Create only. `--no-open` skips the open commands. Fails if the lane exists. |
| `lanes checkout <branch>` | Make a lane of an existing branch (see below); opens the lane that already has it. |
| `lanes` / `lanes pick` | The picker. |
| `lanes list` | Print lanes, recent and old. |
| `lanes remove <id>` | Remove one lane after you type `delete`. |
| `lanes purge [--days N]` | Remove every lane untouched for N days (default `oldLaneDays`) after you type `PURGE <count>`. |
| `lanes prune` | Clean up after lane folders deleted by hand (see below). |
| `lanes commands update [--base X]` | Re-fetch each base's command lists from its `template`. |
| `lanes plugin install\|list\|update\|uninstall` | Manage [plugins](#plugins), the `lanes <plugin> …` commands lists can use. |
| `lanes doctor` / `lanes status` | Check the install, config, bases, plugins, the commands and their programs, and leftovers. |
| `lanes update [--check]` | Update `lanes` now. |

`<id>` is a raw id (`1437`) or a full lane name (`ABC-1437`). The `lanes <id>` shortcut takes only words that start
with a digit or look like `PREFIX-<digit>…`, so a mistyped command such as `lanes lst` fails instead of creating a lane.
For a lane with any other name, use `lanes open <name>`.

Flags shared by the commands that open lanes:

- `--base <name>`: which base. Required to create or check out in a workspace with several bases; for an existing
  lane, only needed when the name exists in more than one.
- `--close-current-tab`: close the terminal tab you ran the command from once the lane is open (its shell is
  signalled to exit). Works in Warp.
- `--force`: create even when the base is not clean.

### Creating a lane

`lanes open`/`lanes create` fetch origin, check the base is clean, rebase the base onto its `ref`, add a worktree on a new
branch `<branchPrefix><laneName>` (e.g. `alex/ABC-1437`), and copy over what git ignores. If the base has `create`
commands, or a Warp tab with `--setup`, `lanes` asks once whether to run them, then runs the `open` list.

**Clean base check.** A lane branches from `ref`, so work that lives only in the base would not be on it. Creation
stops when the base has uncommitted changes to tracked files or commits not on `ref`, and lists them. Untracked
files do not block (they are not copied and stay in the base), and being behind `ref` is fine (the rebase fixes
that). `--force` skips the check and also copies the base's modified tracked files over the worktree's.

### Checking out a branch

`lanes checkout someone/ABC-558-fix-login` (an `origin/` prefix is dropped) fetches that one branch and checks it out as a
local branch tracking origin, so `git push` goes back to it. An existing local branch is used as is, with a warning
when it is behind. The base is not rebased.

Lane names (examples use the prefix `ABC-`): a branch with your `branchPrefix` maps back to its lane (`alex/ABC-1437` → `ABC-1437`); any other is named
after its last `/` part with the lane prefix added or respelled (`someone/ABC-558-x` → `ABC-558-x`, `feat/login` →
`ABC-login`, `someone/abc-701` → `ABC-701`). If that name is taken by another branch's lane, the whole branch name is
used (`ABC-someone-ABC-558-x`). A branch already checked out in the base or a non-lane worktree is refused, since git
keeps a branch in one worktree.

### Removing lanes

`remove` and `purge` run the base's `remove` commands first (a failure only warns), then force-remove the worktree,
discarding uncommitted changes, then delete its branch with `git branch -d`, which keeps a branch with unmerged or
unpushed commits, and finally delete whatever `lanes` itself wrote for the lane (Warp tab configs). Lane age is
the newest file change in the folder (ignoring `.git` and `node_modules`), not the last commit.

`lanes prune` handles folders deleted by hand: it removes the files left for them (Warp tab configs) and the stale
worktree records in each base. Warp keeps every workspace's configs in one folder and `prune` only knows this
workspace's lanes, so running it while another workspace has lanes removes that workspace's configs too (they are
rewritten on next open).

## What runs with a lane

Each base has up to three lists of shell command lines:

| List | Runs |
| --- | --- |
| `open` | every time the lane opens: `lanes <id>`, `lanes open`, `lanes create`, `lanes checkout` and the picker |
| `create` | once, right after the lane is created, when you answer yes to the setup prompt (before `open`) |
| `remove` | before `lanes remove`/`lanes purge` deletes the lane, while its folder still exists |

Commands run with `sh -c` in the lane folder, in order, with your terminal attached; one that fails is reported and
the rest still run. They are told about the lane through the environment and through placeholders:

| Variable | Placeholder | Value |
| --- | --- | --- |
| `LANE_NAME` | `{lane}` | lane name, e.g. `ABC-1437` |
| `LANE_PATH` | `{path}` | the lane folder (also the working directory) |
| `LANE_BRANCH` | `{branch}` | the branch checked out there |
| `LANE_BASE` | `{base}` | the base's name |
| `LANE_ROOT` | `{root}` | the workspace folder |
| `LANE_KEY`, `LANE_LABEL` | | the lane's unique key and display label (`api-ABC-1437`, `ABC-1437 (api)`) |
| `LANE_CREATED` | | `1` while the lane is being opened right after its creation |

Placeholders are substituted shell-quoted, so `{path}` is safe in any folder name. A line that starts with `lanes` runs
this same `lanes`, which is how [plugins](#plugins) such as Warp tabs work:

```json
"open": [
  "lanes warp tab Server --path server --color red --setup 'npm run dev'",
  "lanes warp tab Claude --color yellow --command 'claude --continue'",
  "cursor ."
],
"remove": ["cd server && npm run stop"]
```

Other setups are just other commands. Cursor only: `"open": ["cursor ."]`. tmux:
`"open": ["tmux new-window -c {path} -n {lane}"]`. A dependency install once per lane:
`"create": ["npm install"]`.

### Plugins

A plugin is a command `lanes` gains, `lanes <name> …`, for a tool that cannot be driven by a plain command line because it
works through files or URIs: something has to write the file and remove it when the lane goes. Warp is one. Plugins
are installed per person from a git URL (optionally `#folder` inside the repository) or a local folder, and `lanes`
updates them whenever it updates itself:

```bash
lanes plugin install https://github.com/anvk/lanes.git#plugins/warp
lanes plugin list
lanes plugin update        # also done by `lanes update`
lanes plugin uninstall warp
```

A workspace says where its plugins come from, so a teammate who opens it without one is offered the install (outside
a terminal, `lanes` fails with the command to run):

```json
"plugins": { "warp": "https://github.com/anvk/lanes.git#plugins/warp" }
```

The plugins that ship with `lanes` live in [`plugins/`](plugins), along with a [guide to writing one](plugins/README.md).
The Warp plugin's `lanes warp tab` flags are in [its README](plugins/warp/README.md).

### Command documents

A command document is a JSON object with any of `open`, `create` and `remove`, so you can keep one per project
and load it in every workspace. `default` is built in: a `Claude` tab running `claude --continue` and a plain
`Terminal` tab, both Warp tabs in the lane folder. [`templates/`](templates) has its source. Another workspace's
`.lanes.json` works as a source too, since it has the same keys. A source is a built-in name, a local path (relative
to the workspace, `~` allowed) or an `http(s)` URL. A GitHub file link (`github.com/<org>/<repo>/blob/<branch>/<file>`) works as is for a public
repository; for a private one, `lanes` reads it through `gh` when that is logged in. `lanes commands update` prints `updated`, `unchanged`, `skipped` or `failed` per base and
only rewrites `.lanes.json` when something changed. Lists the document does not mention are left as they are.

## Configuration

`.lanes.json` sits in the workspace root:

```json
{
  "lanePrefix": "ABC-",
  "branchPrefix": "alex/",
  "oldLaneDays": 14,
  "bases": [
    {
      "name": "api", "folder": "api-base", "ref": "origin/main", "lanesDir": "lanes/api",
      "template": "default",
      "open": [
        "lanes warp tab Claude --color yellow --command 'claude --continue'",
        "lanes warp tab Terminal"
      ],
      "create": ["npm install"]
    },
    {
      "name": "web", "folder": "web-base", "ref": "origin/main", "lanesDir": "lanes/web",
      "open": ["cursor ."]
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `lanePrefix` | Prepended to ids: `1437` → `ABC-1437`. Optional; without it a lane is named by its id. |
| `branchPrefix` | Prepended to new branch names: `alex/ABC-1437`. Optional. |
| `oldLaneDays` | Splits recent from old lanes; the default for `purge`. Default `14`. |
| `bases[].name` | Short label for listings and file names. Letters, digits, `.`, `_`, `-`. |
| `bases[].folder` | The base clone, relative to the workspace. |
| `bases[].ref` | Ref new lane branches start from. |
| `bases[].lanesDir` | Where this base's lanes go. Each base needs its own, not nested in another's. |
| `bases[].branchPrefix` | Overrides the top-level branch prefix. Optional. |
| `bases[].open`, `create`, `remove` | This base's command lists. `open` is required here or at the top level; the others default to empty. |
| `bases[].template` | Built-in name, path or URL the lists came from, for `lanes commands update`. Optional. |
| `open`, `create`, `remove` | Shared lists for bases without their own. Optional. |
| `plugins` | Where to install each plugin the lists use: `{ "warp": "<git URL or path>" }`. Optional. |

A lane belongs to the base whose `lanesDir` holds it, so the same lane name can exist in two bases.

`"plugins": { "warp": "https://github.com/anvk/lanes.git#plugins/warp" }` goes at the top level when a list uses
`lanes warp tab`. The `default` template adds it for you.

**Coming from `ait`:** this tool used to be called `ait`. Its single-base `.ait.json` is not read. Run `lanes init`
once in the workspace, then remove the old install with `npm rm -g ait-cli && rm -rf ~/.ait-cli`.

### How a lane folder is built

`git worktree add` writes the tracked files; `lanes` then copies what git ignores (`node_modules`, build output, `.env`).
Untracked files that are not ignored stay in the base, and `lanes` says how many. On APFS the copy is a copy-on-write
clone, which is near-instant and takes no extra space until a file changes.
Without the `clonedir` helper (built at install when a compiler exists) or across volumes, `lanes` falls back to `cp`,
then to Node. `LANES_COPY=clone|cp|node` picks where to start; `lanes` still falls back if that fails.

## Running from another directory

`lanes` finds `.lanes.json` in the current directory or a parent. Elsewhere, it uses `LANES_REPO`:

```bash
echo 'export LANES_REPO=/path/to/workspace' >> ~/.zshrc && export LANES_REPO=/path/to/workspace
```

`lanes init` and `lanes doctor` print this line with your path. `LANES_REPO` never overrides the workspace you are in;
`lanes --repo <path> <command>` targets one explicitly.

## Development

The repository is laid out like this:

| Folder | What it is |
| --- | --- |
| `cli/` | The `lanes` command (package `lanes-cli`) |
| `plugins/api/` | `lanes-plugin-api`, the interface plugins implement |
| `plugins/warp/` | The Warp plugin (`lanes warp tab`) |
| `templates/` | Command documents; `default.json` is also built into `lanes` |
| `tools/install.sh` | The installer |

```bash
git clone https://github.com/anvk/lanes.git && cd lanes/cli
npm install
npm test
npm run build && npm link       # point the global `lanes` at this checkout
cd ~/.lanes-cli/cli && npm link   # point it back at the managed install
```

Self-update stays off in a linked development checkout. `readlink -f "$(command -v lanes)"` shows which one is active.

`lanes` knows no plugin by name. `cli/src/plugins/` loads what `lanes plugin install` put under `~/.lanes/plugins/`, registers
`lanes <plugin>` for each, and asks every plugin the same three things: validate its lines when a config is read, check
itself in `lanes doctor` when a base uses it, and forget a lane's files when the lane is removed or pruned. Writing one
is described in [`plugins/README.md`](plugins/README.md). Anything that is an ordinary program needs none of that and
is just a line in a list.
