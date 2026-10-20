# lanes plugins

A `lanes` plugin is a command, `lanes <name> …`, that a base's command lists can use. Most tools
need no plugin: `cursor .`, `code .` or `tmux new-window -c {path}` are plain lines in a
list. A plugin is for a tool that only works through files or URIs, where something has to
write the file and clean it up later. Warp is the example: `lanes warp tab API --color red`
writes a Warp tab config and opens it, and `lanes` removes the file with the lane.

Plugins are installed per person from a git URL or a local folder, and `lanes` keeps them up to
date along with itself:

```bash
lanes plugin install https://github.com/anvk/lanes.git#plugins/warp
lanes plugin list
lanes plugin update        # lanes also does this whenever it updates itself
lanes plugin uninstall warp
```

A workspace can say where its plugins come from, so a teammate who opens it is offered the
install:

```json
"plugins": { "warp": "https://github.com/anvk/lanes.git#plugins/warp" }
```

This folder holds the plugins that ship with `lanes`, and `api/`, the interface they are written
against.

| Folder | What it is |
| --- | --- |
| `api/` | `lanes-plugin-api`: the `Plugin` interface, the lane environment names, the API version |
| `warp/` | `lanes warp tab`: a lane's folders as Warp tabs ([README](warp/README.md)) |

## Writing a plugin

A plugin is an npm package whose default export implements `Plugin` from `lanes-plugin-api`:

```
my-plugin/
  package.json      "main": "dist/index.js", "lanes": { "name": "tmux", "api": 1 }, a "build" script
  tsconfig.json
  src/index.ts      export default plugin
```

```json
{
  "name": "lanes-plugin-tmux",
  "type": "module",
  "main": "dist/index.js",
  "lanes": { "name": "tmux", "api": 1 },
  "scripts": { "build": "tsc -p tsconfig.json" },
  "dependencies": { "commander": "^12.1.0", "lanes-plugin-api": "git+https://github.com/anvk/lanes.git#path:plugins/api" },
  "devDependencies": { "typescript": "^5.8.2", "@types/node": "^22.13.10" }
}
```

Inside this repository, plugins depend on the API with `"lanes-plugin-api": "file:../api"`.

`lanes plugin install` clones the repository (or links the folder), runs `npm install` and
`npm run build` in the plugin folder, imports `main` and checks that it exports a plugin
with the right `name` and `api`. While developing, install from the folder you are working
in: `lanes plugin install ../my-plugin`. `lanes` never updates a linked folder; rebuild it yourself.

### The interface

```ts
import type { Plugin } from "lanes-plugin-api";

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

| Member | When `lanes` calls it |
| --- | --- |
| `api` | Checked at load. Must equal `API_VERSION` from `lanes-plugin-api`; a mismatch is reported, the plugin is not loaded. |
| `name` | The subcommand: `lanes <name> …`. Lowercase letters, digits, dashes. Must match `lanes.name` in `package.json`. |
| `register(command)` | At startup, with the `Command` for `lanes <name>`. Add subcommands with `command.command("sub")` on that instance; do not construct your own `Command` for them, so they share `lanes`'s commander. |
| `validate(words)` | Whenever a config or document with a `lanes <name> …` line is read, with the words after `lanes <name>`. Throw with a reason to reject the line; a bad flag then fails at load rather than when the lane opens. |
| `setupCommands(words)` | When a lane has just been created, to build the `Run the env setup script (…)? [y/N]` prompt. Return human-readable lines for anything the command would only run on creation, or `[]`. |
| `doctor()` | From `lanes doctor`, only when some base in the workspace uses the plugin. Return `{ level: "ok" \| "warn" \| "fail", message }` lines. |
| `forget(key)` | When a lane is removed or purged. Delete whatever you wrote for the lane with this key. |
| `findLeftovers(knownKeys)` | From `lanes prune` and `lanes doctor`. Return files you wrote for keys no longer in the list, grouped by key; `lanes` deletes them. |
| `closeCurrentTab()` (optional) | For `--close-current-tab`. Close the terminal tab the command runs in when it is yours and return `true`; otherwise return `false`. |
| `prompt(ask, existing?)` (optional) | From `lanes init`, when the user picks your plugin for an `open` entry. Ask your questions through `ask` and return the words after `lanes <name>`. `existing` holds the words of the line being edited. |

### What a command gets at run time

`lanes` runs each line of a list with `sh -c` in the lane folder, with the lane described in the
environment. `lanes-plugin-api` exports the names as `ENV`:

| `ENV.…` | Variable | Value |
| --- | --- | --- |
| `lane` | `LANE_NAME` | lane name, e.g. `ABC-1437` |
| `lanePath` | `LANE_PATH` | the lane folder (also the working directory) |
| `laneKey` | `LANE_KEY` | unique across the workspace and stable: always `<base>-<lane>`, such as `api-ABC-1437`. File things under it; `forget(key)` gets the same value. |
| `laneLabel` | `LANE_LABEL` | what people see: `ABC-1437 (api)` |
| `branch`, `base`, `root` | `LANE_BRANCH`, `LANE_BASE`, `LANE_ROOT` | the branch, the base name, the workspace folder |
| `created` | `LANE_CREATED` | `1` while the lane is opened right after creation |
| `runSetup` | `LANE_RUN_SETUP` | `1` when the setup prompt was accepted: include what you reported in `setupCommands` |
| `afterDir` | `LANE_AFTER_DIR` | see below; set only while `lanes` runs a list |

Run from a plain shell, none of these are set. Fall back to the current folder so the
command is useful on its own (`lanes warp tab Logs --command 'tail -f app.log'` opens one tab
for the folder you are in).

### Doing something once the whole list has run

Some tools want all of a lane's items at once: Warp tabs must be opened together to land in
one window or group. While `lanes` runs a list it sets `LANE_AFTER_DIR` to a scratch folder. Your
command can stage its work in a file there and write `<anything>.flush` containing one
command line, for example `lanes warp flush`. When the list is done `lanes` runs each `*.flush`
once (in name order) with the same environment, then deletes the folder. The flush command
reads the staged file and does the real work.

### Cleaning up

Name every file you write after `LANE_KEY` so `forget(key)` and `findLeftovers` can find
them with no other state (Warp uses `lanes~<key>~*.toml`; keep a separator keys cannot contain, so no lane's files match another's). `lanes` calls `forget` for every
installed plugin when a lane goes, whatever the config says now, since the lane may have
been opened under an earlier config.

### Testing

Keep the parts that compute things (line parsing, file contents) in modules a `node --test`
can import without `lanes`; see `warp/src/*.test.ts`. For the whole thing, point a workspace at
your folder (`lanes plugin install ../my-plugin`), set `HOME` to a scratch folder so
`~/.lanes` and your tool's files stay out of your real ones, and stub the programs you would
rather not run (the Warp plugin's tests stub `open` and `osascript` with scripts on `PATH`).

### Versions and updates

A plugin's version is the commit of its checkout; `lanes plugin list` shows the date and sha.
`lanes plugin update` fetches, resets to the remote's HEAD and rebuilds; `lanes` does the same for
every installed git plugin whenever it updates itself. A build that fails keeps the previous
one. `api` is bumped only for a change an existing plugin would not survive; until then a
plugin built against API 1 loads on every version of `lanes` that speaks API 1.
