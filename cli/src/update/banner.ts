import { updateIsPending } from "./index.js";
import { describeVersion, resolveInstall } from "./install.js";

export interface VersionBanner {
  // Longest first. The picker footer takes the first one that fits beside the key hints,
  // so a waiting update degrades to a shorter wording rather than disappearing on a
  // narrow terminal — it is the part worth keeping.
  candidates: string[];
  // The version alone is just information. A waiting update is the one case that asks
  // something of the reader, so it is painted differently.
  pending: boolean;
}

let cached: VersionBanner | null = null;

// The picker is where developers spend their time, so this is where the version (with the
// sha, enough to quote in a bug report) and a waiting update belong. Resolved once per
// process, since the picker re-renders on every keystroke.
export function versionBanner(): VersionBanner {
  if (cached) {
    return cached;
  }
  try {
    const info = resolveInstall();
    const pending = info.managed && updateIsPending(info);
    const version = describeVersion(info);
    cached = {
      candidates: pending
        ? [`lanes ${version} · update on next start`, "update on next start", "update ready"]
        : [`lanes ${version}`, version],
      pending
    };
  } catch {
    cached = { candidates: [], pending: false };
  }
  return cached;
}
