// Single source of truth for "is this address safe to actually send to".
//
// Every outreach path must agree, because a hard bounce costs sending
// reputation across the whole domain, not just the one send. Previously the two
// pipelines disagreed: the stakeholder cards had no status check at all, and
// the GitHub-prospect path used a DENYLIST of three values, so any status
// Apollo added later (notably "extrapolated", which is explicitly a guess)
// passed as acceptable.
//
// This is an ALLOWLIST on purpose. An unrecognized, empty, or missing status
// means "we do not know", and not-known must never mean "send it".

/** Apollo email_status values that represent a real, checked mailbox. */
const SENDABLE_STATUSES = new Set(["verified"]);

/** True only when the provider positively asserts the address is verified. */
export function isSendableEmail(status?: string | null): boolean {
  if (!status) return false;
  return SENDABLE_STATUSES.has(status.trim().toLowerCase());
}

/** Short, honest label for the UI. Never claims more than the provider said. */
export function emailStatusLabel(status?: string | null): string {
  const s = (status ?? "").trim().toLowerCase();
  if (!s) return "unconfirmed";
  if (s === "verified") return "verified";
  // Apollo's own wording for the rest ("guessed", "extrapolated",
  // "unavailable", "unverified", ...) is more informative than a generic word.
  return s;
}

/** Why an address was withheld from outreach, for the UI and for task notes. */
export function unsendableReason(status?: string | null): string {
  const s = (status ?? "").trim().toLowerCase();
  if (!s) return "Apollo returned no verification status for this address";
  return `Apollo status "${s}" — not a verified mailbox`;
}
