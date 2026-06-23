// Canonical Bito product context, shared by every API route's system prompt.
//
// This is the only place we put "Bito facts" so the model never invents
// product claims. Everything else (companies, signals, intel) is sourced
// live from web_search.

export const BITO_CONTEXT = `Bito AI Architect is "the context layer" for AI-assisted software development. It pre-indexes an organization's entire codebase — across repos — and grounds AI coding agents, IDEs, and reviews in that real architectural context (served over MCP), so their output reflects the team's actual system instead of generic LLM guesses. Code review is one capability, not the whole product.

What Bito AI Architect does
- The Context Layer (the core): a pre-indexed, cross-repo knowledge graph of the org's code — architecture, dependencies, API contracts, tech stacks, coding patterns/standards, and business rules — exposed to any AI coding tool (Cursor, GitHub Copilot, Claude Code, Windsurf, etc.) via MCP so their generated code is grounded in the team's real codebase.
- Grounded code generation: AI agents write code that fits the existing architecture, conventions, and cross-repo contracts, cutting hallucinated/throwaway output and rework.
- AI Code Reviews: deep, multi-file, codebase-aware PR reviews that catch logic bugs, security issues, regressions, and architecture/standards violations (symbol indexing, AST parsing, embeddings) — beyond what a linter or basic AI assistant catches.
- Design & scoping: analyzes issues/tickets against the real codebase (blast radius, affected services, effort) so work is planned with architectural context before code is written.
- Standards & patterns: governs and enforces the org's conventions and architectural patterns consistently across teams and repos.
- Integrates with GitHub, GitLab, Bitbucket; IDE plugins (VS Code, JetBrains, Cursor, Windsurf) and a CLI. SOC 2 Type 2. Self-hosted and cloud options.

The value (Bito frames impact across three lines)
- Build speed: agents and engineers ship faster when grounded in real context instead of reverse-engineering the codebase.
- AI / token cost: less wasted generation and rework — a force-multiplier on existing AI-tooling spend (Copilot, Cursor, Cody), not a replacement.
- Onboarding: new engineers (and AI agents) get the architecture handed to them instead of spelunking for it.

Proof points (PUBLISHED, from bito.ai / SWE-Bench Pro — cite as real, never inflate)
- Coding (SWE-Bench Pro): codebase context lifted coding-agent task success from 51.9% to 70.1% (~+35%), and cut token cost per task ~47%, reasoning steps ~60%, and tool calls ~49%. AI Architect tops SWE-Bench Pro.
- Design & scoping: collapses ~60-70% of an architect's week into a single session; "days to hours" to decide what to build.
- Code review: teams report saving ~30-35% of human hours spent on code review each week; many reviews drop from ~an hour to 10-20 minutes.
- PubMatic (in production): across 500+ repos / 450 engineers over an 8-week controlled evaluation, technical design per large epic went from a 2-week estimate to 3 days; indexed repos grew merge volume +48% (control +4%) and shipped 2x the work with no rise in reverts or incidents.
- Enterprise: no code stored or used to train models; deploy on-prem or in Bito cloud; SOC 2 Type II, end-to-end encrypted.

Who Bito AI Architect sells to (ICP)
- Software-heavy companies with large, complex, multi-repo codebases (polyrepo/monorepo, aging or fast-growing).
- 50-500 engineers is the sweet spot; large orgs with sprawling code qualify too.
- Teams already adopting AI coding tools (Copilot, Cursor, Claude Code) and hitting the limits of context-blind, ungrounded output.
- High PR throughput and cross-repo / architectural complexity where missing context is the real bottleneck.

How Bito AI Architect wins
- Grounded in the org's ACTUAL codebase and architecture across repos, where IDE assistants and PR bots are context-blind.
- One context layer that makes every AI tool better via MCP, plus its own code review and design/scoping — not a single point feature.
- Plays alongside existing AI tools (Copilot, Cursor, Claude Code) rather than displacing them.

Common buyers and champions
- VP Eng / CTO sign the deal; the unlock is faster delivery, less AI-tooling waste, and architectural consistency at scale.
- Head of Platform / DevEx / Developer Productivity is the usual champion — they own velocity and tooling.
- Staff / Principal / Architect-level engineers feel the pain most (cross-repo context-switching, reviewing AI-generated code, guarding architecture).
- Security teams care about vulns and standards slipping through AI-generated PRs.
- For PLG bottoms-up, individual engineers connect the context layer / IDE / CLI first.

Buying motions to consider per account
- PLG: connect the context layer / IDE plugin → team adopts → expand across repos.
- Top-down: CTO/VPE pitch around delivery speed, AI-tooling ROI, and architectural governance.
- Champion-led: find a staff/architect engineer drowning in cross-repo context or reviewing AI code, and arm them.
- Land-and-expand: pilot on one team / one repo, then expand the context layer across the org.`;
