import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseOpenDocument, type CommandDocument } from "../core/config.js";
import { commandExists, run } from "../core/process.js";
import { errorMessage } from "../core/util.js";
import { builtinTemplate } from "./templates.js";

const FETCH_TIMEOUT_MS = 15_000;

// One fetch per source per process: `lane init` replays answers after `back`, and a
// replayed source question must not hit the network again.
const cache = new Map<string, { lists: CommandDocument } | { error: string }>();

function isUrlSource(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

// Reads a command-list document from a built-in template name, a local path or a URL and
// validates it. Errors carry the source so the caller can print them and ask again.
export async function loadCommandsFromSource(source: string, cwd: string): Promise<CommandDocument> {
  const builtin = builtinTemplate(source);
  if (builtin) {
    return copyLists(builtin);
  }
  const cached = cache.get(source);
  if (cached) {
    if ("error" in cached) {
      throw new Error(cached.error);
    }
    return copyLists(cached.lists);
  }

  try {
    const text = isUrlSource(source) ? await fetchUrl(source) : readLocalFile(source, cwd);
    const lists = parseOpenDocument(text, "Command document");
    cache.set(source, { lists });
    return copyLists(lists);
  } catch (error) {
    const wrapped = `Could not load commands from ${source}: ${message(error)}`;
    cache.set(source, { error: wrapped });
    throw new Error(wrapped);
  }
}

function copyLists(document: CommandDocument): CommandDocument {
  const copy: CommandDocument = {};
  for (const list of ["open", "create", "remove"] as const) {
    if (document[list]) {
      copy[list] = [...document[list]];
    }
  }
  if (document.plugins) {
    copy.plugins = { ...document.plugins };
  }
  return copy;
}

function readLocalFile(source: string, cwd: string): string {
  const expanded = source.startsWith("~") ? path.join(os.homedir(), source.slice(1)) : source;
  const resolved = path.resolve(cwd, expanded);
  if (!fs.existsSync(resolved)) {
    throw new Error(`file not found: ${resolved}`);
  }
  return fs.readFileSync(resolved, "utf8");
}

interface GitHubFile {
  owner: string;
  repo: string;
  ref: string;
  filePath: string;
}

// github.com/<owner>/<repo>/blob/<ref>/<path> or raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>.
function parseGitHubUrl(source: string): GitHubFile | null {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return null;
  }
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (url.hostname === "github.com" && parts.length >= 5 && parts[2] === "blob") {
    return { owner: parts[0], repo: parts[1], ref: parts[3], filePath: parts.slice(4).join("/") };
  }
  if (url.hostname === "raw.githubusercontent.com" && parts.length >= 4) {
    return { owner: parts[0], repo: parts[1], ref: parts[2], filePath: parts.slice(3).join("/") };
  }
  return null;
}

async function fetchUrl(source: string): Promise<string> {
  // Private repositories answer anonymous requests with 404, so GitHub URLs go
  // through the authenticated `gh` CLI when it is available.
  const github = parseGitHubUrl(source);
  if (github && commandExists("gh")) {
    const endpoint =
      `repos/${github.owner}/${github.repo}/contents/${github.filePath}` + `?ref=${encodeURIComponent(github.ref)}`;
    try {
      return run("gh", ["api", "-H", "Accept: application/vnd.github.raw", endpoint]).stdout;
    } catch (error) {
      throw new Error(`gh api failed: ${message(error)}`);
    }
  }

  const response = await fetch(source, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  }
  return response.text();
}

// Node's fetch reports network errors as a bare "fetch failed" with the reason in `cause`.
function message(error: unknown): string {
  if (!(error instanceof Error)) {
    return errorMessage(error);
  }
  const cause = error.cause instanceof Error ? error.cause.message : typeof error.cause === "string" ? error.cause : "";
  return cause ? `${error.message} (${cause})` : error.message;
}
