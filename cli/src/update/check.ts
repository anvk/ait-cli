// Entry point for the detached background check. Nobody waits for this and nobody reads
// its output: it asks the remote where main points, records the answer, and exits. Keep the
// imports light — this must not pull in the command layer.
import { resolveInstallPaths } from "./install.js";
import { probeRemote } from "./index.js";
import { writeState } from "./state.js";

function main(): void {
  const info = resolveInstallPaths();
  if (!info.gitRoot || !info.managed) {
    return;
  }
  const sha = probeRemote(info);
  if (!sha) {
    // Offline, or the remote refused. Record nothing; the next run simply asks again.
    return;
  }
  writeState({ remoteSha: sha, checkedAt: Date.now() });
}

try {
  main();
} catch {
  // This process exists to be invisible. Never let it print or fail loudly.
}
