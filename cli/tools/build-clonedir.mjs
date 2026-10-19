// Compiles the clonefile helper used to mirror a base folder quickly. lane works
// without it (the copy falls back to `cp` and then to Node), so a non-macOS host or a
// missing compiler is worth a note but must never fail the build.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "tools", "clonedir.c");
// The self-updater builds into a scratch directory before swapping it in, so the helper
// has to follow it there rather than always landing in dist/.
const outDir = process.env.LANE_BUILD_OUTDIR || path.join(root, "dist");
const output = path.join(outDir, "clonedir");

if (process.platform !== "darwin") {
  console.log("clonedir: skipped (macOS only); task folders will be copied instead of cloned");
  process.exit(0);
}

fs.mkdirSync(path.dirname(output), { recursive: true });
const result = spawnSync("cc", ["-O2", "-o", output, source], { stdio: "pipe", encoding: "utf8" });

if (result.status === 0) {
  console.log(`clonedir: built ${path.relative(root, output)}`);
  process.exit(0);
}

const reason = (result.stderr || result.error?.message || "cc is not available").trim().split("\n")[0];
fs.rmSync(output, { force: true });
console.log(`clonedir: not built (${reason}); task folders will be copied instead of cloned`);
