import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const RESULTS_PATH = path.join(ROOT, "public", "data", "results.csv");
const MATCHES_PATH = path.join(ROOT, "public", "data", "matches.json");
const API_BASE = "https://v3.football.api-sports.io";

const TEAM_ALIASES = new Map(
  Object.entries({
    "bosnia & herzegovina": "bosnia and herzegovina",
    "czech republic": "czechia",
    czechia: "czechia",
    "korea republic": "south korea",
    "republic of korea": "south korea",
    "south korea": "south korea",
    "cape verde islands": "cape verde",
    "cape verde": "cape verde",
    curacao: "curacao",
    "curaçao": "curacao",
    turkey: "turkiye",
    turkiye: "turkiye",
    "türkiye": "turkiye",
    usa: "united states",
    "united states": "united states",
    "congo dr": "dr congo",
    "dr congo": "dr congo",
  }),
);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') inQuotes = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, ""));
  return rows.slice(1).filter((values) => values.some((value) => value !== "")).map((values) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = values[index] ?? "";
    });
    return record;
  });
}

function escapeCsv(value) {
  if (value === null || value === undefined) return "";
  const stringValue = String(value);
  return /[",\n\r]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue;
}

function writeCsv(filePath, rows, headers) {
  const text = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(",")),
  ].join("\n");
  fs.writeFileSync(filePath, `${text}\n`);
}

function teamKey(value) {
  const raw = (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return TEAM_ALIASES.get(raw) ?? raw;
}

function pairKey(teamA, teamB) {
  return [teamKey(teamA), teamKey(teamB)].sort().join("|");
}

function resultFromScore(home, away) {
  if (home > away) return "H";
  if (home < away) return "A";
  return "D";
}

function normalizeRound(value) {
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

function formatApiFootballErrors(errors) {
  if (!errors) return "";
  if (typeof errors === "string") return errors.trim();
  if (Array.isArray(errors)) return errors.filter(Boolean).join("; ");
  if (typeof errors === "object") {
    return Object.entries(errors)
      .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
      .join("; ");
  }
  return String(errors);
}

function buildIndexes(matches) {
  const byGroupPair = new Map();
  const byRoundPair = new Map();
  const byRoundKickoff = new Map();
  for (const match of matches) {
    if (match.round === "Group stage") {
      byGroupPair.set(`${match.group}|${pairKey(match.teamA, match.teamB)}`, match);
    }
    byRoundPair.set(`${match.round}|${pairKey(match.teamA, match.teamB)}`, match);
    const kickoff = match.kickoffUtc ? Date.parse(match.kickoffUtc) : NaN;
    if (Number.isFinite(kickoff)) {
      if (!byRoundKickoff.has(match.round)) byRoundKickoff.set(match.round, []);
      byRoundKickoff.get(match.round).push({ match, kickoff });
    }
  }
  return { byGroupPair, byRoundPair, byRoundKickoff };
}

// Knockout slots carry a hypothetical benchmark bracket, so the real fixture's
// teams usually won't pair-match. The kickoff schedule is fixed regardless of
// who advances, so fall back to round + nearest kickoff (within two hours).
function findKnockoutSlotByKickoff(indexes, round, fixtureDate, toleranceMs = 2 * 60 * 60 * 1000) {
  const at = Date.parse(fixtureDate ?? "");
  if (!Number.isFinite(at)) return undefined;
  let best;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const slot of indexes.byRoundKickoff.get(round) ?? []) {
    const delta = Math.abs(slot.kickoff - at);
    if (delta < bestDelta) {
      best = slot.match;
      bestDelta = delta;
    }
  }
  return bestDelta <= toleranceMs ? best : undefined;
}

function groupFromFixture(fixture) {
  const round = fixture?.league?.round ?? "";
  const match = round.match(/Group\s+([A-L])/i);
  return match ? match[1].toUpperCase() : "";
}

function mapFixtureToMatch(fixture, indexes) {
  const round = normalizeRound(fixture?.league?.round ?? "");
  const group = groupFromFixture(fixture);
  const home = fixture?.teams?.home?.name ?? "";
  const away = fixture?.teams?.away?.name ?? "";
  if (round === "Group stage") {
    return indexes.byGroupPair.get(`${group}|${pairKey(home, away)}`);
  }
  const pairMatch = indexes.byRoundPair.get(`${round}|${pairKey(home, away)}`);
  return pairMatch ?? findKnockoutSlotByKickoff(indexes, round, fixture?.fixture?.date);
}

async function fetchApiFootballFixtures() {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error("API_FOOTBALL_KEY is not set.");
  const league = process.env.API_FOOTBALL_LEAGUE_ID || "1";
  const season = process.env.API_FOOTBALL_SEASON || "2026";
  const url = `${API_BASE}/fixtures?league=${encodeURIComponent(league)}&season=${encodeURIComponent(season)}`;
  const response = await fetch(url, {
    headers: {
      "x-apisports-key": key,
    },
  });
  if (!response.ok) {
    throw new Error(`API-Football request failed: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  const apiErrors = formatApiFootballErrors(payload.errors);
  if (apiErrors) {
    throw new Error(`API-Football returned an error: ${apiErrors}`);
  }
  if (!Array.isArray(payload.response)) {
    throw new Error("API-Football response did not include a fixture list.");
  }
  if (payload.response.length === 0) {
    throw new Error(`API-Football returned 0 fixtures for league=${league} season=${season}.`);
  }
  return payload.response;
}

async function main() {
  if (!fs.existsSync(MATCHES_PATH) || !fs.existsSync(RESULTS_PATH)) {
    throw new Error("Run npm run prepare-data before fetching results.");
  }

  const matches = JSON.parse(fs.readFileSync(MATCHES_PATH, "utf8"));
  const existing = parseCsv(fs.readFileSync(RESULTS_PATH, "utf8"));
  const byId = new Map(existing.map((row) => [row.match_id, row]));
  const indexes = buildIndexes(matches);
  const fixtures = await fetchApiFootballFixtures();
  const now = new Date().toISOString();
  let updated = 0;
  let finals = 0;
  let unmatchedFinals = 0;

  for (const fixture of fixtures) {
    const status = fixture?.fixture?.status?.short ?? "";
    const isFinal = ["FT", "AET", "PEN"].includes(status);
    if (!isFinal) continue;
    finals += 1;

    const match = mapFixtureToMatch(fixture, indexes);
    if (!match) {
      unmatchedFinals += 1;
      continue;
    }

    const row = byId.get(match.matchId);
    if (!row) continue;

    const fixtureHome = fixture?.teams?.home?.name ?? "";
    const fixtureAway = fixture?.teams?.away?.name ?? "";
    const homeGoals = fixture?.goals?.home;
    const awayGoals = fixture?.goals?.away;
    if (typeof homeGoals !== "number" || typeof awayGoals !== "number") continue;

    let scoreA = homeGoals;
    let scoreB = awayGoals;
    const pairKeyMatches = pairKey(fixtureHome, fixtureAway) === pairKey(match.teamA, match.teamB);
    if (pairKeyMatches && teamKey(fixtureHome) === teamKey(match.teamB) && teamKey(fixtureAway) === teamKey(match.teamA)) {
      scoreA = awayGoals;
      scoreB = homeGoals;
    }
    if (!pairKeyMatches) {
      // Reality diverged from the benchmark's hypothetical knockout bracket —
      // record the real fixture's teams so scoring compares against them.
      row.team_a = fixtureHome;
      row.team_b = fixtureAway;
    }
    const result = resultFromScore(scoreA, scoreB);

    row.kickoff_utc = fixture?.fixture?.date ?? row.kickoff_utc;
    row.status = status;
    row.home_score = String(scoreA);
    row.away_score = String(scoreB);
    row.result = result;
    row.winner = result === "H" ? row.team_a : result === "A" ? row.team_b : "";
    row.api_fixture_id = String(fixture?.fixture?.id ?? row.api_fixture_id ?? "");
    row.source = "api-football";
    row.updated_at = now;
    updated += 1;
  }

  const headers = [
    "match_id",
    "phase",
    "round",
    "group",
    "team_a",
    "team_b",
    "kickoff_utc",
    "status",
    "home_score",
    "away_score",
    "result",
    "winner",
    "api_fixture_id",
    "source",
    "updated_at",
  ];
  writeCsv(RESULTS_PATH, existing, headers);
  console.log(
    `Fetched ${fixtures.length} fixtures from API-Football; ${finals} final, ${updated} matched and updated, ${unmatchedFinals} unmatched.`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
