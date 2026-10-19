// tsc writes plain 644 files, but a bin entry has to be executable. npm sets that bit
// during `npm install`/`npm link`, so a normal install is fine — but the lanes self-update
// rebuilds dist without npm, and the swapped-in file would land unexecutable, leaving
// `lanes` as "permission denied" and no working lanes to fix it with.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = process.env.LANES_BUILD_OUTDIR || path.join(root, "dist");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const bins = typeof pkg.bin === "string" ? { [pkg.name]: pkg.bin } : (pkg.bin ?? {});

for (const target of Object.values(bins)) {
  // "./dist/bin/lanes.js" is relative to the package; the build may be going somewhere else.
  const relative = path.relative("dist", target.replace(/^\.\//, ""));
  const file = path.join(outDir, relative);
  try {
    fs.chmodSync(file, 0o755);
  } catch (error) {
    console.error(`bin mode: could not make ${file} executable (${error.message})`);
    process.exit(1);
  }
}
