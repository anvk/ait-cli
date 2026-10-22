import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeConfig, parseOpenDocument, resolveBaseCommands } from "./config.js";
import { setPlugins } from "../plugins/registry.js";
import type { Plugin } from "../plugins/types.js";

const CLAUDE_TAB = "lanes warp tab Claude --color yellow --command 'claude --continue'";

function base(name: string, extra: Record<string, unknown> = {}) {
  return { name, folder: `${name}-base`, ref: "origin/main", lanesDir: `lanes/${name}`, open: [CLAUDE_TAB], ...extra };
}

// A stand-in for an installed plugin that only accepts `tab` lines.
const fakeWarp: Plugin = {
  api: 1,
  name: "warp",
  description: "fake",
  register() {},
  validate(words) {
    if (words[0] !== "tab") {
      throw new Error("only `lanes warp tab` can be used here.");
    }
    if (words.includes("--color") && words[words.indexOf("--color") + 1] === "purple") {
      throw new Error("Warp only supports red, green, yellow, blue, magenta, cyan.");
    }
  },
  setupCommands() {
    return [];
  },
  doctor() {
    return [];
  },
  forget() {},
  findLeftovers() {
    return [];
  }
};

test("a multi-base config is normalized with defaults filled in", () => {
  const config = normalizeConfig({ lanePrefix: " ABC- ", bases: [base("api"), base("web", { branchPrefix: "x/" })] });
  assert.equal(config.lanePrefix, "ABC-");
  assert.equal(config.branchPrefix, "");
  assert.equal(config.oldLaneDays, 14);
  assert.deepEqual(
    config.bases.map((b) => b.name),
    ["api", "web"]
  );
  assert.equal(config.bases[1].branchPrefix, "x/");
  assert.deepEqual(config.bases[0].open, [CLAUDE_TAB]);
  assert.deepEqual(resolveBaseCommands(config, config.bases[0]), { open: [CLAUDE_TAB], create: [], remove: [] });
  assert.equal(config.plugins, undefined);
});

test("bases fall back to the top-level lists", () => {
  const config = normalizeConfig({
    open: ["cursor ."],
    remove: ["make down"],
    bases: [{ ...base("api"), open: undefined }, base("web", { remove: [] })]
  });
  assert.equal(config.bases[0].open, undefined);
  assert.deepEqual(resolveBaseCommands(config, config.bases[0]), {
    open: ["cursor ."],
    create: [],
    remove: ["make down"]
  });
  assert.deepEqual(resolveBaseCommands(config, config.bases[1]), { open: [CLAUDE_TAB], create: [], remove: [] });
});

test("a base with no open list anywhere is rejected", () => {
  assert.throws(() => normalizeConfig({ bases: [{ ...base("api"), open: undefined }] }), /no `open` commands/);
});

test("command lines are validated when the config is read", () => {
  const withOpen = (line: unknown) => normalizeConfig({ bases: [base("api", { open: [line] })] });
  assert.throws(() => withOpen(""), /non-empty command line/);
  assert.throws(() => withOpen(42), /must be a command line/);
  assert.throws(() => withOpen("echo 'unterminated"), /unterminated single quote/);
  assert.throws(() => withOpen("lanes"), /`lanes` on its own/);
  assert.equal(withOpen("  cursor .  ").bases[0].open?.[0], "cursor .");
  // A plugin that is not installed cannot check its lines yet; lanes offers to install it later.
  assert.equal(withOpen("lanes nope --anything").bases[0].open?.[0], "lanes nope --anything");
});

test("an installed plugin checks its own lines", () => {
  setPlugins([fakeWarp]);
  try {
    const withOpen = (line: string) => normalizeConfig({ bases: [base("api", { open: [line] })] });
    assert.throws(() => withOpen("lanes warp flush"), /only `lanes warp tab`/);
    assert.throws(() => withOpen("lanes warp tab API --color purple"), /Warp only supports/);
    assert.equal(withOpen("lanes warp tab API").bases[0].open?.[0], "lanes warp tab API");
  } finally {
    setPlugins([]);
  }
});

test("plugins map names to where to install them", () => {
  const config = normalizeConfig({ plugins: { warp: " https://x/y.git#p " }, bases: [base("api")] });
  assert.deepEqual(config.plugins, { warp: "https://x/y.git#p" });
  assert.throws(() => normalizeConfig({ plugins: ["warp"], bases: [base("api")] }), /object mapping plugin names/);
  assert.throws(() => normalizeConfig({ plugins: { Warp: "x" }, bases: [base("api")] }), /not a plugin name/);
  assert.throws(() => normalizeConfig({ plugins: { warp: "" }, bases: [base("api")] }), /git URL or a path/);
});

test("duplicate base names are rejected", () => {
  assert.throws(() => normalizeConfig({ bases: [base("api"), base("api")] }), /more than one base named 'api'/);
});

test("a lanes directory nested in another base's is rejected", () => {
  assert.throws(
    () => normalizeConfig({ bases: [base("api", { lanesDir: "lanes" }), base("web", { lanesDir: "lanes/web" })] }),
    /is inside lanesDir/
  );
});

test("base names are limited to safe characters", () => {
  assert.throws(() => normalizeConfig({ bases: [base("c c")] }), /may only contain/);
});

test("oldLaneDays must be a positive integer", () => {
  assert.equal(normalizeConfig({ oldLaneDays: "21", bases: [base("api")] }).oldLaneDays, 21);
  assert.throws(() => normalizeConfig({ oldLaneDays: 0, bases: [base("api")] }), /positive integer/);
});

test("a document holds command lists and plugin sources, or a bare list of open lines", () => {
  assert.deepEqual(
    parseOpenDocument(
      JSON.stringify({ open: ["cursor ."], remove: ["make down"], plugins: { tmux: "https://x/t.git" } }),
      "doc"
    ),
    { open: ["cursor ."], remove: ["make down"], plugins: { tmux: "https://x/t.git" } }
  );
  assert.deepEqual(parseOpenDocument(JSON.stringify(["cursor ."]), "doc"), { open: ["cursor ."] });
  assert.throws(() => parseOpenDocument("{", "doc"), /not valid JSON/);
  assert.throws(() => parseOpenDocument("{}", "doc"), /"open", "create" or "remove"/);
  // Other keys are ignored, so a stray field from some other tool is not a document.
  assert.throws(() => parseOpenDocument('{"warpTabs": [{"title": "x"}]}', "doc"), /"open", "create" or "remove"/);
  assert.throws(() => parseOpenDocument('[{"title": "x"}]', "doc"), /must be a command line/);
});

test("a config without bases is rejected", () => {
  assert.throws(() => normalizeConfig({ lanePrefix: "ABC-" }), /`bases` must be an array/);
});
