export function timeAgo(dateISO: string): string {
  if (!dateISO) return "";
  const then = new Date(dateISO).getTime();
  if (Number.isNaN(then)) return dateISO;
  const diffMs = Date.now() - then;
  if (diffMs < 0) return new Date(dateISO).toLocaleDateString("en-US", { month: "short", year: "numeric" });
  const days = Math.floor(diffMs / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** Short calendar date from an epoch-ms timestamp, e.g. "Jun 15, 2026". */
export function fmtDate(ms: number): string {
  if (!ms || Number.isNaN(ms)) return "";
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function fmtUSD(n: number): string {
  if (!n) return "$0";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

export function fmtNum(n: number): string {
  if (!n) return "0";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return Math.round(n).toString();
}

/**
 * Strip the AI-writing "tell" of em/en dashes from generated outreach.
 * Em dash (—) acts as a clause separator → comma; en dash (–) → hyphen.
 * Deterministic so it catches dashes even when the model ignores the prompt.
 */
export function stripEmDashes(text: string): string {
  if (!text) return text;
  return text
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s*–\s*/g, "-")
    .replace(/,\s*,/g, ",")
    .replace(/[ \t]{2,}/g, " ");
}
