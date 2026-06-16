// Thin wrapper around the Anthropic Messages API with the web_search server tool.
//
// We talk to the API over plain fetch (no SDK) so the bundle stays tiny and
// the route deploys cleanly as a Vercel function. The model is asked to ground
// every answer in web_search results — we never fall back to fabricated data.

import type { LiveCitation } from "./types";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-4-6";

export interface AnthropicCallOptions {
  system: string;
  user: string;
  // Optional prior assistant/user history.
  history?: { role: "user" | "assistant"; content: string }[];
  /**
   * Attach the web_search tool (default true). Set false for pure
   * reasoning/grading calls — they bill only tokens, no $10/1K searches.
   */
  webSearch?: boolean;
  // Max searches the model may issue (default 5).
  maxSearches?: number;
  // Allow/block search domains.
  allowedDomains?: string[];
  blockedDomains?: string[];
  // Token cap for the model's reasoning + output. Defaults are generous so the
  // model can browse, summarize, and emit structured JSON in one shot.
  maxTokens?: number;
  temperature?: number;
}

export interface AnthropicCallResult {
  text: string;             // concatenated text content
  citations: LiveCitation[]; // dedupe-by-url citations from web_search
  searchCount: number;       // how many searches the model actually issued
  /** error codes from failed web_search invocations (e.g. "max_uses_exceeded"). */
  searchErrors: string[];
  /** true when the response was cut off (stop_reason max_tokens / pause_turn). */
  truncated: boolean;
  stopReason: string | null;
  raw: unknown;              // pass-through for debugging
}

/**
 * Remove citation markup the model sometimes bakes into output as literal
 * text (e.g. `<cite index="21-1,21-3">…</cite>`). The structured citation
 * system only attaches to plain-text blocks, so when the model writes JSON it
 * can imitate the markup inside string values — which would otherwise render
 * raw in the UI.
 */
export function stripCiteMarkup(s: string): string {
  return s
    .replace(/<\/?(?:antml:)?cite[^>]*>/gi, "")
    .replace(/ {2,}/g, " ");
}

/** Strip ```json … ``` fences and trim, then attempt to extract the first JSON object. */
export function extractJSON<T = unknown>(text: string): T | null {
  if (!text) return null;
  let candidate = text.trim();
  candidate = candidate.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(candidate) as T;
  } catch {
    /* fall through */
  }
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1)) as T;
    } catch {
      /* swallow */
    }
  }
  // Last resort: try to find a top-level array.
  const aStart = candidate.indexOf("[");
  const aEnd = candidate.lastIndexOf("]");
  if (aStart !== -1 && aEnd > aStart) {
    try {
      return JSON.parse(candidate.slice(aStart, aEnd + 1)) as T;
    } catch {
      /* swallow */
    }
  }
  return null;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  citations?: {
    type?: string;
    url?: string;
    title?: string;
    cited_text?: string;
  }[];
  // For web_search_tool_result blocks:
  content?:
    | {
        type: "web_search_result";
        url?: string;
        title?: string;
        page_age?: string;
      }[]
    | { type: "web_search_tool_result_error"; error_code?: string };
  name?: string;
  input?: { query?: string };
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  stop_reason?: string;
  usage?: {
    server_tool_use?: { web_search_requests?: number };
  };
}

/**
 * Single round-trip to Anthropic Messages with the web_search tool enabled.
 *
 * Returns the model's concatenated text output plus an extracted, deduplicated
 * citation list pulled both from inline `citations` and `web_search_tool_result`
 * blocks. Throws on transport / auth / quota failures so route handlers can
 * surface a precise error to the UI.
 */
export async function callClaudeWithWebSearch(
  opts: AnthropicCallOptions,
): Promise<AnthropicCallResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it in Vercel project settings (or .env.local for dev).",
    );
  }

  const model = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
  const maxUses = Math.max(
    1,
    Math.min(
      10,
      opts.maxSearches ?? Number(process.env.ANTHROPIC_WEB_SEARCH_MAX || 5),
    ),
  );

  const messages: { role: "user" | "assistant"; content: string }[] = [
    ...(opts.history ?? []),
    { role: "user", content: opts.user },
  ];

  const tool: Record<string, unknown> = {
    type: "web_search_20250305",
    name: "web_search",
    max_uses: maxUses,
  };
  if (opts.allowedDomains?.length) tool.allowed_domains = opts.allowedDomains;
  if (opts.blockedDomains?.length) tool.blocked_domains = opts.blockedDomains;

  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0.4,
    system: opts.system,
    messages,
  };
  if (opts.webSearch !== false) body.tools = [tool];

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    const snippet = errText.slice(0, 320).replace(/\s+/g, " ");
    if (res.status === 401) {
      throw new Error(
        "Anthropic API key invalid or revoked. Update ANTHROPIC_API_KEY and redeploy.",
      );
    }
    if (res.status === 403 && /web_search|tool/i.test(errText)) {
      throw new Error(
        "Web search is not enabled for this Anthropic workspace. Enable it in the Anthropic Console → Settings → Privacy.",
      );
    }
    throw new Error(`Anthropic ${res.status}: ${snippet || res.statusText}`);
  }

  const data: AnthropicResponse = await res.json();
  return extractFromResponse(data);
}

function extractFromResponse(data: AnthropicResponse): AnthropicCallResult {
  const blocks = Array.isArray(data.content) ? data.content : [];

  // 1. Concatenate the model's spoken text (cite markup stripped — see
  //    stripCiteMarkup; it would otherwise leak into UI strings and JSON).
  const text = stripCiteMarkup(
    blocks
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("\n")
      .trim(),
  );

  // 2. Citations come from two places:
  //    - inline `citations` arrays on text blocks, and
  //    - the bulk `web_search_tool_result` content arrays.
  const citationMap = new Map<string, LiveCitation>();
  const searchErrors: string[] = [];

  for (const block of blocks) {
    // 2a. inline citations
    if (block.type === "text" && Array.isArray(block.citations)) {
      for (const c of block.citations) {
        if (!c?.url) continue;
        const key = c.url;
        if (!citationMap.has(key)) {
          citationMap.set(key, {
            title: c.title || c.url,
            source: hostOf(c.url),
            url: c.url,
            kind: "other",
          });
        }
      }
    }
    // 2b. failed searches — record the error code instead of dropping it
    if (
      block.type === "web_search_tool_result" &&
      block.content &&
      !Array.isArray(block.content)
    ) {
      searchErrors.push(block.content.error_code ?? "unknown_search_error");
    }
    // 2c. raw search results
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) {
        if (!("type" in r) || r.type !== "web_search_result") continue;
        const url = (r as { url?: string }).url;
        const title = (r as { title?: string }).title;
        const pageAge = (r as { page_age?: string }).page_age;
        if (!url) continue;
        if (!citationMap.has(url)) {
          citationMap.set(url, {
            title: title || url,
            source: hostOf(url),
            url,
            date: pageAge,
            kind: "other",
          });
        }
      }
    }
  }

  const stopReason = data.stop_reason ?? null;
  return {
    text,
    citations: Array.from(citationMap.values()),
    searchCount: data.usage?.server_tool_use?.web_search_requests ?? 0,
    searchErrors,
    truncated: stopReason === "max_tokens" || stopReason === "pause_turn",
    stopReason,
    raw: data,
  };
}

function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
