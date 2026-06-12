"use client";

import Image from "next/image";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  MatchInfo,
  ModelInfo,
  ModelStanding,
  Outcome,
  Prediction,
  ResultRow,
  ScoredPrediction,
  compareMatchesByPlayTime,
  formatScheduleBucketLabel,
  matchScheduleBucket,
  scoreAll,
  scorePrediction,
} from "../../src/lib/bench";

type RawFile = {
  label: string;
  href: string;
  bytes: number;
};

type Rubric = {
  version: string;
  primaryScore: string;
  perCompletedMatch: Array<{ component: string; points: string; rule: string }>;
  secondaryMetrics: string[];
  confidencePolicy: string;
};

type NormalizationReport = Array<{
  modelKey: string;
  modelName: string;
  normalizedPredictions: number;
  warnings: string[];
}>;

export type BenchData = {
  generatedAt: string;
  models: ModelInfo[];
  matches: MatchInfo[];
  predictions: Prediction[];
  results: ResultRow[];
  standings: ModelStanding[];
  rubric: Rubric;
  normalizationReport: NormalizationReport;
  rawFiles: RawFile[];
};

export type DashboardTab = "overview" | "rubric";

const TABS: Array<{ key: DashboardTab; label: string; href: string }> = [
  { key: "overview", label: "Fixtures & standings", href: "/" },
  { key: "rubric", label: "Scoring rubric", href: "/rubric" },
];

const OUTCOME_NAMES: Record<Outcome, string> = {
  H: "Home",
  D: "Draw",
  A: "Away",
  O: "Other",
  "": "None",
};

function formatNumber(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatSigned(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const text = formatNumber(Math.abs(value), digits);
  return value >= 0 ? `+${text}` : `−${text}`;
}

function formatPct(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

// Server render and first client paint use UTC; an effect swaps in the visitor's
// zone after mount, so hydration stays deterministic.
function formatTime(iso: string | undefined, timeZone: string) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(t));
}

function formatDateTime(iso: string | undefined, timeZone: string) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
    timeZoneName: "short",
  }).formatToParts(new Date(t));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("month")} ${get("day")}, ${get("hour")}:${get("minute")} ${get("timeZoneName")}`;
}

// Zone abbreviation sampled mid-tournament so DST is stable across the label.
function zoneShortLabel(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(new Date("2026-06-25T12:00:00Z"));
  return parts.find((part) => part.type === "timeZoneName")?.value ?? timeZone;
}

function modelByKey(models: ModelInfo[]) {
  return new Map(models.map((model) => [model.key, model]));
}

function isCompleted(result?: ResultRow) {
  return Boolean(result && result.result && result.status !== "scheduled");
}

function pickText(prediction: Prediction) {
  if (prediction.predictedOutcome === "D") return "Draw";
  return prediction.predictedWinner || OUTCOME_NAMES[prediction.predictedOutcome];
}

function pickTeamLabel(prediction: Prediction, match: MatchInfo) {
  if (prediction.predictedOutcome === "D") return "Draw";
  if (prediction.predictedOutcome === "H") return match.teamA;
  if (prediction.predictedOutcome === "A") return match.teamB;
  return pickText(prediction);
}

function teamShortLabel(name: string, max = 12) {
  if (name.length <= max) return name;
  const firstWord = name.split(" ")[0];
  if (firstWord.length <= max) return firstWord;
  return `${name.slice(0, max - 1)}…`;
}

function modelShortName(model?: ModelInfo, modelKey?: string) {
  if (model?.name) return model.name;
  if (!modelKey) return "Model";
  return modelKey.replace(/-/g, " ");
}

function scoreText(prediction: Prediction) {
  if (prediction.predictedScoreA === null || prediction.predictedScoreB === null) return "—";
  return `${prediction.predictedScoreA}–${prediction.predictedScoreB}`;
}

export function Dashboard({ initialData, tab }: { initialData: BenchData; tab: DashboardTab }) {
  const [query, setQuery] = useState("");
  const [roundFilter, setRoundFilter] = useState("All");
  const [modelFilter, setModelFilter] = useState("All");
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [liveResults, setLiveResults] = useState<ResultRow[] | null>(null);
  const [liveStatus, setLiveStatus] = useState<"idle" | "loading" | "ready" | "snapshot" | "unconfigured" | "error">("idle");
  const [liveUpdatedAt, setLiveUpdatedAt] = useState<string | null>(null);
  const [localZone, setLocalZone] = useState<string | null>(null);

  useEffect(() => {
    try {
      setLocalZone(Intl.DateTimeFormat().resolvedOptions().timeZone || null);
    } catch {
      // leave times in UTC if the zone can't be resolved
    }
  }, []);

  const timeZone = localZone ?? "UTC";

  async function loadLiveResults(forceFresh = false) {
    setLiveStatus((current) => (current === "ready" || current === "snapshot" ? current : "loading"));
    const url = forceFresh ? "/api/live-results?force=1" : "/api/live-results";
    try {
      const response = await fetch(url);
      const payload = await response.json();
      // The resolver always returns the authoritative result list (committed results.csv
      // plus any live overlay), so adopt it even when the live feed is unconfigured —
      // ok/source only decide how the freshness chip reads.
      if (Array.isArray(payload.results) && payload.results.length) {
        setLiveResults(payload.results);
        setLiveUpdatedAt(payload.updatedAt || payload.snapshotAt || null);
      }
      if (payload.ok && !payload.error) {
        setLiveStatus(payload.source === "snapshot" ? "snapshot" : "ready");
      } else {
        setLiveStatus(payload.error && /key|config/i.test(payload.error) ? "unconfigured" : "error");
      }
    } catch {
      setLiveStatus("error");
    }
  }

  useEffect(() => {
    loadLiveResults();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") loadLiveResults();
    }, 75_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") loadLiveResults();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const results = liveResults ?? initialData.results;
  const resultsById = useMemo(() => new Map(results.map((result) => [result.matchId, result])), [results]);
  const models = initialData.models;
  const modelsMap = useMemo(() => modelByKey(models), [models]);
  const standings = useMemo(() => scoreAll(models, initialData.predictions, results), [models, initialData.predictions, results]);
  const scoredPredictions = useMemo(
    () => initialData.predictions.map((prediction) => scorePrediction(prediction, resultsById.get(prediction.matchId))),
    [initialData.predictions, resultsById],
  );
  const predictionsByMatch = useMemo(() => {
    const map = new Map<string, ScoredPrediction[]>();
    for (const prediction of scoredPredictions) {
      if (!map.has(prediction.matchId)) map.set(prediction.matchId, []);
      map.get(prediction.matchId)?.push(prediction);
    }
    return map;
  }, [scoredPredictions]);

  const orderedMatches = useMemo(
    () => [...initialData.matches].sort(compareMatchesByPlayTime),
    [initialData.matches],
  );
  const rounds = useMemo(
    () => ["All", ...Array.from(new Set(orderedMatches.map((match) => match.round)))],
    [orderedMatches],
  );
  const completedCount = results.filter(isCompleted).length;
  const leader = standings[0];
  const leaderModel = leader ? modelsMap.get(leader.modelKey) : undefined;
  const nextMatch = orderedMatches.find((match) => !isCompleted(resultsById.get(match.matchId)));

  // Most recent settlement timestamp in the result set — the honest "as of" for static data.
  const latestResultUpdate = useMemo(() => {
    let max = "";
    for (const result of results) {
      if (result.updatedAt && result.updatedAt > max) max = result.updatedAt;
    }
    return max || null;
  }, [results]);

  const filteredMatches = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();
    return orderedMatches
      .filter((match) => roundFilter === "All" || match.round === roundFilter)
      .filter((match) => {
        if (!cleanQuery) return true;
        return `${match.matchId} ${match.round} ${match.group} ${match.teamA} ${match.teamB}`.toLowerCase().includes(cleanQuery);
      });
  }, [orderedMatches, query, roundFilter]);

  useEffect(() => {
    if (!selectedMatchId) return;
    if (!filteredMatches.some((match) => match.matchId === selectedMatchId)) {
      setSelectedMatchId("");
    }
  }, [filteredMatches, selectedMatchId]);

  const selectedMatch = selectedMatchId
    ? orderedMatches.find((match) => match.matchId === selectedMatchId)
    : undefined;
  const selectedPredictions = selectedMatch ? predictionsByMatch.get(selectedMatch.matchId) ?? [] : [];
  const selectedResult = selectedMatch ? resultsById.get(selectedMatch.matchId) : undefined;

  function liveAge(iso: string | null) {
    if (!iso) return "";
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return "";
    const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (mins < 1) return "just now";
    return `${mins}m ago`;
  }

  const sourceState: "live" | "official" | "checking" =
    liveStatus === "ready" || liveStatus === "snapshot" ? "live" : liveStatus === "loading" || liveStatus === "idle" ? "checking" : "official";
  const sourceLabel = sourceState === "live" ? "Live feed" : sourceState === "checking" ? "Checking feed" : "Official results";
  const sourceDetail =
    sourceState === "live"
      ? liveStatus === "snapshot"
        ? `snapshot · ${liveAge(liveUpdatedAt)}`
        : `API-Football · ${liveAge(liveUpdatedAt)}`
      : latestResultUpdate
        ? `updated ${formatDateTime(latestResultUpdate, timeZone)}`
        : "awaiting first final";

  return (
    <main className="shell">
      <header className="masthead">
        <Link href="/" className="masthead-brand">
          <span className="masthead-kicker">
            <Image src="/assets/rolln-world-cup-bench-logo.png" alt="rolln" width={49} height={22} className="brand-mark" priority />
          </span>
          <h1>
            World Cup <em>Bench</em>
          </h1>
        </Link>
        <p className="masthead-blurb">
          Five frontier models predicted all 104 fixtures of the 2026 FIFA World Cup before kickoff. Their picks are locked; points settle
          as full-time results come in.
        </p>
        <div className="masthead-side">
          <nav className="masthead-nav" aria-label="Sections">
            {TABS.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className={tab === item.key ? "nav-link active" : "nav-link"}
                aria-current={tab === item.key ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className={`source-chip source-${sourceState}`} title="Where match results come from">
            <span className="source-dot" aria-hidden />
            <span className="source-label">{sourceLabel}</span>
            <span className="source-detail">{sourceDetail}</span>
          </div>
        </div>
      </header>

      <div className="stat-strip" aria-label="Benchmark status">
        <div className="stat">
          <span className="stat-label">Leader</span>
          <span className="stat-value">{completedCount > 0 && leaderModel ? leaderModel.name : "—"}</span>
          <span className="stat-detail">
            {completedCount > 0 && leader ? `${formatNumber(leader.score, 1)} bench pts` : "no matches settled"}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Matches settled</span>
          <span className="stat-value">
            {completedCount}
            <span className="stat-of"> / {orderedMatches.length}</span>
          </span>
          <span className="stat-detail">{initialData.predictions.length} locked predictions</span>
        </div>
        <div className="stat">
          <span className="stat-label">Next kickoff</span>
          <span className="stat-value">{nextMatch ? `${teamShortLabel(nextMatch.teamA)} v ${teamShortLabel(nextMatch.teamB)}` : "—"}</span>
          <span className="stat-detail">{nextMatch?.kickoffUtc ? formatDateTime(nextMatch.kickoffUtc, timeZone) : "schedule TBC"}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Tournament</span>
          <span className="stat-value">FIFA 2026</span>
          <span className="stat-detail">Jun 11 – Jul 19 · 48 teams</span>
        </div>
      </div>

      {tab === "overview" && (
        <div className="board">
          <section className="ledger" aria-label="Fixture ledger">
            <div className="panel-head">
              <h2>Fixtures</h2>
              <span className="panel-note">chronological · times in {zoneShortLabel(timeZone)}</span>
            </div>
            <div className="toolbar">
              <input
                className="search-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search team, group, or match id"
                aria-label="Search fixtures"
              />
              <select value={roundFilter} onChange={(event) => setRoundFilter(event.target.value)} aria-label="Filter by round">
                {rounds.map((round) => (
                  <option key={round}>{round === "All" ? "All rounds" : round}</option>
                ))}
              </select>
              <div className="model-toggle" role="group" aria-label="Model columns">
                <button
                  type="button"
                  className={modelFilter === "All" ? "model-pill active" : "model-pill"}
                  onClick={() => setModelFilter("All")}
                >
                  All
                </button>
                {models.map((model) => (
                  <button
                    key={model.key}
                    type="button"
                    className={modelFilter === model.key ? "model-pill active" : "model-pill"}
                    onClick={() => setModelFilter(modelFilter === model.key ? "All" : model.key)}
                    title={model.label}
                  >
                    {modelShortName(model, model.key)}
                  </button>
                ))}
              </div>
            </div>
            <MatchBoard
              matches={filteredMatches}
              resultsById={resultsById}
              predictionsByMatch={predictionsByMatch}
              models={modelsMap}
              modelOrder={models.map((model) => model.key)}
              modelFilter={modelFilter}
              selectedMatchId={selectedMatch?.matchId ?? ""}
              onSelect={(id) => setSelectedMatchId(id === selectedMatchId ? "" : id)}
              timeZone={timeZone}
            />
          </section>

          <aside className="rail">
            <section className="rail-card" aria-label="Leaderboard">
              <div className="panel-head">
                <h2>Standings</h2>
                <span className="panel-note">bench points</span>
              </div>
              <LeaderboardPanel standings={standings} models={modelsMap} settled={completedCount} onSelectModel={setModelFilter} />
            </section>

            {selectedMatch && (
              <section key={selectedMatch.matchId} className="rail-card" aria-label="Selected fixture">
                <div className="panel-head">
                  <h2>
                    {selectedMatch.teamA} <span className="vs">v</span> {selectedMatch.teamB}
                  </h2>
                  <button type="button" className="close-detail" onClick={() => setSelectedMatchId("")} aria-label="Close fixture detail">
                    ✕
                  </button>
                </div>
                <MatchDetail
                  match={selectedMatch}
                  result={selectedResult}
                  predictions={selectedPredictions}
                  models={modelsMap}
                  timeZone={timeZone}
                />
              </section>
            )}

            <section className="rail-card rail-downloads" aria-label="Data downloads">
              <div className="panel-head">
                <h2>Data</h2>
              </div>
              <div className="download-list">
                <a href="/data/normalized-predictions.csv" download>
                  normalized-predictions.csv
                </a>
                <a href="/data/bench-data.json" download>
                  bench-data.json
                </a>
                <a href="/data/results.csv" download>
                  results.csv
                </a>
              </div>
            </section>
          </aside>
        </div>
      )}

      {tab === "rubric" && (
        <section className="rubric" aria-label="Scoring rubric">
          <div className="panel-head">
            <h2>{initialData.rubric.primaryScore}</h2>
            <span className="panel-note">rubric v{initialData.rubric.version}</span>
          </div>
          <div className="rubric-grid">
            {initialData.rubric.perCompletedMatch.map((item) => (
              <article key={item.component} className="rubric-item">
                <span className="rubric-points">{item.points}</span>
                <h3>{item.component}</h3>
                <p>{item.rule}</p>
              </article>
            ))}
          </div>
          <div className="rubric-notes">
            <h3>Secondary metrics</h3>
            {initialData.rubric.secondaryMetrics.map((metric) => (
              <p key={metric}>{metric}</p>
            ))}
            <h3>Confidence policy</h3>
            <p>{initialData.rubric.confidencePolicy}</p>
          </div>
        </section>
      )}

      <footer className="colophon">
        <span>
          Predictions locked before the opening match. Scoring runs in the browser against the latest results, so standings update the
          moment a final lands.
        </span>
        <span className="colophon-meta">
          built by{" "}
          <a href="https://rolln.ai" className="colophon-brand" aria-label="rolln.ai">
            <Image src="/assets/rolln-world-cup-bench-logo.png" alt="rolln" width={31} height={14} className="brand-mark" />
          </a>{" "}
          · data generated {formatDateTime(initialData.generatedAt, timeZone)}
        </span>
      </footer>
    </main>
  );
}

function LeaderboardPanel({
  standings,
  models,
  settled,
  onSelectModel,
}: {
  standings: ModelStanding[];
  models: Map<string, ModelInfo | undefined>;
  settled: number;
  onSelectModel: (modelKey: string) => void;
}) {
  const maxScore = Math.max(1, ...standings.map((standing) => Math.abs(standing.score)));
  return (
    <div className="leaderboard">
      {standings.map((standing, index) => {
        const model = models.get(standing.modelKey);
        return (
          <button
            key={standing.modelKey}
            type="button"
            className={index === 0 && settled > 0 ? "leader-row is-leading" : "leader-row"}
            onClick={() => onSelectModel(standing.modelKey)}
            title={`Filter fixture board to ${model?.label ?? standing.modelKey}`}
          >
            <span className="leader-rank">{index + 1}</span>
            <span className="leader-id">
              <span className="leader-name">{model?.name ?? standing.modelKey}</span>
              {model?.effort ? <span className="leader-effort">{model.effort}</span> : null}
            </span>
            <span className="leader-score">{formatNumber(standing.score, 1)}</span>
            <span className="leader-bar" aria-hidden>
              <span style={{ width: `${Math.min(100, (Math.abs(standing.score) / maxScore) * 100)}%` }} />
            </span>
            <span className="leader-stats">
              <span>
                {standing.correct}/{standing.completed} correct
              </span>
              <span>acc {formatPct(standing.accuracy)}</span>
              <span>brier {formatNumber(standing.brier, 2)}</span>
            </span>
          </button>
        );
      })}
      {settled === 0 && <p className="leaderboard-empty">Standings appear once the first match settles.</p>}
    </div>
  );
}

function sortPredictionsByModel(predictions: ScoredPrediction[], modelOrder: string[]) {
  const order = new Map(modelOrder.map((key, index) => [key, index]));
  return [...predictions].sort(
    (a, b) => (order.get(a.modelKey) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.modelKey) ?? Number.MAX_SAFE_INTEGER),
  );
}

function MatchBoard({
  matches,
  resultsById,
  predictionsByMatch,
  models,
  modelOrder,
  modelFilter,
  selectedMatchId,
  onSelect,
  timeZone,
}: {
  matches: MatchInfo[];
  resultsById: Map<string, ResultRow>;
  predictionsByMatch: Map<string, ScoredPrediction[]>;
  models: Map<string, ModelInfo | undefined>;
  modelOrder: string[];
  modelFilter: string;
  selectedMatchId: string;
  onSelect: (matchId: string) => void;
  timeZone: string;
}) {
  const sections = useMemo(() => {
    const buckets = new Map<string, MatchInfo[]>();
    for (const match of matches) {
      const key = matchScheduleBucket(match, timeZone);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(match);
    }
    return Array.from(buckets.entries()).map(([key, bucketMatches]) => ({
      key,
      label: formatScheduleBucketLabel(key, bucketMatches[0]),
      round: bucketMatches[0].group ? "" : bucketMatches[0].round,
      matches: bucketMatches,
    }));
  }, [matches, timeZone]);

  const pickModelKeys = modelFilter === "All" ? modelOrder : modelOrder.filter((key) => key === modelFilter);
  const columnCount = 2 + pickModelKeys.length + 1;

  if (!matches.length) {
    return <div className="board-empty">No fixtures match the current filters.</div>;
  }

  return (
    <div className="board-scroll">
      <table className="fixture-table">
        <thead>
          <tr>
            <th scope="col" className="col-when">
              Kickoff
            </th>
            <th scope="col" className="col-fixture">
              Fixture
            </th>
            {pickModelKeys.map((modelKey) => {
              const model = models.get(modelKey);
              return (
                <th key={modelKey} scope="col" className="col-pick" title={model?.label ?? modelKey}>
                  {modelShortName(model, modelKey)}
                </th>
              );
            })}
            <th scope="col" className="col-status">
              Result
            </th>
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => (
            <Fragment key={section.key}>
              <tr className="section-row">
                <td colSpan={columnCount}>
                  <span className="section-date">{section.label}</span>
                  {section.round ? <span className="section-round">{section.round}</span> : null}
                  <span className="section-count">
                    {section.matches.length} {section.matches.length === 1 ? "match" : "matches"}
                  </span>
                </td>
              </tr>
              {section.matches.map((match) => {
                const result = resultsById.get(match.matchId);
                const completed = isCompleted(result);
                const predictions = sortPredictionsByModel(predictionsByMatch.get(match.matchId) ?? [], modelOrder);
                const predictionByModel = new Map(predictions.map((prediction) => [prediction.modelKey, prediction]));

                return (
                  <tr
                    key={match.matchId}
                    className={selectedMatchId === match.matchId ? "match-row active" : "match-row"}
                    onClick={() => onSelect(match.matchId)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelect(match.matchId);
                      }
                    }}
                    tabIndex={0}
                  >
                    <td className="col-when">
                      <span className="match-time">{match.kickoffUtc ? formatTime(match.kickoffUtc, timeZone) : "—"}</span>
                      <span className="match-id">{match.group ? `Group ${match.group}` : `M${match.matchId}`}</span>
                    </td>
                    <td className="col-fixture">
                      <span className={completed && result?.result === "H" ? "team is-winner" : "team"}>{match.teamA}</span>
                      <span className="fixture-mid">
                        {completed ? (
                          <span className="fixture-score">
                            {result?.homeScore}–{result?.awayScore}
                          </span>
                        ) : (
                          <span className="fixture-v">v</span>
                        )}
                      </span>
                      <span className={completed && result?.result === "A" ? "team team-b is-winner" : "team team-b"}>{match.teamB}</span>
                    </td>
                    {pickModelKeys.map((modelKey) => {
                      const prediction = predictionByModel.get(modelKey);
                      if (!prediction) {
                        return (
                          <td key={modelKey} className="col-pick">
                            <span className="pick none">—</span>
                          </td>
                        );
                      }
                      const settledClass = prediction.completed ? (prediction.correct ? " is-correct" : " is-wrong") : "";
                      return (
                        <td key={modelKey} className="col-pick">
                          <span
                            className={`pick${settledClass}`}
                            title={`${models.get(modelKey)?.label ?? modelKey}: ${pickText(prediction)}${
                              prediction.predictedScoreA !== null ? ` ${scoreText(prediction)}` : ""
                            } · conf ${formatPct(prediction.predictedConfidence)}${
                              prediction.completed ? ` · ${formatSigned(prediction.totalPoints)} pts` : ""
                            }`}
                          >
                            <span className="pick-team">{teamShortLabel(pickTeamLabel(prediction, match), 10)}</span>
                            {prediction.predictedScoreA !== null && <span className="pick-score">{scoreText(prediction)}</span>}
                            {prediction.completed && (
                              <span className="pick-points">{formatSigned(prediction.totalPoints)}</span>
                            )}
                          </span>
                        </td>
                      );
                    })}
                    <td className="col-status">
                      {completed ? (
                        <span className="status-final">{result?.status === "FT" ? "FT" : result?.status}</span>
                      ) : (
                        <span className="status-upcoming">{match.kickoffUtc ? "Upcoming" : "TBC"}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatchDetail({
  match,
  result,
  predictions,
  models,
  timeZone,
}: {
  match: MatchInfo;
  result?: ResultRow;
  predictions: ScoredPrediction[];
  models: Map<string, ModelInfo | undefined>;
  timeZone: string;
}) {
  const completed = isCompleted(result);
  return (
    <div className="detail">
      <div className="detail-meta">
        <span>{match.group ? `${match.round} · Group ${match.group}` : match.round}</span>
        {match.kickoffUtc ? <span>{formatDateTime(match.kickoffUtc, timeZone)}</span> : null}
        {completed ? (
          <span className="detail-final">
            Final {result?.homeScore}–{result?.awayScore}
            {result?.winner ? ` · ${result.winner}` : ""}
          </span>
        ) : (
          <span>Not yet played</span>
        )}
      </div>
      <table className="detail-table">
        <thead>
          <tr>
            <th>Model</th>
            <th>Pick</th>
            <th>Score</th>
            <th>Conf</th>
            <th>Pts</th>
          </tr>
        </thead>
        <tbody>
          {predictions.map((prediction) => {
            const settledClass = prediction.completed ? (prediction.correct ? "is-correct" : "is-wrong") : "";
            return (
              <Fragment key={`${prediction.matchId}-${prediction.modelKey}`}>
                <tr className={settledClass}>
                  <td className="detail-model">{models.get(prediction.modelKey)?.name ?? prediction.modelKey}</td>
                  <td className="detail-pick">{teamShortLabel(pickTeamLabel(prediction, match), 14)}</td>
                  <td>{scoreText(prediction)}</td>
                  <td>{formatPct(prediction.predictedConfidence)}</td>
                  <td className="detail-points">
                    {prediction.completed ? (
                      <span title={`result ${formatSigned(prediction.resultPoints, 0)} · confidence ${formatSigned(prediction.confidencePoints)} · scoreline ${formatSigned(prediction.scorelinePoints, 0)}`}>
                        {formatSigned(prediction.totalPoints)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
                <tr className="prob-row" aria-hidden>
                  <td colSpan={5}>
                    <ProbabilityBar prediction={prediction} actual={completed ? result?.result ?? "" : ""} />
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <p className="detail-legend">Bars show each model&apos;s home / draw / away probabilities{completed ? "; the settled outcome is marked" : ""}.</p>
    </div>
  );
}

function ProbabilityBar({ prediction, actual }: { prediction: Prediction; actual: Outcome }) {
  const pH = prediction.probabilityA;
  const pD = prediction.probabilityDraw;
  const pA = prediction.probabilityB;
  if (pH === null || pD === null || pA === null) {
    return <span className="prob-missing">no full probability distribution</span>;
  }
  const total = Math.max(0.0001, pH + pD + pA);
  const segments: Array<{ outcome: Outcome; value: number; label: string }> = [
    { outcome: "H", value: pH / total, label: "home" },
    { outcome: "D", value: pD / total, label: "draw" },
    { outcome: "A", value: pA / total, label: "away" },
  ];
  return (
    <span className="prob-bar">
      {segments.map((segment) => (
        <span
          key={segment.outcome}
          className={`prob-seg prob-${segment.label}${actual && actual === segment.outcome ? " is-actual" : ""}`}
          style={{ width: `${Math.max(2, segment.value * 100)}%` }}
          title={`${segment.label} ${formatPct(segment.value)}`}
        />
      ))}
    </span>
  );
}
