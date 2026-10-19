import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseOpenDocument } from "../core/config.js";
import { BUILTIN_TEMPLATES } from "./templates.js";

const templatesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../templates");

test("every built-in template matches its published copy", () => {
  for (const [name, document] of Object.entries(BUILTIN_TEMPLATES)) {
    const text = fs.readFileSync(path.join(templatesDir, `${name}.json`), "utf8");
    assert.deepEqual(parseOpenDocument(text, name), document, `templates/${name}.json`);
  }
});

test("the default template validates", () => {
  assert.deepEqual(parseOpenDocument(JSON.stringify(BUILTIN_TEMPLATES.default), "default"), BUILTIN_TEMPLATES.default);
});
