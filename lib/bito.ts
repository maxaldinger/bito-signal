// Canonical Bito product context, shared by every API route's system prompt.
//
// This is the only place we put "Bito facts" so the model never invents
// product claims. Everything else (companies, signals, intel) is sourced
// live from web_search.

export const BITO_CONTEXT = `Bito is an AI-powered code review platform for engineering teams.

What Bito does
- AI Code Review Agent: deep, multi-file PR reviews that catch logic bugs, security issues, regressions, code style and architecture concerns — beyond what a linter or basic AI assistant catches.
- IDE plugins (VS Code, JetBrains, Cursor, Windsurf) and a review CLI (bitoreview, powered by the Bito Wingman engine) for real-time code review feedback while coding, grounded in the team's own codebase.
- Codebase-aware understanding via symbol indexing, AST parsing, and embeddings — answers and reviews are grounded in the team's specific code, not generic LLM knowledge.
- Integrates with GitHub, GitLab, Bitbucket. SOC 2 Type 2 compliant. Self-hosted and cloud options.

Who Bito sells to (ICP)
- SWE-heavy companies with large, complex codebases.
- 50-500 software engineers is the sweet spot.
- Codebases that are aging, polyrepo, monorepo, or rapidly growing.
- Engineering teams already paying for AI tooling (Copilot, Cursor, Cody) and feeling the per-seat cost — Bito is positioned as a force-multiplier on reviewer capacity, not a replacement IDE assistant.
- High PR throughput where review is a bottleneck.

How Bito wins
- More thorough than Copilot-class IDE assistants — Bito reviews entire PRs across files with codebase context.
- Cheaper and more focused than human reviewer time on the long tail of PRs.
- Better signal-to-noise than open-source PR bots (e.g. SonarQube, basic AI bots) because of codebase grounding.
- Plays alongside existing tools (Copilot, Cursor) rather than displacing them.

Common buyers and champions
- VP Eng / CTO sign the deal; cost of senior engineer review time is the budget unlock.
- Head of Platform / DevEx is the usual champion — they own developer velocity.
- Staff / Principal engineers feel the pain most acutely (review fatigue).
- Security teams care about catching vulns missed in human review.
- For PLG bottoms-up, individual senior engineers adopt the CLI/IDE first.

Buying motions to consider per account
- PLG: free CLI / IDE plugin → team picks it up → expand to PR review.
- Top-down: CTO/VPE pitch around reviewer-hours saved + security posture.
- Champion-led: identify a staff engineer who feels review pain, arm them.
- Land-and-expand: pilot on one team / one repo, then expand across the org.`;
