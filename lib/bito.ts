// Canonical Bito product context, shared by every API route's system prompt.
//
// This is the only place we put "Bito facts" so the model never invents
// product claims. Everything else (companies, signals, intel) is sourced
// live from web_search.
//
// POSITIONING (Max, Sep 24 2026): the default focus is GOVERNOR. The earlier
// version of this file was an AI Architect product sheet, injected into every
// prompt, and it produced briefs that were branded Governor but substantively
// pitched AI Architect (Capital One). Governor now leads; AI Architect is
// positioned as the engine behind Governor's context lever and as a product in
// its own right. `bitoContextFor("ai_architect")` flips the order for work
// that is explicitly scoped to AI Architect (the POC plan generator).

export type BitoProduct = "governor" | "ai_architect";

const PORTFOLIO = `Bito sells two products. GOVERNOR is the default focus for prospecting: a context-driven model router that sits between a team's coding harness and its model providers. AI ARCHITECT is the cross-repo context engine that powers Governor's context lever and is also sold on its own (context layer, code review, design and scoping). Code review is one capability, not the whole company.`;

const GOVERNOR = `GOVERNOR — the layer between coding harnesses and model providers
- What it is: a transparent proxy between a coding harness (Claude Code, Cursor, Codex, Copilot) and the models. Drop-in: the team points the harness's base URL at Governor and nothing else in the developer workflow changes. Works direct to model providers or in front of an existing gateway.
- Why it exists: agentic coding spend has two multipliers, the number of tokens a task consumes and the price per token. Governor manages both at once, and holds or improves task quality while doing it.
- Lever 1, context optimization (powered by AI Architect's index): when an agent gets a task, Governor resolves it to the code that answers it and injects that context up front, so the agent skips most of the file reading, grep loops and re-discovery of service relationships. Contribution: fewer reasoning turns and tool calls, fewer tokens per task, higher task success. This is the lever every published figure below measures.
- Lever 2, model routing: once the right code is in the prompt, most requests stop needing frontier-grade reasoning, so each request is routed to the lowest-cost model that clears the quality bar, with frontier models kept for the work that needs them. Contribution: lower price per token and one centralized model policy instead of per-developer guesses (governance over which models do which work). Routing has NO published benchmark; its benefit is stated as price-per-token economics and policy, never as a measured percentage.
- The business case is built on four measures: cost per successful task, task time, tool calls / reasoning turns, and task success maintained or improved. Quality is a constraint, not a trade-off.
- How Governor and AI Architect relate: AI Architect is the engine that gives Governor its context. In a Governor conversation, name it as the engine; do not make it the product being pitched.`;

const AI_ARCHITECT = `AI ARCHITECT — the cross-repo context engine (Governor's context lever, and a product on its own)
- The Context Layer (the core): a pre-indexed, cross-repo knowledge graph of the org's code — architecture, dependencies, API contracts, tech stacks, coding patterns/standards, and business rules — exposed to any AI coding tool (Cursor, GitHub Copilot, Claude Code, Windsurf, etc.) via MCP, and to Governor, so generated code is grounded in the team's real codebase.
- Grounded code generation: AI agents write code that fits the existing architecture, conventions, and cross-repo contracts, cutting hallucinated/throwaway output and rework.
- AI Code Reviews: deep, multi-file, codebase-aware PR reviews that catch logic bugs, security issues, regressions, and architecture/standards violations (symbol indexing, AST parsing, embeddings) — beyond what a linter or basic AI assistant catches.
- Design & scoping: analyzes issues/tickets against the real codebase (blast radius, affected services, effort) so work is planned with architectural context before code is written.
- Standards & patterns: governs and enforces the org's conventions and architectural patterns consistently across teams and repos.
- Integrates with GitHub, GitLab, Bitbucket; IDE plugins (VS Code, JetBrains, Cursor, Windsurf) and a CLI. SOC 2 Type 2. Self-hosted and cloud options.`;

const PROOF = `PROOF POINTS (published; cite as real, never inflate — and say what each one MEASURES)
Measured results. Every figure below was measured on the CONTEXT lever with the model held constant; none of them measures routing.
- Controlled customer A/B, identical tasks on Claude Code: cost per task $4.12 to $2.14 (-48%), reasoning turns 47.6 to 23.6, tool calls -53%, tasks 36% faster, task success 100% in both arms.
- Full ten-ask working session, five runs per arm, same model and caching: $6.81 to $1.13 (-83%), tokens through the model 5.3M to 1.4M, 10/10 tasks vs 9/10 for the baseline.
- SWE-Bench Pro (independent, The Context Lab): codebase context lifted coding-agent task success from 51.9% to 70.1% (~+35%), and cut token cost per task ~47% (up to ~68% on individual tasks), reasoning steps ~60%, and tool calls ~49%.
Production results for AI Architect (context engine and review, not Governor benchmarks).
- PubMatic: across 500+ repos / 450 engineers over an 8-week controlled evaluation, technical design per large epic went from a 2-week estimate to 3 days; indexed repos grew merge volume +48% (control +4%) and shipped 2x the work with no rise in reverts or incidents.
- Privado shipped an enterprise SSO project in 5 hours against a 7-10 day estimate.
- Design & scoping: collapses ~60-70% of an architect's week into a single session; code review: teams report saving ~30-35% of human review hours each week, many reviews dropping from ~an hour to 10-20 minutes.
Modeled numbers (ROI tables, spend estimates) are assumptions until the instrumented A/B on the customer's own tasks replaces them. Keep MEASURED, MODELED and CUSTOMER ASSUMPTIONS visibly distinct; never present a modeled figure as a customer's known spend.
Enterprise: no code stored or used to train models; deploy on-prem or in Bito cloud; SOC 2 Type II, end-to-end encrypted.`;

const ICP = `Who Bito sells to (ICP)
- Software-heavy companies with large, complex, multi-repo codebases (polyrepo/monorepo, aging or fast-growing) — including non-software companies with large software organizations (retail, auto, industrial, banks).
- 50-500 engineers is the sweet spot; large orgs with sprawling code qualify too.
- Teams already running coding agents and AI coding tools (Claude Code, Cursor, Copilot) at scale, where agent token spend is material and where context-blind output shows up as rework, wasted turns and inconsistent model usage.
- High PR throughput and cross-repo / architectural complexity, where the cost of an agent rediscovering the system on every task is highest.

How Bito wins
- Governor manages both multipliers of the agent bill (token count and price per token) from the one stable place between harnesses and models, while IDE assistants and gateways address at most one.
- The context lever is grounded in the org's ACTUAL codebase across repos; the routing lever gives engineering leadership one policy over which models do which work.
- Plays alongside existing tools (Claude Code, Cursor, Copilot, existing gateways) rather than displacing them.

Common buyers and champions
- VP Eng / CTO sign the deal; the unlock is lower cost per successful task, faster agent tasks, and governance over model usage as adoption scales.
- Head of Platform / DevEx / Developer Productivity, and increasingly Head of AI Platform / AI Enablement, is the usual champion — they own the harnesses, the gateway and the tooling bill.
- Engineering FinOps / cloud-cost owners care about the token bill and price per token.
- Staff / Principal / Architect-level engineers feel the pain most (cross-repo context-switching, steering agents back on course, reviewing AI-generated code, guarding architecture).
- Security teams care about vulns and standards slipping through AI-generated PRs.
- For PLG bottoms-up, individual engineers point a harness at Governor or connect the context layer / IDE / CLI first.

Buying motions to consider per account
- PLG: point one harness at Governor (or connect the IDE plugin) → team adopts → expand across teams and repos.
- Top-down: CTO/VPE pitch around cost per successful task, task time, and model governance at scale.
- Champion-led: find a staff/architect engineer or platform lead steering agents through cross-repo work, and arm them.
- Land-and-expand: instrumented A/B on one team's real tasks, then expand across the org.`;

/** Product context with the requested product leading. Governor is the
 *  default for every prospecting prompt; AI Architect leads only for work
 *  explicitly scoped to it (e.g. the AI Architect POC plan). */
export function bitoContextFor(product: BitoProduct): string {
  const lead = product === "ai_architect" ? [AI_ARCHITECT, GOVERNOR] : [GOVERNOR, AI_ARCHITECT];
  return [PORTFOLIO, ...lead, PROOF, ICP].join("\n\n");
}

export const BITO_CONTEXT = bitoContextFor("governor");
