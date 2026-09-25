// Request-shape check for lib/anthropic.ts — run after touching the client.
//
// Stubs global fetch and asserts what the client SENDS and how it reads the
// reply, with no API key and no spend:
//   - the default model is Sonnet 5, FAST_MODEL is Haiku 4.5, ANTHROPIC_MODEL wins
//   - Sonnet 5 gets NO temperature (400 on every request), thinking disabled
//     (on by default, billed as output) and output_config.effort medium;
//     Haiku gets temperature, no thinking, no effort
//   - a web-search call carries the top-level cache marker; a no-search call
//     does not unless it opts in
//   - a 400 that names an optional field (temperature, thinking,
//     output_config, cache_control) is retried once without that field only
//   - usage (input / cache write / cache read / output / searches) is read
//     from the response and logged as one line with the think/effort flags
//
// Usage: npx tsx scripts/anthropic-client-check.mts

process.env.ANTHROPIC_API_KEY = "test-key-not-real";
delete process.env.ANTHROPIC_MODEL;
delete process.env.ANTHROPIC_MODEL_FAST;
delete process.env.ANTHROPIC_EFFORT;

const { callClaudeWithWebSearch, FAST_MODEL } = await import("../lib/anthropic");

type Body = Record<string, unknown>;
const sent: Body[] = [];
let script: ((body: Body) => Response)[] = [];

const reply = (json: unknown, status = 200) =>
  new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
const err400 = (message: string) =>
  reply({ type: "error", error: { type: "invalid_request_error", message } }, 400);
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
  const body = JSON.parse(String(init?.body ?? "{}")) as Body;
  sent.push(body);
  const next = script.shift();
  return next ? next(body) : reply(okResponse());
}) as typeof fetch;

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const last = () => sent[sent.length - 1];
const j = (v: unknown) => JSON.stringify(v);

// Capture the usage log line.
const logged: string[] = [];
const origLog = console.log;
console.log = (...args: unknown[]) => {
  const line = args.map(String).join(" ");
  if (line.startsWith("[anthropic]")) logged.push(line);
  else origLog(...args);
};

// 1. Default: web search on → Sonnet 5 shape.
script = [];
const r1 = await callClaudeWithWebSearch({ system: "s", user: "u", temperature: 0.3 });
check(last().model === "claude-sonnet-5", "default model is claude-sonnet-5", String(last().model));
check(!("temperature" in last()), "Sonnet 5 request carries NO temperature (the API 400s on it)");
check(j(last().thinking) === '{"type":"disabled"}', "Sonnet 5 request switches thinking off", j(last().thinking));
check(j(last().output_config) === '{"effort":"medium"}', "Sonnet 5 request sends effort medium by default", j(last().output_config));
check(Array.isArray(last().tools) && (last().tools as unknown[]).length === 1, "web_search tool attached by default");
check(j(last().cache_control) === '{"type":"ephemeral"}', "search call carries top-level cache_control");
check(r1.usage.inputTokens === 1200 && r1.usage.cacheWriteTokens === 5600 && r1.usage.cacheReadTokens === 21000 && r1.usage.outputTokens === 340 && r1.usage.searches === 3,
  "usage read from the response", j(r1.usage));
check(r1.usage.thinking === "off" && r1.usage.effort === "medium", "usage carries the think/effort flags");
check(r1.searchCount === 3, "searchCount still reported");
check(logged.length === 1 && /think=off effort=medium/.test(logged[0]) && /cacheRead=21000/.test(logged[0]), "one usage line logged with flags", logged[0] ?? "(none)");

// 2. Haiku, no search → temperature kept, no thinking, no effort, no tools, no cache.
await callClaudeWithWebSearch({ system: "s", user: "u", webSearch: false, model: FAST_MODEL, temperature: 0.7 });
check(last().model === "claude-haiku-4-5", "FAST_MODEL is claude-haiku-4-5", String(last().model));
check(last().temperature === 0.7, "Haiku request keeps its temperature", String(last().temperature));
check(!("thinking" in last()) && !("output_config" in last()), "Haiku request sends neither thinking nor effort");
check(last().tools === undefined, "no-search call sends no tools");
check(last().cache_control === undefined, "no-search call sends no cache marker by default");

// 3. Cache opt-in / opt-out.
await callClaudeWithWebSearch({ system: "s", user: "u", webSearch: false, cache: true });
check(j(last().cache_control) === '{"type":"ephemeral"}', "cache: true opts a no-search call in");
await callClaudeWithWebSearch({ system: "s", user: "u", cache: false });
check(last().cache_control === undefined && Array.isArray(last().tools), "cache: false opts a search call out");

// 4. Effort per call and via env.
await callClaudeWithWebSearch({ system: "s", user: "u", effort: "low" });
check(j(last().output_config) === '{"effort":"low"}', "per-call effort override");
await callClaudeWithWebSearch({ system: "s", user: "u", effort: "high", model: FAST_MODEL });
check(!("output_config" in last()), "effort is never sent to Haiku, even when asked");

// 5. ANTHROPIC_MODEL override: Sonnet 4.6 accepts temperature, has no default thinking, takes effort.
process.env.ANTHROPIC_MODEL = "claude-sonnet-4-6";
await callClaudeWithWebSearch({ system: "s", user: "u" });
check(last().model === "claude-sonnet-4-6", "ANTHROPIC_MODEL env override still wins");
check(last().temperature === 0.4 && !("thinking" in last()) && j(last().output_config) === '{"effort":"medium"}',
  "Sonnet 4.6 shape: temperature 0.4, no thinking field, effort medium");
delete process.env.ANTHROPIC_MODEL;

// 6. One-shot fallback drops exactly the field the 400 names.
// Each case runs on a model whose request shape carries the named field:
// Sonnet 4.6 for temperature, Sonnet 5 (the default) for the rest.
const cases: [string, string, string | undefined][] = [
  ["temperature: non-default values are not supported on this model", "temperature", "claude-sonnet-4-6"],
  ["thinking: this model does not support thinking.type disabled", "thinking", undefined],
  ["output_config.effort: not supported on this model", "output_config", undefined],
  ["cache_control: Extra inputs are not permitted", "cache_control", undefined],
];
for (const [message, field, model] of cases) {
  const before = sent.length;
  script = [() => err400(message)];
  const r = await callClaudeWithWebSearch({ system: "s", user: "u", model });
  const first = sent[before];
  const second = sent[before + 1];
  const others = ["temperature", "thinking", "output_config", "cache_control"].filter((k) => k !== field && k in first);
  check(sent.length === before + 2 && field in first && !(field in second) && others.every((k) => k in second),
    `400 naming ${field} → one retry without ${field} only`, `${sent.length - before} request(s); kept ${others.join(",")}`);
  check(r.text === '{"ok":true}', `retry's answer is returned (${field})`);
}
const before6 = sent.length;
script = [() => err400("max_tokens: must be positive")];
let threw = "";
try { await callClaudeWithWebSearch({ system: "s", user: "u" }); } catch (e) { threw = String((e as Error).message); }
check(sent.length === before6 + 1 && /Anthropic 400/.test(threw), "unrelated 400 is not retried and surfaces", threw.slice(0, 80));

console.log = origLog;
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
