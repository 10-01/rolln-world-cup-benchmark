export type Outcome = "H" | "D" | "A" | "O" | "";

export type ModelInfo = {
  key: string;
  name: string;
  effort: string;
  label: string;
  sourceFile: string;
};

export type MatchInfo = {
  matchId: string;
  phase: string;
  round: string;
  group: string;
  teamA: string;
  teamB: string;
  sortOrder: number;
  kickoffUtc?: string;
};

const ROUND_PLAY_ORDER: Record<string, number> = {
  "Group stage": 1,
  "Round of 32": 2,
  "Round of 16": 3,
  "Quarter-final": 4,
  "Semi-final": 5,
  "Third-place match": 6,
  Final: 7,
};

function parseGroupMatchNumber(matchId: string) {
  const match = matchId.match(/^G([A-L])(\d+)$/i);
  if (!match) return null;
  return {
    groupIndex: match[1].toUpperCase().charCodeAt(0) - 64,
    matchNumber: Number(match[2]),
  };
}

export function matchPlayOrder(match: Pick<MatchInfo, "matchId" | "round" | "sortOrder" | "kickoffUtc">) {
  if (match.kickoffUtc) {
    const kickoff = Date.parse(match.kickoffUtc);
    if (Number.isFinite(kickoff)) return kickoff;
  }

  const roundBase = (ROUND_PLAY_ORDER[match.round] ?? 99) * 1_000_000;
  const groupMatch = parseGroupMatchNumber(match.matchId);
  if (groupMatch) {
    const { groupIndex, matchNumber } = groupMatch;
    const matchday = Math.ceil(matchNumber / 2);
    const slot = (matchNumber - 1) % 2;
    return roundBase + matchday * 10_000 + slot * 1_000 + groupIndex * 10 + matchNumber;
  }

  const knockoutId = Number(match.matchId);
  if (Number.isFinite(knockoutId)) return roundBase + knockoutId;

  return roundBase + match.sortOrder;
}

export function compareMatchesByPlayTime(
  a: Pick<MatchInfo, "matchId" | "round" | "sortOrder" | "kickoffUtc">,
  b: Pick<MatchInfo, "matchId" | "round" | "sortOrder" | "kickoffUtc">,
) {
  return matchPlayOrder(a) - matchPlayOrder(b);
}

export function matchScheduleBucket(match: Pick<MatchInfo, "matchId" | "round" | "kickoffUtc">, timeZone = "UTC") {
  if (match.kickoffUtc) {
    const kickoff = Date.parse(match.kickoffUtc);
    if (Number.isFinite(kickoff)) {
      // Calendar date in the viewer's zone, so a 02:00 UTC match groups under the local evening before.
      return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(kickoff);
    }
  }

  const groupMatch = parseGroupMatchNumber(match.matchId);
  if (groupMatch) {
    const matchday = Math.ceil(groupMatch.matchNumber / 2);
    return `matchday-${matchday}`;
  }

  return match.round || "Other";
}

export function formatScheduleBucketLabel(key: string, sample?: Pick<MatchInfo, "round">) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    const date = new Date(`${key}T00:00:00Z`);
    return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "long", day: "numeric", timeZone: "UTC" })
      .format(date)
      .toUpperCase();
  }
  const matchday = key.match(/^matchday-(\d+)$/);
  if (matchday) return `MATCHDAY ${matchday[1]}`;
  if (sample?.round) return sample.round.toUpperCase();
  return key.toUpperCase();
}

export type Prediction = {
  modelKey: string;
  matchId: string;
  phase: string;
  round: string;
  group: string;
  teamA: string;
  teamB: string;
  predictedWinner: string;
  predictedOutcome: Outcome;
  predictedScoreA: number | null;
  predictedScoreB: number | null;
  modelSideA: string;
  modelSideB: string;
  probabilityA: number | null;
  probabilityDraw: number | null;
  probabilityB: number | null;
  predictedConfidence: number | null;
  probabilitySource: string;
  note: string;
  sourceFile: string;
};

export type ResultRow = {
  matchId: string;
  status: string;
  teamA: string;
  teamB: string;
  homeScore: number | null;
  awayScore: number | null;
  result: Outcome;
  winner: string;
  apiFixtureId: string;
  source: string;
  updatedAt: string;
};

export type ScoredPrediction = Prediction & {
  completed: boolean;
  correct: boolean;
  scorelineGraded: boolean;
  resultPoints: number;
  confidencePoints: number;
  scorelinePoints: number;
  totalPoints: number;
  brier: number | null;
  logLoss: number | null;
};

export type ModelStanding = {
  modelKey: string;
  score: number;
  completed: number;
  correct: number;
  accuracy: number;
  exactScores: number;
  brier: number | null;
  logLoss: number | null;
  confidenceCoverage: number;
  probabilityCoverage: number;
};

const TEAM_ALIASES: Record<string, string> = {
  "bosnia & herzegovina": "bosnia and herzegovina",
  "czech republic": "czechia",
  "korea republic": "south korea",
  "republic of korea": "south korea",
  "south korea": "south korea",
  "curacao": "curacao",
  "curaçao": "curacao",
  "ivory coast": "ivory coast",
  "cote divoire": "ivory coast",
  "côte divoire": "ivory coast",
  "cape verde islands": "cape verde",
  "cape verde": "cape verde",
  "dr congo": "dr congo",
  "d r congo": "dr congo",
  "congo dr": "dr congo",
  "usa": "united states",
  "u s a": "united states",
  "united states": "united states",
  "turkey": "turkiye",
  "turkiye": "turkiye",
  "türkiye": "turkiye",
};

export function teamKey(value: string | null | undefined): string {
  const raw = (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return TEAM_ALIASES[raw] ?? raw;
}

export function resultFromScore(a: number | null, b: number | null): Outcome {
  if (a === null || b === null || Number.isNaN(a) || Number.isNaN(b)) return "";
  if (a > b) return "H";
  if (a < b) return "A";
  return "D";
}

export function outcomeLabel(outcome: Outcome): string {
  if (outcome === "H") return "Home";
  if (outcome === "A") return "Away";
  if (outcome === "D") return "Draw";
  if (outcome === "O") return "Other";
  return "Not set";
}

function probabilityForOutcome(prediction: Prediction, outcome: Outcome): number | null {
  if (outcome === "H") return prediction.probabilityA;
  if (outcome === "D") return prediction.probabilityDraw;
  if (outcome === "A") return prediction.probabilityB;
  return null;
}

function hasFullDistribution(prediction: Prediction): boolean {
  return (
    typeof prediction.probabilityA === "number" &&
    typeof prediction.probabilityDraw === "number" &&
    typeof prediction.probabilityB === "number"
  );
}

function sidesMatch(prediction: Prediction, result: ResultRow): boolean {
  const predictedSides = [teamKey(prediction.modelSideA), teamKey(prediction.modelSideB)].sort().join("|");
  const resultSides = [teamKey(result.teamA), teamKey(result.teamB)].sort().join("|");
  return predictedSides === resultSides;
}

function alignedPredictedScore(prediction: Prediction, result: ResultRow): [number | null, number | null] {
  if (prediction.predictedScoreA === null || prediction.predictedScoreB === null) return [null, null];
  if (teamKey(prediction.modelSideA) === teamKey(result.teamA) && teamKey(prediction.modelSideB) === teamKey(result.teamB)) {
    return [prediction.predictedScoreA, prediction.predictedScoreB];
  }
  if (teamKey(prediction.modelSideA) === teamKey(result.teamB) && teamKey(prediction.modelSideB) === teamKey(result.teamA)) {
    return [prediction.predictedScoreB, prediction.predictedScoreA];
  }
  return [null, null];
}

function actualWinner(result: ResultRow): string {
  if (result.result === "H") return result.teamA;
  if (result.result === "A") return result.teamB;
  return "";
}

export function scorePrediction(prediction: Prediction, result?: ResultRow): ScoredPrediction {
  const completed = Boolean(result && result.result && result.status !== "scheduled");
  if (!result || !completed) {
    return {
      ...prediction,
      completed: false,
      correct: false,
      scorelineGraded: false,
      resultPoints: 0,
      confidencePoints: 0,
      scorelinePoints: 0,
      totalPoints: 0,
      brier: null,
      logLoss: null,
    };
  }

  const winner = actualWinner(result);
  const correct =
    result.result === "D"
      ? prediction.predictedOutcome === "D" || teamKey(prediction.predictedWinner) === "draw"
      : teamKey(prediction.predictedWinner) === teamKey(winner);

  const resultPoints = correct ? 10 : 0;
  const confidence = prediction.predictedConfidence ?? probabilityForOutcome(prediction, prediction.predictedOutcome);
  const confidencePoints = typeof confidence === "number" ? (correct ? 5 * confidence : -5 * confidence) : 0;

  const [predA, predB] = alignedPredictedScore(prediction, result);
  const scorelineGraded = sidesMatch(prediction, result) && predA !== null && predB !== null;
  let scorelinePoints = 0;
  if (scorelineGraded && result.homeScore !== null && result.awayScore !== null) {
    const exact = predA === result.homeScore && predB === result.awayScore;
    if (exact) {
      scorelinePoints = 5;
    } else {
      const predictedDiff = predA - predB;
      const actualDiff = result.homeScore - result.awayScore;
      const predictedTotal = predA + predB;
      const actualTotal = result.homeScore + result.awayScore;
      if (predictedDiff === actualDiff) scorelinePoints += 2;
      if (Math.abs(predictedTotal - actualTotal) <= 1) scorelinePoints += 1;
      if (resultFromScore(predA, predB) === result.result) scorelinePoints += 1;
    }
  }

  let brier: number | null = null;
  let logLoss: number | null = null;
  if (hasFullDistribution(prediction) && result.result !== "O") {
    const pA = prediction.probabilityA ?? 0;
    const pD = prediction.probabilityDraw ?? 0;
    const pB = prediction.probabilityB ?? 0;
    const yA = result.result === "H" ? 1 : 0;
    const yD = result.result === "D" ? 1 : 0;
    const yB = result.result === "A" ? 1 : 0;
    brier = (pA - yA) ** 2 + (pD - yD) ** 2 + (pB - yB) ** 2;
    const pActual = Math.max(0.02, probabilityForOutcome(prediction, result.result) ?? 0.02);
    logLoss = -Math.log(pActual);
  }

  const totalPoints = resultPoints + confidencePoints + scorelinePoints;
  return {
    ...prediction,
    completed,
    correct,
    scorelineGraded,
    resultPoints,
    confidencePoints,
    scorelinePoints,
    totalPoints,
    brier,
    logLoss,
  };
}

export function scoreAll(models: ModelInfo[], predictions: Prediction[], results: ResultRow[]): ModelStanding[] {
  const resultsById = new Map(results.map((result) => [result.matchId, result]));
  return models
    .map((model) => {
      const scored = predictions
        .filter((prediction) => prediction.modelKey === model.key)
        .map((prediction) => scorePrediction(prediction, resultsById.get(prediction.matchId)))
        .filter((prediction) => prediction.completed);
      const completed = scored.length;
      const correct = scored.filter((prediction) => prediction.correct).length;
      const exactScores = scored.filter((prediction) => prediction.scorelinePoints === 5).length;
      const briers = scored.map((prediction) => prediction.brier).filter((value): value is number => typeof value === "number");
      const logLosses = scored.map((prediction) => prediction.logLoss).filter((value): value is number => typeof value === "number");
      const confidenceCoverage = scored.filter((prediction) => typeof prediction.predictedConfidence === "number").length;
      const probabilityCoverage = briers.length;

      return {
        modelKey: model.key,
        score: scored.reduce((sum, prediction) => sum + prediction.totalPoints, 0),
        completed,
        correct,
        accuracy: completed ? correct / completed : 0,
        exactScores,
        brier: briers.length ? briers.reduce((sum, value) => sum + value, 0) / briers.length : null,
        logLoss: logLosses.length ? logLosses.reduce((sum, value) => sum + value, 0) / logLosses.length : null,
        confidenceCoverage,
        probabilityCoverage,
      };
    })
    .sort((a, b) => b.score - a.score || b.accuracy - a.accuracy);
}
