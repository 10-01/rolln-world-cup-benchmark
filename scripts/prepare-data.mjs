import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PUBLIC_DATA_DIR = path.join(ROOT, "public", "data");
const PUBLIC_RAW_DIR = path.join(PUBLIC_DATA_DIR, "raw");
const PREDICTIONS_DIR = path.join(ROOT, "predictions");

const MODEL_DEFS = [
  {
    key: "fable-5-high",
    name: "Fable 5",
    effort: "high effort",
    label: "Fable 5 (high effort)",
    sourceFile: "predictions/fable_wc2026_predictions.csv",
    sourceHints: ["fable", "claude fable"],
  },
  {
    key: "gemini-3-1-pro-medium",
    name: "Gemini 3.1 Pro",
    effort: "medium",
    label: "Gemini 3.1 Pro (medium)",
    sourceFile: "predictions/world_cup_2026_predictions_gemini.csv",
    sourceHints: ["gemini"],
  },
  {
    key: "gpt-5-5-xhigh",
    name: "gpt-5.5",
    effort: "xhigh",
    label: "gpt-5.5 (xhigh)",
    sourceFile: "predictions/wc2026_predictions_gpt.csv",
    sourceHints: ["gpt", "gpt-5"],
  },
  {
    key: "grok-build-0-1",
    name: "grok-build-0.1",
    effort: "",
    label: "grok-build-0.1",
    sourceFile: "predictions/world_cup_2026_predictions_grok.csv",
    sourceHints: ["grok", "xai"],
  },
  {
    key: "composer-2-5-high",
    name: "Composer 2.5",
    effort: "high",
    label: "Composer 2.5 (high)",
    sourceFile: "predictions/wc2026_predictions_composer.csv",
    sourceHints: ["composer"],
  },
];

const ROUND_ORDER = {
  "Group stage": 1,
  "Round of 32": 2,
  "Round of 16": 3,
  "Quarter-final": 4,
  "Semi-final": 5,
  "Third-place match": 6,
  Final: 7,
};

function parseGroupMatchNumber(matchId) {
  const match = String(matchId).match(/^G([A-L])(\d+)$/i);
  if (!match) return null;
  return {
    groupIndex: match[1].toUpperCase().charCodeAt(0) - 64,
    matchNumber: Number(match[2]),
  };
}

function computePlayOrder(match) {
  if (match.kickoffUtc) {
    const kickoff = Date.parse(match.kickoffUtc);
    if (Number.isFinite(kickoff)) return kickoff;
  }

  const roundBase = (ROUND_ORDER[match.round] ?? 99) * 1_000_000;
  const groupMatch = parseGroupMatchNumber(match.matchId);
  if (groupMatch) {
    const { groupIndex, matchNumber } = groupMatch;
    const matchday = Math.ceil(matchNumber / 2);
    const slot = (matchNumber - 1) % 2;
    return roundBase + matchday * 10_000 + slot * 1_000 + groupIndex * 10 + matchNumber;
  }

  const knockoutId = Number(match.matchId);
  if (Number.isFinite(knockoutId)) return roundBase + knockoutId;

  return roundBase;
}

const TEAM_ALIASES = new Map(
  Object.entries({
    "bosnia & herzegovina": "bosnia and herzegovina",
    "bosnia and herzegovina": "bosnia and herzegovina",
    "czech republic": "czechia",
    czechia: "czechia",
    curacao: "curacao",
    "curaçao": "curacao",
    "cote divoire": "ivory coast",
    "côte divoire": "ivory coast",
    "ivory coast": "ivory coast",
    "cape verde islands": "cape verde",
    "cape verde": "cape verde",
    "d r congo": "dr congo",
    "dr congo": "dr congo",
    "congo dr": "dr congo",
    turkey: "turkiye",
    turkiye: "turkiye",
    "türkiye": "turkiye",
    usa: "united states",
    "u s a": "united states",
    "united states": "united states",
  }),
);

const RUBRIC = {
  version: "2026-06-11",
  primaryScore: "Bench Points",
  perCompletedMatch: [
    {
      component: "Result or winner",
      points: "0 or 10",
      rule: "10 points when the model picked the actual W/D/L result for group-stage matches or the actual advancing/winning team for knockout matches.",
    },
    {
      component: "Confidence adjustment",
      points: "-5 to +5",
      rule: "Correct picks receive +5 x the confidence assigned to that pick. Wrong picks receive -5 x the confidence assigned to that pick. Missing confidence is neutral.",
    },
    {
      component: "Scoreline",
      points: "0 to 5",
      rule: "5 points for exact score. Otherwise 2 for exact goal differential, 1 for total goals within one, and 1 for the correct result implied by the score. Scoreline is graded only when the predicted matchup matches the actual fixture teams.",
    },
  ],
  secondaryMetrics: [
    "Accuracy: correct result or winner divided by completed predictions.",
    "Brier score: mean squared error over home/draw/away probabilities; lower is better.",
    "Log loss: negative log probability assigned to the actual result, clipped at 0.02; lower is better.",
    "Exact scores: count of exact scoreline hits among score-graded predictions.",
  ],
  confidencePolicy:
    "Full 1X2 distributions are used when present. Single-class likelihoods are preserved as the model's confidence and imputed into 1X2 probabilities only for Brier/log-loss visibility, with the remaining probability split between the other two outcomes.",
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

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
  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, ""));
  return rows.slice(1).filter((values) => values.some((value) => value !== "")).map((values) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = values[index] ?? "";
    });
    return record;
  });
}

function readCsv(relativePath) {
  return parseCsv(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function listPredictionCsvFiles() {
  if (!fs.existsSync(PREDICTIONS_DIR)) return [];
  return fs
    .readdirSync(PREDICTIONS_DIR)
    .filter((file) => file.endsWith(".csv") && !file.startsWith("."))
    .map((file) => `predictions/${file}`)
    .sort();
}

function resolveModelSources(models) {
  const files = listPredictionCsvFiles();
  const candidates = files.map((file) => {
    const rows = readCsv(file);
    const modelNames = Array.from(new Set(rows.map((row) => row.model_name || row.model || "").filter(Boolean))).join(" ");
    return {
      file,
      rows,
      text: `${path.basename(file)} ${modelNames}`.toLowerCase(),
    };
  });
  const used = new Set();

  return models.map((model) => {
    const hints = model.sourceHints || [model.name, model.key];
    const ranked = candidates
      .filter((candidate) => !used.has(candidate.file))
      .map((candidate) => {
        const score = hints.reduce((sum, hint) => {
          const cleanHint = String(hint).toLowerCase();
          return sum + (candidate.text.includes(cleanHint) ? 10 : 0);
        }, 0);
        return { ...candidate, score };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));

    const resolved = ranked[0]?.file || (fs.existsSync(path.join(ROOT, model.sourceFile)) ? model.sourceFile : "");
    if (resolved) used.add(resolved);
    return {
      ...model,
      sourceFile: resolved,
    };
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

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function percentToProbability(value) {
  if (!value) return null;
  const cleaned = String(value).replace("%", "").trim();
  const number = Number(cleaned);
  if (!Number.isFinite(number)) return null;
  return number > 1 ? number / 100 : number;
}

function normalizeRound(value) {
  const raw = (value ?? "").trim();
  if (/matchday/i.test(raw)) return "Group stage";
  if (/third/i.test(raw)) return "Third-place match";
  if (/quarter/i.test(raw)) return "Quarter-final";
  if (/semi/i.test(raw)) return "Semi-final";
  if (/round of 32/i.test(raw)) return "Round of 32";
  if (/round of 16/i.test(raw)) return "Round of 16";
  if (/final/i.test(raw)) return "Final";
  if (/group/i.test(raw)) return "Group stage";
  return raw;
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

function resultFromScore(scoreA, scoreB) {
  if (scoreA === null || scoreB === null) return "";
  if (scoreA > scoreB) return "H";
  if (scoreA < scoreB) return "A";
  return "D";
}

function splitFixture(value) {
  const parts = String(value ?? "").split(/\s+vs\.?\s+/i);
  if (parts.length !== 2) return ["", ""];
  return [parts[0].trim(), parts[1].trim()];
}

function parseScore(value) {
  const match = String(value ?? "").match(/(\d+)\s*[-:]\s*(\d+)/);
  if (!match) return [null, null];
  return [Number(match[1]), Number(match[2])];
}

function parseGroup(context) {
  const match = String(context ?? "").match(/Group\s+([A-L])/i);
  return match ? match[1].toUpperCase() : "";
}

function parseMatchNumber(value) {
  const match = String(value ?? "").match(/Match\s+(\d+)/i);
  return match ? match[1] : "";
}

function canonicalMatchId(value, group, round) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^G[A-L]\d+$/i.test(raw)) return raw.toUpperCase();
  if (/^[A-L]\d+$/i.test(raw) && normalizeRound(round) === "Group stage") return `G${raw.toUpperCase()}`;
  if (/^\d+$/.test(raw)) return raw;
  if (group && /^\d+$/.test(raw) && normalizeRound(round) === "Group stage") return `G${String(group).toUpperCase()}${raw}`;
  return raw;
}

function usableTeam(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^[A-L]\d+$/i.test(raw)) return "";
  if (/^G[A-L]\d+$/i.test(raw)) return "";
  if (/^[123][A-L]+$/i.test(raw)) return "";
  if (/^[WL]\d+$/i.test(raw)) return "";
  if (/^\d+$/.test(raw)) return "";
  if (/^(winner|loser)(\s+of)?\s+match\s+\d+$/i.test(raw)) return "";
  if (/^(winner|runner[-\s]?up|runners[-\s]?up)\s+group\s+[A-L]$/i.test(raw)) return "";
  if (/^group\s+[A-L]\s+(winner|runner[-\s]?up|runners[-\s]?up)$/i.test(raw)) return "";
  if (/^(3rd|third[-\s]?placed)\s+(team\s+)?(group|groups)/i.test(raw)) return "";
  return raw;
}

function rowSlotSideA(row) {
  return usableTeam(row.slot_team_a) || usableTeam(row.team_a) || usableTeam(row.home) || usableTeam(row.model_team_a);
}

function rowSlotSideB(row) {
  return usableTeam(row.slot_team_b) || usableTeam(row.team_b) || usableTeam(row.away) || usableTeam(row.model_team_b);
}

function rowModelSideA(row) {
  return usableTeam(row.model_team_a) || usableTeam(row.team_a) || usableTeam(row.home) || usableTeam(row.slot_team_a);
}

function rowModelSideB(row) {
  return usableTeam(row.model_team_b) || usableTeam(row.team_b) || usableTeam(row.away) || usableTeam(row.slot_team_b);
}

function displayNumber(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Number(Number(value).toFixed(digits));
}

function buildCanonicalMatches(models) {
  const resultsPath = path.join(PUBLIC_DATA_DIR, "results.csv");
  if (fs.existsSync(resultsPath)) {
    const resultRows = parseCsv(fs.readFileSync(resultsPath, "utf8")).filter((row) => row.match_id && row.team_a && row.team_b);
    if (resultRows.length >= 104) {
      return resultRows.map((row, index) => {
        const round = normalizeRound(row.round);
        const group = row.group || "";
        const roundOffset = ROUND_ORDER[round] ?? 99;
        const groupOffset = group ? group.charCodeAt(0) - 64 : 0;
        return {
          matchId: canonicalMatchId(row.match_id, group, round),
          phase: row.phase || (round === "Group stage" ? "Group stage" : "Knockout"),
          round,
          group,
          teamA: row.team_a,
          teamB: row.team_b,
          sortOrder: roundOffset * 1000 + groupOffset * 10 + index,
        };
      });
    }
  }

  const candidateSources = models
    .filter((model) => model.sourceFile)
    .map((model) => ({
      model,
      rows: readCsv(model.sourceFile).filter((row) => row.record_type === "match"),
    }))
    .filter((source) => source.rows.length >= 104)
    .sort((a, b) => {
      const aRealSlots = a.rows.filter((row) => rowSlotSideA(row) && rowSlotSideB(row)).length;
      const bRealSlots = b.rows.filter((row) => rowSlotSideA(row) && rowSlotSideB(row)).length;
      return bRealSlots - aRealSlots;
    });

  const sourceRows = candidateSources[0]?.rows || [];
  const seen = new Set();
  return sourceRows.filter((row) => {
    const matchId = canonicalMatchId(row.match_id, row.group, row.round || row.stage || row.phase);
    if (!matchId || seen.has(matchId)) return false;
    seen.add(matchId);
    return true;
  }).map((row, index) => {
    const round = normalizeRound(row.round || row.stage || row.phase);
    const group = row.group || "";
    const roundOffset = ROUND_ORDER[round] ?? 99;
    const groupOffset = group ? group.charCodeAt(0) - 64 : 0;
    return {
      matchId: canonicalMatchId(row.match_id, group, round),
      phase: row.phase || (round === "Group stage" ? "Group stage" : "Knockout"),
      round,
      group,
      teamA: rowSlotSideA(row),
      teamB: rowSlotSideB(row),
      sortOrder: roundOffset * 1000 + groupOffset * 10 + index,
    };
  });
}

function buildIndexes(matches) {
  const byId = new Map(matches.map((match) => [match.matchId, match]));
  const byGroupPair = new Map();
  const byRoundPair = new Map();
  const byRound = new Map();

  for (const match of matches) {
    if (match.round === "Group stage") {
      byGroupPair.set(`${match.group}|${pairKey(match.teamA, match.teamB)}`, match);
    }
    const roundKey = `${match.round}|${pairKey(match.teamA, match.teamB)}`;
    byRoundPair.set(roundKey, match);
    if (!byRound.has(match.round)) byRound.set(match.round, []);
    byRound.get(match.round).push(match);
  }

  for (const list of byRound.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  return { byId, byGroupPair, byRoundPair, byRound };
}

function findByTeams(indexes, round, group, teamA, teamB) {
  if (round === "Group stage") {
    return indexes.byGroupPair.get(`${group}|${pairKey(teamA, teamB)}`) || indexes.byRoundPair.get(`${round}|${pairKey(teamA, teamB)}`);
  }
  return indexes.byRoundPair.get(`${round}|${pairKey(teamA, teamB)}`);
}

function matchContainsTeams(match, teamA, teamB) {
  return Boolean(match && teamA && teamB && pairKey(match.teamA, match.teamB) === pairKey(teamA, teamB));
}

function alignProbabilities(match, sideA, sideB, pSideA, pDraw, pSideB) {
  if (!match || pSideA === null || pDraw === null || pSideB === null) {
    return { probabilityA: null, probabilityDraw: pDraw, probabilityB: null };
  }
  if (teamKey(sideA) === teamKey(match.teamA) && teamKey(sideB) === teamKey(match.teamB)) {
    return { probabilityA: pSideA, probabilityDraw: pDraw, probabilityB: pSideB };
  }
  if (teamKey(sideA) === teamKey(match.teamB) && teamKey(sideB) === teamKey(match.teamA)) {
    return { probabilityA: pSideB, probabilityDraw: pDraw, probabilityB: pSideA };
  }
  return { probabilityA: null, probabilityDraw: pDraw, probabilityB: null };
}

function orientSidesAndScore(match, sideA, sideB, scoreA, scoreB) {
  if (!matchContainsTeams(match, sideA, sideB)) {
    return {
      sideA,
      sideB,
      scoreA,
      scoreB,
    };
  }
  if (teamKey(sideA) === teamKey(match.teamB) && teamKey(sideB) === teamKey(match.teamA)) {
    return {
      sideA: match.teamA,
      sideB: match.teamB,
      scoreA: scoreB,
      scoreB: scoreA,
    };
  }
  return {
    sideA: match.teamA,
    sideB: match.teamB,
    scoreA,
    scoreB,
  };
}

function predictionOutcome(match, predictedWinner) {
  if (!predictedWinner) return "";
  if (/^draw$/i.test(predictedWinner)) return "D";
  if (teamKey(predictedWinner) === teamKey(match.teamA)) return "H";
  if (teamKey(predictedWinner) === teamKey(match.teamB)) return "A";
  return "O";
}

function winnerFromPredictedOutcome(match, value) {
  const outcome = String(value ?? "").trim().toLowerCase();
  if (outcome === "team_a_win" || outcome === "h" || outcome === "home") return match.teamA;
  if (outcome === "team_b_win" || outcome === "a" || outcome === "away") return match.teamB;
  if (outcome === "draw" || outcome === "d") return "Draw";
  return "";
}

function normalizeCore({ model, match, sideA, sideB, predictedWinner, predictedScoreA, predictedScoreB, probabilityA, probabilityDraw, probabilityB, predictedConfidence, probabilitySource, note }) {
  const outcome = predictionOutcome(match, predictedWinner);
  return {
    modelKey: model.key,
    modelName: model.label,
    matchId: match.matchId,
    phase: match.phase,
    round: match.round,
    group: match.group,
    teamA: match.teamA,
    teamB: match.teamB,
    modelSideA: sideA || match.teamA,
    modelSideB: sideB || match.teamB,
    predictedWinner,
    predictedOutcome: outcome,
    predictedScoreA,
    predictedScoreB,
    probabilityA: displayNumber(probabilityA),
    probabilityDraw: displayNumber(probabilityDraw),
    probabilityB: displayNumber(probabilityB),
    predictedConfidence: displayNumber(predictedConfidence ?? (outcome === "H" ? probabilityA : outcome === "D" ? probabilityDraw : outcome === "A" ? probabilityB : null)),
    probabilitySource,
    note: note || "",
    sourceFile: model.sourceFile,
  };
}

function isStandardPredictionRow(row) {
  const rowType = String(row.record_type ?? "").trim().toLowerCase();
  const hasCanonicalShape =
    "match_id" in row &&
    (("team_a" in row && "team_b" in row) || ("model_team_a" in row && "model_team_b" in row) || ("slot_team_a" in row && "slot_team_b" in row)) &&
    "predicted_winner" in row &&
    "team_a_win_prob" in row &&
    "draw_prob" in row &&
    "team_b_win_prob" in row;
  return hasCanonicalShape && (!rowType || rowType === "match");
}

function scoreFromStandardRow(row) {
  const directScoreA = toNumber(row.predicted_score_team_a);
  const directScoreB = toNumber(row.predicted_score_team_b);
  if (directScoreA !== null || directScoreB !== null) return [directScoreA, directScoreB];
  return parseScore(row.predicted_score);
}

function normalizeStandardRows(model, indexes, sourceRows) {
  const rows = sourceRows.filter(isStandardPredictionRow);
  const normalized = [];
  const warnings = [];
  for (const row of rows) {
    const round = normalizeRound(row.round || row.stage || row.phase);
    const sourceMatchId = canonicalMatchId(row.match_id, row.group, round);
    const modelSideA = rowModelSideA(row);
    const modelSideB = rowModelSideB(row);
    const slotSideA = rowSlotSideA(row);
    const slotSideB = rowSlotSideB(row);
    const idMatch = indexes.byId.get(sourceMatchId);
    const slotPairMatch = findByTeams(indexes, round, row.group, slotSideA, slotSideB);
    const modelPairMatch = findByTeams(indexes, round, row.group, modelSideA, modelSideB);
    const pairMatch = slotPairMatch || modelPairMatch;
    const shouldRemapByPair =
      round === "Group stage" &&
      idMatch &&
      pairMatch &&
      pairMatch.matchId !== idMatch.matchId &&
      !matchContainsTeams(idMatch, slotSideA, slotSideB);
    const match = shouldRemapByPair ? pairMatch : idMatch || pairMatch;
    if (!match) {
      warnings.push(`No canonical match for ${row.match_id || `${modelSideA} vs ${modelSideB}`}`);
      continue;
    }
    const [scoreA, scoreB] = scoreFromStandardRow(row);
    const pSideA = toNumber(row.team_a_win_prob);
    const pDraw = toNumber(row.draw_prob);
    const pSideB = toNumber(row.team_b_win_prob);
    const probabilitySideA = modelSideA || match.teamA;
    const probabilitySideB = modelSideB || match.teamB;
    const probabilities = alignProbabilities(match, probabilitySideA, probabilitySideB, pSideA, pDraw, pSideB);
    const hasFullDistribution = pSideA !== null && pDraw !== null && pSideB !== null;
    const hasAlignedDistribution = probabilities.probabilityA !== null && probabilities.probabilityDraw !== null && probabilities.probabilityB !== null;
    const remapNote = shouldRemapByPair ? `Source match_id ${sourceMatchId} was remapped to ${match.matchId} based on fixture teams.` : "";
    const oriented = orientSidesAndScore(match, probabilitySideA, probabilitySideB, scoreA, scoreB);
    const outcomeWinner = winnerFromPredictedOutcome(match, row.predicted_outcome);
    const predictedWinner = usableTeam(row.predicted_winner) ? row.predicted_winner : outcomeWinner || row.predicted_winner;
    normalized.push(
      normalizeCore({
        model,
        match,
        sideA: oriented.sideA,
        sideB: oriented.sideB,
        predictedWinner,
        predictedScoreA: oriented.scoreA,
        predictedScoreB: oriented.scoreB,
        ...probabilities,
        predictedConfidence: toNumber(row.likelihood) ?? toNumber(row.confidence),
        probabilitySource: hasFullDistribution && hasAlignedDistribution ? "full_1x2" : hasFullDistribution ? "full_1x2_unaligned_matchup" : "single_winner_probability",
        note: [remapNote, row.notes || row.rationale].filter(Boolean).join(" "),
      }),
    );
  }
  return { normalized, warnings };
}

function normalizeStandardModel(model, indexes) {
  return normalizeStandardRows(model, indexes, readCsv(model.sourceFile));
}

function normalizeGemini(model, indexes) {
  const rows = readCsv(model.sourceFile);
  const normalized = [];
  const warnings = [];
  const counters = new Map();

  for (const row of rows) {
    const isGroup = /^Group\s+[A-L]$/i.test(row.stage);
    const group = isGroup ? parseGroup(row.stage) : "";
    const round = isGroup ? "Group stage" : normalizeRound(row.stage);
    let match = isGroup ? findByTeams(indexes, round, group, row.home, row.away) : null;
    if (!match && !isGroup) {
      const roundList = indexes.byRound.get(round) || [];
      const nextIndex = counters.get(round) ?? 0;
      match = roundList[nextIndex];
      counters.set(round, nextIndex + 1);
    }
    if (!match) {
      warnings.push(`No canonical match for ${row.stage}: ${row.home} vs ${row.away}`);
      continue;
    }

    const scoreA = toNumber(row.home_score);
    const scoreB = toNumber(row.away_score);
    let predictedWinner = "Draw";
    if (row.result === "H") predictedWinner = row.home;
    if (row.result === "A") predictedWinner = row.away;

    const likelihood = toNumber(row.likelihood);
    const residual = likelihood === null ? null : Math.max(0, 1 - likelihood) / 2;
    let pSideA = null;
    let pDraw = null;
    let pSideB = null;
    if (likelihood !== null) {
      if (row.result === "H") {
        pSideA = likelihood;
        pDraw = residual;
        pSideB = residual;
      } else if (row.result === "D") {
        pSideA = residual;
        pDraw = likelihood;
        pSideB = residual;
      } else {
        pSideA = residual;
        pDraw = residual;
        pSideB = likelihood;
      }
    }

    const probabilities = alignProbabilities(match, row.home, row.away, pSideA, pDraw, pSideB);
    normalized.push(
      normalizeCore({
        model,
        match,
        sideA: row.home,
        sideB: row.away,
        predictedWinner,
        predictedScoreA: scoreA,
        predictedScoreB: scoreB,
        ...probabilities,
        predictedConfidence: likelihood,
        probabilitySource: "imputed_from_single_likelihood",
        note: "Source provided one likelihood for the selected result; remaining probability is split for Brier/log-loss only.",
      }),
    );
  }
  return { normalized, warnings };
}

function parseFableDetail(detail, sideA, sideB) {
  const scoreMatch = String(detail ?? "").match(/most likely\s+(\d+\s*[-:]\s*\d+)/i);
  const [scoreA, scoreB] = scoreMatch ? parseScore(scoreMatch[1]) : [null, null];
  const probabilityMatch = String(detail ?? "").match(/;\s*([^;]+)$/);
  const distribution = probabilityMatch ? probabilityMatch[1] : "";
  const chunks = distribution.split("/").map((chunk) => chunk.trim());
  let pSideA = null;
  let pDraw = null;
  let pSideB = null;
  for (const chunk of chunks) {
    const probability = percentToProbability(chunk.match(/(\d+(?:\.\d+)?)\s*%/)?.[1]);
    if (probability === null) continue;
    const label = chunk.replace(/(\d+(?:\.\d+)?)\s*%/, "").trim().toLowerCase();
    if (label.includes("draw")) pDraw = probability;
    else if (teamKey(label) === teamKey(sideA)) pSideA = probability;
    else if (teamKey(label) === teamKey(sideB)) pSideB = probability;
  }
  return { scoreA, scoreB, pSideA, pDraw, pSideB };
}

function normalizeFable(model, indexes) {
  const rows = readCsv(model.sourceFile);
  const normalized = [];
  const warnings = [];

  for (const row of rows) {
    const round = normalizeRound(row.stage);
    if (!ROUND_ORDER[round]) continue;
    const [sideA, sideB] = splitFixture(row.fixture_or_item);
    if (!sideA || !sideB) continue;

    const matchId = parseMatchNumber(row.context);
    const group = parseGroup(row.context);
    const match = matchId ? indexes.byId.get(matchId) : findByTeams(indexes, round, group, sideA, sideB);
    if (!match) {
      warnings.push(`No canonical match for ${row.stage}: ${row.fixture_or_item}`);
      continue;
    }

    const predictedWinner = String(row.prediction ?? "").replace(/\s+win$/i, "").trim();
    const groupDetail = parseFableDetail(row.detail, sideA, sideB);
    const pWin = toNumber(row.probability);
    let pSideA = groupDetail.pSideA;
    let pDraw = groupDetail.pDraw;
    let pSideB = groupDetail.pSideB;
    if (pSideA === null && pSideB === null && pWin !== null) {
      if (teamKey(predictedWinner) === teamKey(sideA)) pSideA = pWin;
      if (teamKey(predictedWinner) === teamKey(sideB)) pSideB = pWin;
    }
    const probabilities = alignProbabilities(match, sideA, sideB, pSideA, pDraw, pSideB);

    normalized.push(
      normalizeCore({
        model,
        match,
        sideA,
        sideB,
        predictedWinner,
        predictedScoreA: groupDetail.scoreA,
        predictedScoreB: groupDetail.scoreB,
        ...probabilities,
        predictedConfidence: pWin,
        probabilitySource: probabilities.probabilityA !== null && probabilities.probabilityDraw !== null && probabilities.probabilityB !== null ? "parsed_1x2_from_detail" : "single_winner_probability",
        note: row.detail,
      }),
    );
  }
  return { normalized, warnings };
}

function normalizeGrok(model, indexes) {
  const rows = readCsv(model.sourceFile);
  const normalized = [];
  const warnings = [];

  for (const row of rows) {
    const round = normalizeRound(row.stage);
    if (!ROUND_ORDER[round]) continue;
    const matchId = parseMatchNumber(row.match_label);
    const group = parseGroup(row.match_label);
    const match = matchId ? indexes.byId.get(matchId) : findByTeams(indexes, round, group, row.side1, row.side2);
    if (!match) {
      warnings.push(`No canonical match for ${row.stage}: ${row.match_label}`);
      continue;
    }

    const pWin = toNumber(row.win_probability);
    const pDraw = toNumber(row.p_draw);
    const pOther = pWin !== null && pDraw !== null ? Math.max(0, 1 - pWin - pDraw) : null;
    let pSideA = null;
    let pSideB = null;
    if (pWin !== null) {
      if (teamKey(row.predicted_winner) === teamKey(row.side1)) {
        pSideA = pWin;
        pSideB = pOther;
      } else if (teamKey(row.predicted_winner) === teamKey(row.side2)) {
        pSideA = pOther;
        pSideB = pWin;
      }
    }

    const probabilities = alignProbabilities(match, row.side1, row.side2, pSideA, pDraw, pSideB);
    normalized.push(
      normalizeCore({
        model,
        match,
        sideA: row.side1,
        sideB: row.side2,
        predictedWinner: row.predicted_winner,
        predictedScoreA: null,
        predictedScoreB: null,
        ...probabilities,
        predictedConfidence: pWin,
        probabilitySource: probabilities.probabilityA !== null && probabilities.probabilityDraw !== null && probabilities.probabilityB !== null ? "winner_draw_reconstructed" : "single_winner_probability",
        note: [row.likelihood_note, row.expected_goals_side1 && row.expected_goals_side2 ? `xG ${row.expected_goals_side1}-${row.expected_goals_side2}` : ""].filter(Boolean).join(" | "),
      }),
    );
  }
  return { normalized, warnings };
}

function normalizePredictions(matches) {
  const indexes = buildIndexes(matches);
  const all = [];
  const report = [];
  for (const model of MODEL_DEFS) {
    if (!model.sourceFile) {
      report.push({
        modelKey: model.key,
        modelName: model.label,
        normalizedPredictions: 0,
        warnings: ["No prediction CSV found for this model."],
      });
      continue;
    }
    const sourceRows = readCsv(model.sourceFile);
    const hasCanonicalMatchRows = sourceRows.some(isStandardPredictionRow);
    let result;
    if (hasCanonicalMatchRows) result = normalizeStandardRows(model, indexes, sourceRows);
    else if (model.key === "fable-5-high") result = normalizeFable(model, indexes);
    else if (model.key === "gemini-3-1-pro-medium") result = normalizeGemini(model, indexes);
    else if (model.key === "grok-build-0-1") result = normalizeGrok(model, indexes);
    else result = normalizeStandardRows(model, indexes, sourceRows);
    all.push(...result.normalized);
    report.push({
      modelKey: model.key,
      modelName: model.label,
      normalizedPredictions: result.normalized.length,
      warnings: result.warnings,
    });
  }
  all.sort((a, b) => a.matchId.localeCompare(b.matchId, undefined, { numeric: true }) || a.modelKey.localeCompare(b.modelKey));
  return { predictions: all, report };
}

function defaultResults(matches) {
  return matches.map((match) => ({
    match_id: match.matchId,
    phase: match.phase,
    round: match.round,
    group: match.group,
    team_a: match.teamA,
    team_b: match.teamB,
    kickoff_utc: "",
    status: "scheduled",
    home_score: "",
    away_score: "",
    result: "",
    winner: "",
    api_fixture_id: "",
    source: "results.csv template",
    updated_at: "",
  }));
}

function loadOrCreateResults(matches) {
  const filePath = path.join(PUBLIC_DATA_DIR, "results.csv");
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
  if (!fs.existsSync(filePath)) {
    const rows = defaultResults(matches);
    writeCsv(filePath, rows, headers);
    return rows;
  }

  const existing = parseCsv(fs.readFileSync(filePath, "utf8"));
  const existingById = new Map(existing.map((row) => [row.match_id, row]));
  const merged = defaultResults(matches).map((row) => ({ ...row, ...(existingById.get(row.match_id) || {}) }));
  writeCsv(filePath, merged, headers);
  return merged;
}

function toAppResults(results) {
  return results.map((row) => {
    const homeScore = toNumber(row.home_score);
    const awayScore = toNumber(row.away_score);
    const result = row.result || resultFromScore(homeScore, awayScore);
    const winner = row.winner || (result === "H" ? row.team_a : result === "A" ? row.team_b : "");
    return {
      matchId: row.match_id,
      phase: row.phase,
      round: row.round,
      group: row.group,
      teamA: row.team_a,
      teamB: row.team_b,
      kickoffUtc: row.kickoff_utc,
      status: row.status,
      homeScore,
      awayScore,
      result,
      winner,
      apiFixtureId: row.api_fixture_id,
      source: row.source,
      updatedAt: row.updated_at,
    };
  });
}

function probabilityForOutcome(prediction, outcome) {
  if (outcome === "H") return prediction.probabilityA;
  if (outcome === "D") return prediction.probabilityDraw;
  if (outcome === "A") return prediction.probabilityB;
  return null;
}

function scorePrediction(prediction, result) {
  const completed = Boolean(result && result.result && result.status !== "scheduled");
  if (!completed) {
    return { ...prediction, completed: false, correct: false, scorelineGraded: false, resultPoints: 0, confidencePoints: 0, scorelinePoints: 0, totalPoints: 0, brier: null, logLoss: null };
  }

  const actualWinner = result.result === "H" ? result.teamA : result.result === "A" ? result.teamB : "";
  const correct = result.result === "D" ? prediction.predictedOutcome === "D" || teamKey(prediction.predictedWinner) === "draw" : teamKey(prediction.predictedWinner) === teamKey(actualWinner);
  const resultPoints = correct ? 10 : 0;
  const confidence = prediction.predictedConfidence ?? probabilityForOutcome(prediction, prediction.predictedOutcome);
  const confidencePoints = typeof confidence === "number" ? (correct ? 5 * confidence : -5 * confidence) : 0;

  let predScoreA = prediction.predictedScoreA;
  let predScoreB = prediction.predictedScoreB;
  if (teamKey(prediction.modelSideA) === teamKey(result.teamB) && teamKey(prediction.modelSideB) === teamKey(result.teamA)) {
    predScoreA = prediction.predictedScoreB;
    predScoreB = prediction.predictedScoreA;
  }
  const sidesMatch = [teamKey(prediction.modelSideA), teamKey(prediction.modelSideB)].sort().join("|") === [teamKey(result.teamA), teamKey(result.teamB)].sort().join("|");
  const scorelineGraded = sidesMatch && predScoreA !== null && predScoreB !== null && result.homeScore !== null && result.awayScore !== null;
  let scorelinePoints = 0;
  if (scorelineGraded) {
    if (predScoreA === result.homeScore && predScoreB === result.awayScore) {
      scorelinePoints = 5;
    } else {
      if (predScoreA - predScoreB === result.homeScore - result.awayScore) scorelinePoints += 2;
      if (Math.abs(predScoreA + predScoreB - (result.homeScore + result.awayScore)) <= 1) scorelinePoints += 1;
      if (resultFromScore(predScoreA, predScoreB) === result.result) scorelinePoints += 1;
    }
  }

  let brier = null;
  let logLoss = null;
  if (prediction.probabilityA !== null && prediction.probabilityDraw !== null && prediction.probabilityB !== null && result.result) {
    const pA = prediction.probabilityA;
    const pD = prediction.probabilityDraw;
    const pB = prediction.probabilityB;
    brier = (pA - (result.result === "H" ? 1 : 0)) ** 2 + (pD - (result.result === "D" ? 1 : 0)) ** 2 + (pB - (result.result === "A" ? 1 : 0)) ** 2;
    logLoss = -Math.log(Math.max(0.02, probabilityForOutcome(prediction, result.result) ?? 0.02));
  }

  return {
    ...prediction,
    completed,
    correct,
    scorelineGraded,
    resultPoints: displayNumber(resultPoints, 3),
    confidencePoints: displayNumber(confidencePoints, 3),
    scorelinePoints: displayNumber(scorelinePoints, 3),
    totalPoints: displayNumber(resultPoints + confidencePoints + scorelinePoints, 3),
    brier: displayNumber(brier, 4),
    logLoss: displayNumber(logLoss, 4),
  };
}

function aggregateStandings(models, predictions, results) {
  const resultsById = new Map(results.map((result) => [result.matchId, result]));
  return models
    .map((model) => {
      const scored = predictions
        .filter((prediction) => prediction.modelKey === model.key)
        .map((prediction) => scorePrediction(prediction, resultsById.get(prediction.matchId)))
        .filter((prediction) => prediction.completed);
      const briers = scored.map((prediction) => prediction.brier).filter((value) => typeof value === "number");
      const logLosses = scored.map((prediction) => prediction.logLoss).filter((value) => typeof value === "number");
      const correct = scored.filter((prediction) => prediction.correct).length;
      return {
        modelKey: model.key,
        score: displayNumber(scored.reduce((sum, prediction) => sum + prediction.totalPoints, 0), 3),
        completed: scored.length,
        correct,
        accuracy: scored.length ? displayNumber(correct / scored.length, 4) : 0,
        exactScores: scored.filter((prediction) => prediction.scorelinePoints === 5).length,
        brier: briers.length ? displayNumber(briers.reduce((sum, value) => sum + value, 0) / briers.length, 4) : null,
        logLoss: logLosses.length ? displayNumber(logLosses.reduce((sum, value) => sum + value, 0) / logLosses.length, 4) : null,
        confidenceCoverage: scored.filter((prediction) => typeof prediction.predictedConfidence === "number").length,
        probabilityCoverage: briers.length,
      };
    })
    .sort((a, b) => b.score - a.score || b.accuracy - a.accuracy);
}

function copyRawFiles() {
  ensureDir(PUBLIC_RAW_DIR);
  for (const file of fs.readdirSync(PUBLIC_RAW_DIR)) {
    if (file.endsWith(".csv")) fs.rmSync(path.join(PUBLIC_RAW_DIR, file));
  }
  const rawFiles = [
    ...MODEL_DEFS.map((model) => model.sourceFile),
    "raw-data/international_matches_2022_2026.csv",
  ].filter(Boolean);
  const index = rawFiles.map((relativePath) => {
    const basename = path.basename(relativePath);
    fs.copyFileSync(path.join(ROOT, relativePath), path.join(PUBLIC_RAW_DIR, basename));
    return {
      label: relativePath,
      href: `/data/raw/${basename}`,
      bytes: fs.statSync(path.join(ROOT, relativePath)).size,
    };
  });
  fs.writeFileSync(path.join(PUBLIC_DATA_DIR, "raw-files.json"), JSON.stringify(index, null, 2));
  return index;
}

function main() {
  ensureDir(PUBLIC_DATA_DIR);
  ensureDir(PUBLIC_RAW_DIR);

  const resolvedModels = resolveModelSources(MODEL_DEFS);
  MODEL_DEFS.splice(0, MODEL_DEFS.length, ...resolvedModels);
  const matches = buildCanonicalMatches(MODEL_DEFS);
  const { predictions, report } = normalizePredictions(matches);
  const resultRows = loadOrCreateResults(matches);
  const kickoffById = new Map(resultRows.map((r) => [r.match_id, r.kickoff_utc || ""]));
  const matchesWithDates = matches
    .map((m) => ({ ...m, kickoffUtc: kickoffById.get(m.matchId) || "" }))
    .sort((a, b) => computePlayOrder(a) - computePlayOrder(b))
    .map((match, index) => ({ ...match, sortOrder: index + 1 }));
  const results = toAppResults(resultRows);
  const standings = aggregateStandings(MODEL_DEFS, predictions, results);
  const rawFiles = copyRawFiles();

  const matchesForOutput = matchesWithDates;

  const normalizedHeaders = [
    "modelKey",
    "modelName",
    "matchId",
    "phase",
    "round",
    "group",
    "teamA",
    "teamB",
    "modelSideA",
    "modelSideB",
    "predictedWinner",
    "predictedOutcome",
    "predictedScoreA",
    "predictedScoreB",
    "probabilityA",
    "probabilityDraw",
    "probabilityB",
    "predictedConfidence",
    "probabilitySource",
    "note",
    "sourceFile",
  ];
  writeCsv(path.join(PUBLIC_DATA_DIR, "normalized-predictions.csv"), predictions, normalizedHeaders);
  fs.writeFileSync(path.join(PUBLIC_DATA_DIR, "normalized-predictions.json"), JSON.stringify(predictions, null, 2));
  fs.writeFileSync(path.join(PUBLIC_DATA_DIR, "matches.json"), JSON.stringify(matchesForOutput, null, 2));
  fs.writeFileSync(path.join(PUBLIC_DATA_DIR, "models.json"), JSON.stringify(MODEL_DEFS, null, 2));
  fs.writeFileSync(path.join(PUBLIC_DATA_DIR, "scoring-rubric.json"), JSON.stringify(RUBRIC, null, 2));
  fs.writeFileSync(path.join(PUBLIC_DATA_DIR, "normalization-report.json"), JSON.stringify(report, null, 2));
  // Only rewrite bench-data.json when something other than the timestamp changed,
  // so the scheduled refresh job doesn't create churn commits (and merge conflicts).
  const benchDataPath = path.join(PUBLIC_DATA_DIR, "bench-data.json");
  const benchPayload = {
    generatedAt: new Date().toISOString(),
    models: MODEL_DEFS,
    matches: matchesForOutput,
    predictions,
    results,
    standings,
    rubric: RUBRIC,
    normalizationReport: report,
    rawFiles,
  };
  let benchUnchanged = false;
  if (fs.existsSync(benchDataPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(benchDataPath, "utf8"));
      const stripTimestamp = ({ generatedAt, ...rest }) => rest;
      benchUnchanged = JSON.stringify(stripTimestamp(existing)) === JSON.stringify(stripTimestamp(benchPayload));
    } catch {
      benchUnchanged = false;
    }
  }
  if (!benchUnchanged) {
    fs.writeFileSync(benchDataPath, JSON.stringify(benchPayload, null, 2));
  }

  console.log(`Prepared ${matchesForOutput.length} matches and ${predictions.length} normalized predictions.`);
  for (const item of report) {
    console.log(`${item.modelName}: ${item.normalizedPredictions} predictions, ${item.warnings.length} warnings`);
  }
}

main();
