import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGitHubUrl, rawGitHubUrl } from "./source.js";

test("a GitHub file link is read from its raw address", () => {
  const blob = parseGitHubUrl("https://github.com/acme/dev-setup/blob/main/lanes/web.json");
  assert.deepEqual(blob, { owner: "acme", repo: "dev-setup", ref: "main", filePath: "lanes/web.json" });
  assert.equal(rawGitHubUrl(blob!), "https://raw.githubusercontent.com/acme/dev-setup/main/lanes/web.json");
  const raw = parseGitHubUrl("https://raw.githubusercontent.com/acme/dev-setup/main/lanes/web.json");
  assert.equal(rawGitHubUrl(raw!), "https://raw.githubusercontent.com/acme/dev-setup/main/lanes/web.json");
});

test("other URLs are not GitHub files", () => {
  assert.equal(parseGitHubUrl("https://example.com/lanes.json"), null);
  assert.equal(parseGitHubUrl("https://github.com/acme/dev-setup"), null);
});
