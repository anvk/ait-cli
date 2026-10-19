import pc from "picocolors";

export function formatRelativeTime(fromMs: number, nowMs = Date.now()): string {
  const diffMs = Math.max(0, nowMs - fromMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) {
    return "just now";
  }
  if (diffMs < hour) {
    const minutes = Math.floor(diffMs / minute);
    return `${minutes}m ago`;
  }
  if (diffMs < day) {
    const hours = Math.floor(diffMs / hour);
    return `${hours}h ago`;
  }
  const days = Math.floor(diffMs / day);
  return `${days}d ago`;
}

// The base filter, selector and [base] tags share one light periwinkle blue
// (#ada9f7). It is not one of the 16 ANSI colors, so it is a 24-bit escape,
// which Warp renders; terminals without color support get plain text.
export function paintBase(text: string): string {
  return pc.isColorSupported ? `\x1b[38;2;173;169;247m${text}\x1b[39m` : text;
}

// The installed version and any waiting update sit in the footer in a warm orange
// (#ffa657), so they read as a different kind of information from the dim key hints
// beside them. Same 24-bit approach as paintBase, with the same plain-text fallback.
export function paintUpdate(text: string): string {
  return pc.isColorSupported ? `\x1b[38;2;255;166;87m${text}\x1b[39m` : text;
}
