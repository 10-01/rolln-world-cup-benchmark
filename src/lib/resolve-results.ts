import fs from "node:fs";
import path from "node:path";
import { createClient, RedisClientType } from "redis";
import { ResultRow, resultFromScore, teamKey } from "./bench";

const API_BASE = "https://v3.football.api-sports.io";

// --- Snapshot storage abstraction ---
// Supports:
//   - Direct Redis via REDIS_URL (redis://... connection string) — recommended for the URL you provided
//   - Fallback to Vercel KV / Upstash REST (KV_REST_API_URL + KV_REST_API_TOKEN)
// The resolver prefers a recent snapshot to avoid hitting the football API on every request.
type SnapshotStore = {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
};

let snapshotStore: SnapshotStore | null = null;
let redisClient: RedisClientType | null = null;

async function getSnapshotStore(): Promise<SnapshotStore | null> {
  if (snapshotStore) return snapshotStore;

  const redisUrl =
    process.env.REDIS_URL ||
    process.env.UPSTASH_REDIS_URL ||
    process.env.KV_URL ||
    process.env.REDIS_CONNECTION_URL;

  const kvRestUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (redisUrl) {
    // Direct Redis (the redis:// URL you provided)
    if (!redisClient) {
      redisClient = createClient({ url: redisUrl });
      redisClient.on("error", (err) => {
        console.error("[redis] Snapshot client error:", err);
      });
      try {
        await redisClient.connect();
      } catch (err) {
        console.error("[redis] Failed to connect to Redis for snapshots:", err);
        redisClient = null;
        return null;
      }
    }

    snapshotStore = {
      async get<T>(key: string): Promise<T | null> {
        try {
          const val = await redisClient!.get(key);
          return val ? (JSON.parse(val) as T) : null;
        } catch {
          return null;
        }
      },
      async set(key: string, value: unknown, ttlSeconds?: number) {
        try {
          const str = JSON.stringify(value);
          if (ttlSeconds && ttlSeconds > 0) {
            await redisClient!.set(key, str, { EX: ttlSeconds });
          } else {
            await redisClient!.set(key, str);
          }
        } catch (err) {
          console.error("[redis] Failed to set snapshot:", err);
        }
      },
    };
    return snapshotStore;
  }

  if (kvRestUrl && kvToken) {
    // Legacy Vercel KV / Upstash REST style
    snapshotStore = {
      async get<T>(key: string): Promise<T | null> {
        try {
          const res = await fetch(`${kvRestUrl}/get/${encodeURIComponent(key)}`, {
            headers: { Authorization: `Bearer ${kvToken}` },
            cache: "no-store",
          });
          if (!res.ok) return null;
          const json = await res.json();
          return (json?.result ?? null) as T | null;
        } catch {
          return null;
        }
      },
      async set(key: string, value: unknown, ttlSeconds?: number) {
        try {
          const payload: any = { value };
          if (ttlSeconds) payload.ex = ttlSeconds;
          await fetch(`${kvRestUrl}/set/${encodeURIComponent(key)}`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${kvToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          });
        } catch {
          // best effort
        }
      },
    };
    return snapshotStore;
  }

  return null;
}

async function kvGet<T>(key: string): Promise<T | null> {
  const store = await getSnapshotStore();
  if (!store) return null;
  return store.get<T>(key);
}

async function kvSet(key: string, value: unknown, ttlSeconds?: number) {
  const store = await getSnapshotStore();
  if (!store) return;
  await store.set(key, value, ttlSeconds);
}

const SNAPSHOT_KEY = "wc2026:results:latest";

// --- types for internal use ---
type MatchRecord = {
  matchId: string;
  phase: string;
  round: string;
  group: string;
  teamA: string;
  teamB: string;
  kickoffUtc?: string;
};

type RawCsvRow = Record<string, string>;

// --- helpers (centralized; previously duplicated in script + route) ---
function pairKey(teamA: string, teamB: string) {
  return [teamKey(teamA), teamKey(teamB)].sort().join("|");
}

function normalizeRound(value: string) {
  const raw = (value ?? "").trim();
  if (/third/i.test(raw)) return "Third-place match";
  if (/quarter/i.test(raw)) return "Quarter-final";
  if (/semi/i.test(raw)) return "Semi-final";
  if (/round of 32|1\/16/i.test(raw)) return "Round of 32";
  if (/round of 16|1\/8/i.test(raw)) return "Round of 16";
  if (/final/i.test(raw)) return "Final";
  if (/group/i.test(raw)) return "Group stage";
  return raw;
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

// Minimal CSV parser (good enough for our controlled results.csv)
function parseCsv(text: string): RawCsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.replace(/^\uFEFF/, ""));
  return rows.slice(1).filter((vals) => vals.some((v) => v !== "")).map((vals) => {
    const rec: RawCsvRow = {};
    headers.forEach((h, idx) => {
      rec[h] = vals[idx] ?? "";
    });
    return rec;
  });
}

function toAppResult(row: RawCsvRow): ResultRow {
  const homeScore = row.home_score === "" || row.home_score == null ? null : Number(row.home_score);
  const awayScore = row.away_score === "" || row.away_score == null ? null : Number(row.away_score);
  const result = (row.result as ResultRow["result"]) || (homeScore != null && awayScore != null ? resultFromScore(homeScore, awayScore) : "");
  const winner = row.winner || (result === "H" ? row.team_a : result === "A" ? row.team_b : "");
  return {
    matchId: row.match_id,
    status: row.status || "scheduled",
    teamA: row.team_a,
    teamB: row.team_b,
    homeScore: Number.isFinite(homeScore as number) ? (homeScore as number) : null,
    awayScore: Number.isFinite(awayScore as number) ? (awayScore as number) : null,
    result: (result || "") as ResultRow["result"],
    winner,
    apiFixtureId: row.api_fixture_id || "",
    source: row.source || "results.csv",
    updatedAt: row.updated_at || "",
  };
}

function loadMatchesForIndex(): MatchRecord[] {
  const matchesPath = path.join(process.cwd(), "public", "data", "matches.json");
  try {
    return JSON.parse(fs.readFileSync(matchesPath, "utf8")) as MatchRecord[];
  } catch {
    return [];
  }
}

export function loadBaseResults(): ResultRow[] {
  const csvPath = path.join(process.cwd(), "public", "data", "results.csv");
  if (!fs.existsSync(csvPath)) {
    // Fallback: synthesize scheduled rows from matches.json
    const matches = loadMatchesForIndex();
    const now = new Date().toISOString();
    return matches.map((m) => ({
      matchId: m.matchId,
      status: "scheduled",
      teamA: m.teamA,
      teamB: m.teamB,
      homeScore: null,
      awayScore: null,
      result: "" as ResultRow["result"],
      winner: "",
      apiFixtureId: "",
      source: "matches.json",
      updatedAt: now,
    }));
  }
  const text = fs.readFileSync(csvPath, "utf8");
  const raw = parseCsv(text);
  return raw
    .filter((r) => r.match_id && r.team_a && r.team_b)
    .map(toAppResult);
}

// --- live fixtures fetch (with Next.js fetch caching) ---
export async function fetchLiveFixtures(): Promise<{ fixtures: any[]; error?: string }> {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) {
    return { fixtures: [], error: "API_FOOTBALL_KEY is not configured." };
  }
  const league = process.env.API_FOOTBALL_LEAGUE_ID || "1";
  const season = process.env.API_FOOTBALL_SEASON || "2026";

  try {
    const response = await fetch(
      `${API_BASE}/fixtures?league=${encodeURIComponent(league)}&season=${encodeURIComponent(season)}`,
      {
        headers: { "x-apisports-key": key },
        // Cache the raw fixture list for a short time at the edge / data cache layer.
        // Individual route responses can still decide freshness.
        next: { revalidate: 120 },
      }
    );
    if (!response.ok) {
      return { fixtures: [], error: `API-Football returned ${response.status}.` };
    }
    const payload = await response.json();
    return { fixtures: payload.response ?? [] };
  } catch (e: any) {
    return { fixtures: [], error: e?.message || "Failed to fetch live fixtures." };
  }
}

// Apply live fixture data on top of base rows. Returns a new full list.
export function applyLiveFixtures(base: ResultRow[], fixtures: any[]): ResultRow[] {
  if (!fixtures.length) return base;

  const matches = loadMatchesForIndex();
  const indexes = buildIndexes(matches);

  const now = new Date().toISOString();
  const byId = new Map(base.map((r) => [r.matchId, { ...r }]));

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

    // Handle API returning sides swapped vs our canonical teamA/teamB
    if (hasScore && teamKey(fixtureHome) === teamKey(match.teamB) && teamKey(fixtureAway) === teamKey(match.teamA)) {
      scoreA = fixtureAwayGoals;
      scoreB = fixtureHomeGoals;
    }

    const result: ResultRow["result"] =
      ["FT", "AET", "PEN"].includes(status) && hasScore ? resultFromScore(scoreA, scoreB) : "";

    const winner = result === "H" ? match.teamA : result === "A" ? match.teamB : "";

    const baseRow = byId.get(match.matchId) as any;
    const updated: ResultRow & {
      phase?: string;
      round?: string;
      group?: string;
      kickoffUtc?: string;
    } = {
      // Start from base (preserves any extra like kickoff if present on the row)
      ...baseRow,
      // Live overrides (these are the important resolved fields)
      matchId: match.matchId,
      status,
      teamA: match.teamA,
      teamB: match.teamB,
      homeScore: scoreA,
      awayScore: scoreB,
      result,
      winner,
      apiFixtureId: String(fixture?.fixture?.id ?? ""),
      source: "api-football",
      updatedAt: now,
    };

    byId.set(match.matchId, updated as ResultRow);
  }

  return Array.from(byId.values());
}

// --- public API ---

export type ResolvedResults = {
  results: ResultRow[];
  updatedAt: string;
  source: "snapshot" | "live" | "static" | "merged";
  error?: string;
  snapshotAt?: string;
};

const SNAPSHOT_MAX_AGE_MS = 1000 * 60 * 8; // 8 minutes — prefer snapshot to avoid hammering the football API

export async function getResolvedResults(options?: { forceFresh?: boolean }): Promise<ResolvedResults> {
  const base = loadBaseResults();
  const now = new Date();

  // 1. Try durable snapshot first (unless forcing fresh)
  if (!options?.forceFresh) {
    const snap = await kvGet<{ results: ResultRow[]; updatedAt: string }>(SNAPSHOT_KEY);
    if (snap && snap.results?.length) {
      const snapTime = Date.parse(snap.updatedAt || "");
      if (Number.isFinite(snapTime) && now.getTime() - snapTime < SNAPSHOT_MAX_AGE_MS) {
        // Serve the persistent snapshot directly — no external API call
        return {
          results: snap.results,
          updatedAt: snap.updatedAt,
          source: "snapshot",
          snapshotAt: snap.updatedAt,
        };
      }
    }
  }

  // 2. Live resolve
  const { fixtures, error } = await fetchLiveFixtures();

  if (error || !fixtures.length) {
    // Fall back to base (committed results.csv or static)
    return {
      results: base,
      updatedAt: now.toISOString(),
      source: error ? "static" : "static",
      error,
    };
  }

  const merged = applyLiveFixtures(base, fixtures);
  const updatedAt = now.toISOString();

  return {
    results: merged,
    updatedAt,
    source: "live",
  };
}

// Called by cron (and optionally normal traffic) to persist the latest resolved view.
export async function persistSnapshot(): Promise<{ ok: boolean; updatedAt?: string; count?: number; error?: string }> {
  const resolved = await getResolvedResults({ forceFresh: true });
  if (resolved.error && !resolved.results.length) {
    return { ok: false, error: resolved.error };
  }
  const payload = {
    results: resolved.results,
    updatedAt: resolved.updatedAt,
  };
  await kvSet(SNAPSHOT_KEY, payload, 60 * 60 * 6); // 6h TTL safety (cron refreshes it)
  return { ok: true, updatedAt: resolved.updatedAt, count: resolved.results.length };
}
