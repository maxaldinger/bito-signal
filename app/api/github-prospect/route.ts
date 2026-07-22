// GET /api/github-prospect — dashboard read: the repo watchlist, all prospects
// (contribution-weighted first), and the raw-signal total for the metric row.

import { NextResponse } from "next/server";
import {
  countGitHubSignals,
  fetchMonitoredRepos,
  fetchProspects,
} from "@/lib/githubProspect/store";

export const maxDuration = 30;

export async function GET() {
  try {
    const [repos, prospects, totalSignals] = await Promise.all([
      fetchMonitoredRepos(),
      fetchProspects(),
      countGitHubSignals(),
    ]);
    const configured = repos.configured && prospects.configured;
    const ok = repos.ok && prospects.ok;
    return NextResponse.json(
      {
        configured,
        ok,
        error: repos.error ?? prospects.error,
        repos: repos.repos,
        prospects: prospects.prospects,
        totalSignals,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error reading GitHub prospects.";
    return NextResponse.json(
      { configured: true, ok: false, error: message, repos: [], prospects: [], totalSignals: 0 },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
