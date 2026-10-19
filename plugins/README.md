# lane plugins

A lane plugin is a command, `lane <name> …`, that a base's command lists can use. Most tools
need no plugin: `cursor .`, `code .` or `tmux new-window -c {path}` are plain lines in a
list. A plugin is for a tool that only works through files or URIs, where something has to
write the file and clean it up later. Warp is the example: `lane warp tab API --color red`
writes a Warp tab config and opens it, and lane removes the file with the task.

Plugins are installed per person from a git URL or a local folder, and lane keeps them up to
date along with itself:

```bash
lane plugin install https://github.com/anvk/lane.git#plugins/warp
lane plugin list
lane plugin update        # lane also does this whenever it updates itself
lane plugin uninstall warp
```

A workspace can say where its plugins come from, so a teammate who opens it is offered the
install:

```json
"plugins": { "warp": "https://github.com/anvk/lane.git#plugins/warp" }
```

This folder holds the plugins that ship with lane, and `api/`, the interface they are written
against.

| Folder | What it is |
| --- | --- |
| `api/` | `lane-plugin-api`: the `Plugin` interface, the task environment names, the API version |
| `warp/` | `lane warp tab`: a task's folders as Warp tabs ([README](warp/README.md)) |

## Writing a plugin

A plugin is an npm package whose default export implements `Plugin` from `lane-plugin-api`:

```
my-plugin/
  package.json      "main": "dist/index.js", "lane": { "name": "tmux", "api": 1 }, a "build" script
  tsconfig.json
  src/index.ts      export default plugin
```

```json
{
  "name": "lane-plugin-tmux",
  "type": "module",
  "main": "dist/index.js",
  "lane": { "name": "tmux", "api": 1 },
  "scripts": { "build": "tsc -p tsconfig.json" },
  "dependencies": { "commander": "^12.1.0", "lane-plugin-api": "git+https://github.com/anvk/lane.git#path:plugins/api" },
  "devDependencies": { "typescript": "^5.8.2", "@types/node": "^22.13.10" }
}
```

Inside this repository, plugins depend on the API with `"lane-plugin-api": "file:../api"`.

`lane plugin install` clones the repository (or links the folder), runs `npm install` and
`npm run build` in the plugin folder, imports `main` and checks that it exports a plugin
with the right `name` and `api`. While developing, install from the folder you are working
in: `lane plugin install ../my-plugin`. lane never updates a linked folder; rebuild it yourself.

### The interface

```ts
import type { Plugin } from "lane-plugin-api";

const plugin: Plugin = {
  api: 1,
  name: "tmux",
  description: "tmux windows, for use in a base's open list",
  register(command) { … },
  validate(words) { … },
  setupCommands(words) { return []; },
  doctor() { return []; },
  forget(key) { … },
  findLeftovers(knownKeys) { return []; },
};
export default plugin;
```

| Member | When lane calls it |
| --- | --- |
| `api` | Checked at load. Must equal `API_VERSION` from `lane-plugin-api`; a mismatch is reported, the plugin is not loaded. |
| `name` | The subcommand: `lane <name> …`. Lowercase letters, digits, dashes. Must match `lane.name` in `package.json`. |
| `register(command)` | At startup, with the `Command` for `lane <name>`. Add subcommands with `command.command("sub")` on that instance; do not construct your own `Command` for them, so they share lane's commander. |
| `validate(words)` | Whenever a config or document with a `lane <name> …` line is read, with the words after `lane <name>`. Throw with a reason to reject the line; a bad flag then fails at load rather than when the task opens. |
| `setupCommands(words)` | When a task has just been created, to build the `Run the env setup script (…)? [y/N]` prompt. Return human-readable lines for anything the command would only run on creation, or `[]`. |
| `doctor()` | From `lane doctor`, only when some base in the workspace uses the plugin. Return `{ level: "ok" \| "warn" \| "fail", message }` lines. |
| `forget(key)` | When a task is removed or purged. Delete whatever you wrote for the task with this key. |
| `findLeftovers(knownKeys)` | From `lane prune` and `lane doctor`. Return files you wrote for keys no longer in the list, grouped by key; lane deletes them. |
| `closeCurrentTab()` (optional) | For `--close-current-tab`. Close the terminal tab the command runs in when it is yours and return `true`; otherwise return `false`. |
| `prompt(ask, existing?)` (optional) | From `lane init`, when the user picks your plugin for an `open` entry. Ask your questions through `ask` and return the words after `lane <name>`. `existing` holds the words of the line being edited. |

### What a command gets at run time

lane runs each line of a list with `sh -c` in the task folder, with the task described in the
environment. `lane-plugin-api` exports the names as `ENV`:

| `ENV.…` | Variable | Value |
| --- | --- | --- |
| `task` | `LANE_TASK` | task name, e.g. `LANE-1437` |
| `taskPath` | `LANE_TASK_PATH` | the task folder (also the working directory) |
| `taskKey` | `LANE_TASK_KEY` | unique across the workspace (`api-LANE-1437` with several bases). File things under it; `forget(key)` gets the same value. |
| `taskLabel` | `LANE_TASK_LABEL` | what people see: `LANE-1437 (api)` |
| `branch`, `base`, `root` | `LANE_BRANCH`, `LANE_BASE`, `LANE_ROOT` | the branch, the base name, the workspace folder |
| `created` | `LANE_CREATED` | `1` while the task is opened right after creation |
| `runSetup` | `LANE_RUN_SETUP` | `1` when the setup prompt was accepted: include what you reported in `setupCommands` |
| `afterDir` | `LANE_AFTER_DIR` | see below; set only while lane runs a list |

Run from a plain shell, none of these are set. Fall back to the current folder so the
command is useful on its own (`lane warp tab Logs --command 'tail -f app.log'` opens one tab
for the folder you are in).

### Doing something once the whole list has run

Some tools want all of a task's items at once: Warp tabs must be opened together to land in
one window or group. While lane runs a list it sets `LANE_AFTER_DIR` to a scratch folder. Your
command can stage its work in a file there and write `<anything>.flush` containing one
command line, for example `lane warp flush`. When the list is done lane runs each `*.flush`
once (in name order) with the same environment, then deletes the folder. The flush command
reads the staged file and does the real work.

### Cleaning up

Name every file you write after `LANE_TASK_KEY` so `forget(key)` and `findLeftovers` can find
them with no other state (Warp uses `lane-<key>-*.toml`). lane calls `forget` for every
installed plugin when a task goes, whatever the config says now, since the task may have
been opened under an earlier config.

### Testing

Keep the parts that compute things (line parsing, file contents) in modules a `node --test`
can import without lane; see `warp/src/*.test.ts`. For the whole thing, point a workspace at
your folder (`lane plugin install ../my-plugin`), set `HOME` to a scratch folder so lane's
`~/.lane` and your tool's files stay out of your real ones, and stub the programs you would
rather not run (the Warp plugin's tests stub `open` and `osascript` with scripts on `PATH`).

### Versions and updates

A plugin's version is the commit of its checkout; `lane plugin list` shows the date and sha.
`lane plugin update` fetches, resets to the remote's HEAD and rebuilds; lane does the same for
every installed git plugin whenever it updates itself. A build that fails keeps the previous
one. `api` is bumped only for a change an existing plugin would not survive; until then a
plugin built against API 1 loads on every lane that speaks API 1.
