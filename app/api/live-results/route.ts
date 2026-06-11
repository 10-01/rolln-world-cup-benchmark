import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { resultFromScore, teamKey } from "../../../src/lib/bench";

export const dynamic = "force-dynamic";

const API_BASE = "https://v3.football.api-sports.io";

type MatchRecord = {
  matchId: string;
  phase: string;
  round: string;
  group: string;
  teamA: string;
  teamB: string;
};

type ResultRecord = {
  matchId: string;
  phase: string;
  round: string;
  group: string;
  teamA: string;
  teamB: string;
  kickoffUtc: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  result: string;
  winner: string;
  apiFixtureId: string;
  source: string;
  updatedAt: string;
};

function pairKey(teamA: string, teamB: string) {
  return [teamKey(teamA), teamKey(teamB)].sort().join("|");
}

function normalizeRound(value: string) {
  if (/third/i.test(value)) return "Third-place match";
  if (/quarter/i.test(value)) return "Quarter-final";
  if (/semi/i.test(value)) return "Semi-final";
  if (/round of 32|1\/16/i.test(value)) return "Round of 32";
  if (/round of 16|1\/8/i.test(value)) return "Round of 16";
  if (/final/i.test(value)) return "Final";
  if (/group/i.test(value)) return "Group stage";
  return value;
}

function groupFromRound(value: string) {
  return value.match(/Group\s+([A-L])/i)?.[1]?.toUpperCase() ?? "";
}

function buildIndexes(matches: MatchRecord[]) {
  const byGroupPair = new Map<string, MatchRecord>();
  const byRoundPair = new Map<string, MatchRecord>();
  for (const match of matches) {
    if (match.round === "Group stage") {
      byGroupPair.set(`${match.group}|${pairKey(match.teamA, match.teamB)}`, match);
    }
    byRoundPair.set(`${match.round}|${pairKey(match.teamA, match.teamB)}`, match);
  }
  return { byGroupPair, byRoundPair };
}

async function fetchFixtures() {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) {
    return { error: "API_FOOTBALL_KEY is not configured.", fixtures: [] as any[] };
  }

  const league = process.env.API_FOOTBALL_LEAGUE_ID || "1";
  const season = process.env.API_FOOTBALL_SEASON || "2026";
  const response = await fetch(`${API_BASE}/fixtures?league=${encodeURIComponent(league)}&season=${encodeURIComponent(season)}`, {
    headers: {
      "x-apisports-key": key,
    },
    next: { revalidate: 900 },
  });

  if (!response.ok) {
    return { error: `API-Football returned ${response.status}.`, fixtures: [] as any[] };
  }

  const payload = await response.json();
  return { error: "", fixtures: payload.response ?? [] };
}

export async function GET() {
  const matchesPath = path.join(process.cwd(), "public", "data", "matches.json");
  const matches = JSON.parse(fs.readFileSync(matchesPath, "utf8")) as MatchRecord[];
  const indexes = buildIndexes(matches);
  const { error, fixtures } = await fetchFixtures();

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        error,
        results: [],
      },
      { status: 200 },
    );
  }

  const now = new Date().toISOString();
  const results: ResultRecord[] = [];

  for (const fixture of fixtures) {
    const fixtureRound = fixture?.league?.round ?? "";
    const round = normalizeRound(fixtureRound);
    const group = groupFromRound(fixtureRound);
    const fixtureHome = fixture?.teams?.home?.name ?? "";
    const fixtureAway = fixture?.teams?.away?.name ?? "";
    const match =
      round === "Group stage"
        ? indexes.byGroupPair.get(`${group}|${pairKey(fixtureHome, fixtureAway)}`)
        : indexes.byRoundPair.get(`${round}|${pairKey(fixtureHome, fixtureAway)}`);
    if (!match) continue;

    const fixtureHomeGoals = fixture?.goals?.home;
    const fixtureAwayGoals = fixture?.goals?.away;
    const status = fixture?.fixture?.status?.short ?? "scheduled";
    const hasScore = typeof fixtureHomeGoals === "number" && typeof fixtureAwayGoals === "number";
    let scoreA: number | null = hasScore ? fixtureHomeGoals : null;
    let scoreB: number | null = hasScore ? fixtureAwayGoals : null;
    if (hasScore && teamKey(fixtureHome) === teamKey(match.teamB) && teamKey(fixtureAway) === teamKey(match.teamA)) {
      scoreA = fixtureAwayGoals;
      scoreB = fixtureHomeGoals;
    }
    const result = ["FT", "AET", "PEN"].includes(status) && hasScore ? resultFromScore(scoreA, scoreB) : "";
    const winner = result === "H" ? match.teamA : result === "A" ? match.teamB : "";

    results.push({
      matchId: match.matchId,
      phase: match.phase,
      round: match.round,
      group: match.group,
      teamA: match.teamA,
      teamB: match.teamB,
      kickoffUtc: fixture?.fixture?.date ?? "",
      status,
      homeScore: scoreA,
      awayScore: scoreB,
      result,
      winner,
      apiFixtureId: String(fixture?.fixture?.id ?? ""),
      source: "api-football",
      updatedAt: now,
    });
  }

  return NextResponse.json(
    {
      ok: true,
      results,
      source: "api-football",
      updatedAt: now,
    },
    {
      headers: {
        "Cache-Control": "s-maxage=900, stale-while-revalidate=3600",
      },
    },
  );
}
