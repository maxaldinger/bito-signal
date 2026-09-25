// Request-shape check for lib/anthropic.ts — run after touching the client.
//
// Stubs global fetch and asserts what the client SENDS and how it reads the
// reply, with no API key and no spend:
//   - the default model is Sonnet 5, FAST_MODEL is Haiku 4.5, ANTHROPIC_MODEL wins
//   - a web-search call carries the top-level cache marker; a no-search call
//     does not unless it opts in
//   - a 400 that names cache_control is retried once without the marker
//   - usage (input / cache write / cache read / output / searches) is read
//     from the response and logged as one line
//
// Usage: npx tsx scripts/anthropic-client-check.mts

process.env.ANTHROPIC_API_KEY = "test-key-not-real";
delete process.env.ANTHROPIC_MODEL;
delete process.env.ANTHROPIC_MODEL_FAST;

const { callClaudeWithWebSearch, FAST_MODEL } = await import("../lib/anthropic");

type Sent = { body: Record<string, unknown> };
const sent: Sent[] = [];
let script: ((body: Record<string, unknown>) => Response)[] = [];

const reply = (json: unknown, status = 200) =>
  new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
const okResponse = (text = '{"ok":true}') => ({
  content: [{ type: "text", text }],
  stop_reason: "end_turn",
  usage: {
    input_tokens: 1200,
    output_tokens: 340,
    cache_creation_input_tokens: 5600,
    cache_read_input_tokens: 21000,
    server_tool_use: { web_search_requests: 3 },
  },
});

globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  sent.push({ body });
  const next = script.shift();
  return next ? next(body) : reply(okResponse());
}) as typeof fetch;

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const last = () => sent[sent.length - 1].body;

// Capture the usage log line.
const logged: string[] = [];
const origLog = console.log;
console.log = (...args: unknown[]) => {
  const line = args.map(String).join(" ");
  if (line.startsWith("[anthropic]")) logged.push(line);
  else origLog(...args);
};

// 1. Default: web search on → Sonnet 5, tools present, cache marker present.
script = [];
const r1 = await callClaudeWithWebSearch({ system: "s", user: "u" });
check(last().model === "claude-sonnet-5", "default model is claude-sonnet-5", String(last().model));
check(Array.isArray(last().tools) && (last().tools as unknown[]).length === 1, "web_search tool attached by default");
check(JSON.stringify(last().cache_control) === '{"type":"ephemeral"}', "search call carries top-level cache_control");
check(r1.usage.inputTokens === 1200 && r1.usage.cacheWriteTokens === 5600 && r1.usage.cacheReadTokens === 21000 && r1.usage.outputTokens === 340 && r1.usage.searches === 3,
  "usage read from the response", JSON.stringify(r1.usage));
check(r1.searchCount === 3, "searchCount still reported");
check(logged.length === 1 && /cacheRead=21000/.test(logged[0]) && /claude-sonnet-5/.test(logged[0]), "one usage line logged", logged[0] ?? "(none)");

// 2. No search → no tools, no cache marker.
await callClaudeWithWebSearch({ system: "s", user: "u", webSearch: false, model: FAST_MODEL });
check(last().tools === undefined, "no-search call sends no tools");
check(last().cache_control === undefined, "no-search call sends no cache marker by default");
check(last().model === "claude-haiku-4-5", "FAST_MODEL is claude-haiku-4-5", String(last().model));

// 3. No search but opted in → cache marker present.
await callClaudeWithWebSearch({ system: "s", user: "u", webSearch: false, cache: true });
check(JSON.stringify(last().cache_control) === '{"type":"ephemeral"}', "cache: true opts a no-search call in");

// 4. Search call with cache: false → no marker.
await callClaudeWithWebSearch({ system: "s", user: "u", cache: false });
check(last().cache_control === undefined && Array.isArray(last().tools), "cache: false opts a search call out");

// 5. A 400 naming cache_control is retried once without it; other 400s are not.
const before = sent.length;
script = [() => reply({ type: "error", error: { type: "invalid_request_error", message: "cache_control: Extra inputs are not permitted" } }, 400)];
const r5 = await callClaudeWithWebSearch({ system: "s", user: "u" });
check(sent.length === before + 2, "cache_control 400 → exactly one retry", `${sent.length - before} request(s)`);
check(sent[before].body.cache_control !== undefined && sent[before + 1].body.cache_control === undefined, "retry drops the cache marker only");
check(r5.text === '{"ok":true}', "retry's answer is returned");
const before6 = sent.length;
script = [() => reply({ type: "error", error: { type: "invalid_request_error", message: "max_tokens: must be positive" } }, 400)];
let threw = "";
try { await callClaudeWithWebSearch({ system: "s", user: "u" }); } catch (e) { threw = String((e as Error).message); }
check(sent.length === before6 + 1 && /Anthropic 400/.test(threw), "unrelated 400 is not retried and surfaces", threw.slice(0, 80));

// 6. ANTHROPIC_MODEL override wins over the default.
process.env.ANTHROPIC_MODEL = "claude-sonnet-4-6";
script = [];
await callClaudeWithWebSearch({ system: "s", user: "u" });
check(last().model === "claude-sonnet-4-6", "ANTHROPIC_MODEL env override still wins (a stale override pins the old price)");
delete process.env.ANTHROPIC_MODEL;

console.log = origLog;
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
