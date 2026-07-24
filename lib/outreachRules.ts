// Shared outreach-writing rules.
//
// Extracted from the intel-brief prompt so every generator that writes copy in
// Max's voice enforces the SAME ban list. Duplicating this text would guarantee
// drift: a tell banned in one place would keep shipping from another.

/** The banned-AI-tells block. Scoped to "any draft, LinkedIn or email". */
export const BANNED_WRITING = `HARD RULES: no signature, no sign-off. Ready to paste verbatim, no placeholders like [Name].
BANNED WRITING — AI TELLS. Never emit any draft (LinkedIn or email) containing the following. Enforce at generation.
Banned single words: delve, tapestry, multifaceted, seamless, robust, comprehensive, nuanced, leverage, utilize, facilitate, crucial, pivotal, vital, essential, innovative, innovate, revolutionary, transformative, game-changer, game-changing, cutting-edge, groundbreaking, unlock, elevate, empower, streamline, optimize, foster, harness, navigate, realm, landscape, journey, treasure trove, certainly, absolutely, meticulous, ever-evolving, testament, underscore, boasts, spearhead, holistic, synergy, supercharge, turbocharge, effortless, robustly, intersection.
Banned phrases: "it's worth noting", "in today's fast-paced world", "in today's digital age", "in the ever-evolving landscape", "when it comes to", "at the end of the day", "the world of", "a testament to", "plays a crucial role", "navigate the complexities", "unlock the potential", "take your [X] to the next level", "deliver actionable insights", "meticulous attention to detail", "let's dive in", "look no further", "rest assured", "needless to say", "I hope this finds you well", "I'd love to", "hope you're doing well", "congrats on the role", "that's exactly where", "that's precisely where", "precisely", "that's a real" (and any empty validation of the prospect's situation back at them: "that's a real architectural problem", "that's a tough challenge" — never grade or affirm their situation; state the mechanism instead), "move the needle" in any form (corporate speak), and ALL meta-commentary announcing what the message is or isn't ("no ask here", "not a pitch", "no agenda", "just sharing", "separate note") — never announce the message's intent, demonstrate it.
Banned structures (these override word-swapping — a draft can avoid every banned word and still be rejected on these):
- Negative parallelism: "it's not just X, it's Y" / "not about X, it's about Y" / "less about X, more about Y". Never.
- Rule-of-three fragments: three short punchy fragments in a row as a closer (e.g. "No blind spots. No rework. Just working code."). Never.
- Triple-adjective lists: "fast, scalable, and reliable". Never.
- Isolated rhetorical question as a transition: "The result? A 40% lift." Never.
- Em dashes anywhere. Use periods or commas.
Required to avoid the stiff-generated read:
- Keep contractions (you're, it's, won't, they're). Their absence reads as machine-formal.
- Vary sentence length. Do not produce 3-4 sentences all the same length. Mix a longer sentence with a short one.
- Every general claim must carry one concrete, prospect-specific detail (a real architecture fact from the signal). Generic praise of a benefit reads as AI even when no banned word is present. The specific observation defeats the AI-tell far more than word choice.
- Shorter beats fuller. Never pad toward the top of a character range. If a draft can lose 20% of its words without losing meaning, it is too wordy; cut it before emitting.
Highest-priority for this product specifically (a generator will reach for these because Bito is a developer-workflow product): never use "streamline / seamless / optimize / supercharge your workflow", "unlock developer productivity", or any workflow-benefit line. Lead with the mechanism and the prospect-specific detail instead.`;

/** Sanitize generated LinkedIn/email copy: kill dashes the model slips in
 *  anyway, collapse whitespace, and trim to `cap` at a sentence or word
 *  boundary rather than mid-word. */
export function enforceLinkedin(text: string, cap: number): string {
  let s = (text || "")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= cap) return s;
  const slice = s.slice(0, cap);
  const lastSentence = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("? "), slice.lastIndexOf("! "));
  if (lastSentence > cap * 0.5) return slice.slice(0, lastSentence + 1).trim();
  const lastWord = slice.lastIndexOf(" ");
  return (lastWord > 0 ? slice.slice(0, lastWord) : slice).trim();
}
