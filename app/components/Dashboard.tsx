"use client";

import {
  Activity,
  ArrowDownToLine,
  CircleDot,
  Database,
  Download,
  Filter,
  Gauge,
  RefreshCw,
  Search,
  Table2,
  Trophy,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  MatchInfo,
  ModelInfo,
  ModelStanding,
  Outcome,
  Prediction,
  ResultRow,
  ScoredPrediction,
  outcomeLabel,
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

type Tab = "overview" | "matches" | "models" | "rubric" | "data";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "matches", label: "Matches" },
  { key: "models", label: "Models" },
  { key: "rubric", label: "Rubric" },
  { key: "data", label: "Data" },
];

const OUTCOME_BADGES: Record<Outcome, string> = {
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

function formatPct(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

function formatDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatBytes(bytes: number) {
  if (bytes > 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes > 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

function modelByKey(models: ModelInfo[]) {
  return new Map(models.map((model) => [model.key, model]));
}

function isCompleted(result?: ResultRow) {
  return Boolean(result && result.result && result.status !== "scheduled");
}

function resultLabel(result?: ResultRow) {
  if (!result || !isCompleted(result)) return "Scheduled";
  return `${result.teamA} ${result.homeScore}–${result.awayScore} ${result.teamB}`;
}

function pickText(prediction: Prediction) {
  if (prediction.predictedOutcome === "D") return "Draw";
  return prediction.predictedWinner || OUTCOME_BADGES[prediction.predictedOutcome];
}

function scoreText(prediction: Prediction) {
  if (prediction.predictedScoreA === null || prediction.predictedScoreB === null) return "—";
  return `${prediction.predictedScoreA}–${prediction.predictedScoreB}`;
}

export function Dashboard({ initialData }: { initialData: BenchData }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [query, setQuery] = useState("");
  const [roundFilter, setRoundFilter] = useState("All");
  const [groupFilter, setGroupFilter] = useState("All");
  const [modelFilter, setModelFilter] = useState("All");
  const [selectedMatchId, setSelectedMatchId] = useState(initialData.matches[0]?.matchId ?? "");
  const [liveResults, setLiveResults] = useState<ResultRow[] | null>(null);
  const [liveStatus, setLiveStatus] = useState<"idle" | "loading" | "ready" | "unconfigured" | "error">("idle");

  useEffect(() => {
    let cancelled = false;
    setLiveStatus("loading");
    fetch("/api/live-results")
      .then((response) => response.json())
      .then((payload) => {
        if (cancelled) return;
        if (!payload.ok) {
          setLiveStatus("unconfigured");
          return;
        }
        if (Array.isArray(payload.results) && payload.results.length) {
          const staticById = new Map(initialData.results.map((result) => [result.matchId, result]));
          for (const result of payload.results) {
            staticById.set(result.matchId, result);
          }
          setLiveResults(Array.from(staticById.values()));
        }
        setLiveStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setLiveStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [initialData.results]);

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

  const rounds = useMemo(() => ["All", ...Array.from(new Set(initialData.matches.map((match) => match.round)))], [initialData.matches]);
  const groups = useMemo(() => ["All", ...Array.from(new Set(initialData.matches.map((match) => match.group).filter(Boolean)))], [initialData.matches]);
  const completedCount = results.filter(isCompleted).length;
  const fullProbabilityCount = initialData.predictions.filter((prediction) => prediction.probabilitySource === "full_1x2").length;
  const imputedCount = initialData.predictions.filter((prediction) => prediction.probabilitySource === "imputed_from_single_likelihood").length;
  const leaderLabel = completedCount > 0 && standings[0] ? modelsMap.get(standings[0].modelKey)?.label ?? standings[0].modelKey : "All models";

  const filteredMatches = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();
    return initialData.matches
      .filter((match) => roundFilter === "All" || match.round === roundFilter)
      .filter((match) => groupFilter === "All" || match.group === groupFilter)
      .filter((match) => {
        if (!cleanQuery) return true;
        return `${match.matchId} ${match.round} ${match.group} ${match.teamA} ${match.teamB}`.toLowerCase().includes(cleanQuery);
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [groupFilter, initialData.matches, query, roundFilter]);

  useEffect(() => {
    if (!filteredMatches.length) return;
    if (!filteredMatches.some((match) => match.matchId === selectedMatchId)) {
      setSelectedMatchId(filteredMatches[0].matchId);
    }
  }, [filteredMatches, selectedMatchId]);

  const selectedMatch = initialData.matches.find((match) => match.matchId === selectedMatchId) ?? filteredMatches[0] ?? initialData.matches[0];
  const selectedPredictions = selectedMatch ? predictionsByMatch.get(selectedMatch.matchId) ?? [] : [];
  const selectedResult = selectedMatch ? resultsById.get(selectedMatch.matchId) : undefined;
  const maxScore = Math.max(1, ...standings.map((standing) => Math.abs(standing.score)));

  return (
    <main className="shell">
      <header className="masthead">
        <div className="brand-block">
          <div className="logo-lockup">
            <img src="/assets/rolln-world-cup-bench-logo.png" alt="rolln" />
            <span>104 fixtures</span>
          </div>
          <div>
            <p className="eyebrow">World Cup prediction benchmark</p>
            <h1>world-cup-bench</h1>
          </div>
        </div>
        <div className="header-actions">
          <a className="icon-link" href="/data/normalized-predictions.csv" title="Download normalized predictions">
            <Download size={18} />
            Normalized CSV
          </a>
          <a className="icon-link accent" href="/data/results.csv" title="Download results template">
            <ArrowDownToLine size={18} />
            Results CSV
          </a>
        </div>
      </header>

      <section className="stat-grid" aria-label="Benchmark status">
        <StatusCard label="Bench points leader" value={leaderLabel} detail={formatNumber(standings[0]?.score ?? 0, 1)} icon={<Trophy size={18} />} />
        <StatusCard label="Completed fixtures" value={`${completedCount}`} detail={`${initialData.matches.length} tracked`} icon={<CircleDot size={18} />} />
        <StatusCard label="Normalized predictions" value={`${initialData.predictions.length}`} detail={`${fullProbabilityCount} full 1X2`} icon={<Table2 size={18} />} />
        <StatusCard label="Live results" value={liveStatus === "ready" ? "Ready" : liveStatus === "unconfigured" ? "Static" : liveStatus === "loading" ? "Checking" : "Static"} detail={liveStatus === "ready" ? "API-Football" : "results.csv"} icon={<Activity size={18} />} />
      </section>

      <nav className="tabs" aria-label="Dashboard sections">
        {TABS.map((item) => (
          <button key={item.key} className={tab === item.key ? "tab active" : "tab"} onClick={() => setTab(item.key)}>
            {item.label}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="layout-grid">
          <section className="panel leaderboard-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Leaderboard</p>
                <h2>Bench Points</h2>
              </div>
              <Gauge size={22} />
            </div>
            <div className="leaderboard">
              {standings.map((standing, index) => {
                const model = modelsMap.get(standing.modelKey);
                return (
                  <button key={standing.modelKey} className="leader-row" onClick={() => setModelFilter(standing.modelKey)}>
                    <span className="rank">{String(index + 1).padStart(2, "0")}</span>
                    <span className="leader-main">
                      <strong>{model?.label ?? standing.modelKey}</strong>
                      <span>{standing.completed} completed / {standing.correct} correct</span>
                    </span>
                    <span className="score-block">
                      <strong>{formatNumber(standing.score, 1)}</strong>
                      <span>{formatPct(standing.accuracy)}</span>
                    </span>
                    <span className="score-rail">
                      <span style={{ width: `${Math.min(100, (Math.abs(standing.score) / maxScore) * 100)}%` }} />
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Selected fixture</p>
                <h2>{selectedMatch ? `${selectedMatch.teamA} vs ${selectedMatch.teamB}` : "—"}</h2>
              </div>
              <button className="icon-only" onClick={() => setTab("matches")} title="Open match board">
                <Table2 size={18} />
              </button>
            </div>
            {selectedMatch && (
              <MatchDetail
                match={selectedMatch}
                result={selectedResult}
                predictions={selectedPredictions}
                models={modelsMap}
              />
            )}
          </section>
        </div>
      )}

      {tab === "matches" && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Match board</p>
              <h2>Predictions by game</h2>
            </div>
            <Filter size={22} />
          </div>

          <div className="filters">
            <label className="search-field">
              <Search size={17} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search team or match" />
            </label>
            <select value={roundFilter} onChange={(event) => setRoundFilter(event.target.value)}>
              {rounds.map((round) => (
                <option key={round}>{round}</option>
              ))}
            </select>
            <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}>
              {groups.map((group) => (
                <option key={group}>{group}</option>
              ))}
            </select>
            <select value={modelFilter} onChange={(event) => setModelFilter(event.target.value)}>
              <option value="All">All models</option>
              {models.map((model) => (
                <option key={model.key} value={model.key}>
                  {model.label}
                </option>
              ))}
            </select>
          </div>

          <div className="match-grid">
            <div className="match-list">
              {filteredMatches.map((match) => {
                const result = resultsById.get(match.matchId);
                const predictions = (predictionsByMatch.get(match.matchId) ?? []).filter((prediction) => modelFilter === "All" || prediction.modelKey === modelFilter);
                return (
                  <button key={match.matchId} className={selectedMatch?.matchId === match.matchId ? "match-row active" : "match-row"} onClick={() => setSelectedMatchId(match.matchId)}>
                    <span className="match-id">{match.matchId}</span>
                    <span className="match-meta">
                      <strong>{match.teamA} vs {match.teamB}</strong>
                      <span>{match.group ? `Group ${match.group}` : match.round} · {resultLabel(result)}</span>
                    </span>
                    <span className="pick-strip">
                      {predictions.map((prediction) => (
                        <span key={prediction.modelKey} className={`mini-pick outcome-${prediction.predictedOutcome || "none"}`} title={`${modelsMap.get(prediction.modelKey)?.label}: ${pickText(prediction)}`}>
                          {prediction.predictedOutcome || "—"}
                        </span>
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
            {selectedMatch && (
              <div className="match-detail-column">
                <MatchDetail
                  match={selectedMatch}
                  result={selectedResult}
                  predictions={selectedPredictions.filter((prediction) => modelFilter === "All" || prediction.modelKey === modelFilter)}
                  models={modelsMap}
                />
              </div>
            )}
          </div>
        </section>
      )}

      {tab === "models" && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Model data</p>
              <h2>Coverage and structure</h2>
            </div>
            <Database size={22} />
          </div>
          <div className="model-quality-grid">
            {models.map((model) => {
              const modelPredictions = initialData.predictions.filter((prediction) => prediction.modelKey === model.key);
              const report = initialData.normalizationReport.find((item) => item.modelKey === model.key);
              const full = modelPredictions.filter((prediction) => prediction.probabilitySource === "full_1x2").length;
              const parsed = modelPredictions.filter((prediction) => prediction.probabilitySource === "parsed_1x2_from_detail" || prediction.probabilitySource === "winner_draw_reconstructed").length;
              const imputed = modelPredictions.filter((prediction) => prediction.probabilitySource === "imputed_from_single_likelihood").length;
              const unaligned = modelPredictions.filter((prediction) => prediction.probabilitySource === "full_1x2_unaligned_matchup").length;
              return (
                <article key={model.key} className="quality-row">
                  <div>
                    <h3>{model.label}</h3>
                    <p>{modelPredictions.length} normalized match predictions</p>
                  </div>
                  <div className="quality-bars">
                    <QualityBar label="Full 1X2" value={full} total={modelPredictions.length} />
                    <QualityBar label="Parsed" value={parsed} total={modelPredictions.length} />
                    <QualityBar label="Imputed" value={imputed} total={modelPredictions.length} />
                    <QualityBar label="Unaligned" value={unaligned} total={modelPredictions.length} />
                  </div>
                  <p className="warning-text">{report?.warnings.length ? `${report.warnings.length} non-match rows ignored` : "No normalization warnings"}</p>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {tab === "rubric" && (
        <section className="panel rubric-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Scoring</p>
              <h2>{initialData.rubric.primaryScore}</h2>
            </div>
            <RefreshCw size={22} />
          </div>
          <div className="rubric-grid">
            {initialData.rubric.perCompletedMatch.map((item) => (
              <article key={item.component} className="rubric-item">
                <span>{item.points}</span>
                <h3>{item.component}</h3>
                <p>{item.rule}</p>
              </article>
            ))}
          </div>
          <div className="metric-list">
            {initialData.rubric.secondaryMetrics.map((metric) => (
              <p key={metric}>{metric}</p>
            ))}
            <p>{initialData.rubric.confidencePolicy}</p>
          </div>
        </section>
      )}

      {tab === "data" && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Raw data</p>
              <h2>Downloads</h2>
            </div>
            <Download size={22} />
          </div>
          <div className="download-grid">
            <DownloadLink label="Normalized predictions" href="/data/normalized-predictions.csv" detail={`${initialData.predictions.length} rows`} />
            <DownloadLink label="Results template" href="/data/results.csv" detail={`${initialData.matches.length} rows`} />
            <DownloadLink label="Scoring rubric" href="/data/scoring-rubric.json" detail={`version ${initialData.rubric.version}`} />
            <DownloadLink label="Prediction schema" href="/data/prediction-schema.md" detail="CSV prompt shape" />
            <DownloadLink label="Benchmark bundle" href="/data/bench-data.json" detail={formatDate(initialData.generatedAt)} />
            {initialData.rawFiles.map((file) => (
              <DownloadLink key={file.href} label={file.label} href={file.href} detail={formatBytes(file.bytes)} />
            ))}
          </div>
        </section>
      )}

      <footer className="footer-line">
        <span>Generated {formatDate(initialData.generatedAt)}</span>
        <span>{imputedCount} predictions use imputed 1X2 probabilities for secondary metrics.</span>
      </footer>
    </main>
  );
}

function StatusCard({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: React.ReactNode }) {
  return (
    <article className="stat-card">
      <div className="stat-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function MatchDetail({
  match,
  result,
  predictions,
  models,
}: {
  match: MatchInfo;
  result?: ResultRow;
  predictions: ScoredPrediction[];
  models: Map<string, ModelInfo | undefined>;
}) {
  return (
    <div className="detail-block">
      <div className="fixture-line">
        <span>{match.matchId}</span>
        <strong>{match.teamA} vs {match.teamB}</strong>
        <span>{match.group ? `Group ${match.group}` : match.round}</span>
        <span>{resultLabel(result)}</span>
      </div>
      <div className="prediction-table">
        <div className="prediction-header">
          <span>Model</span>
          <span>Pick</span>
          <span>W/D/L</span>
          <span>Score</span>
          <span>Conf.</span>
          <span>Pts</span>
        </div>
        {predictions.map((prediction) => (
          <div key={`${prediction.matchId}-${prediction.modelKey}`} className="prediction-row">
            <span>{models.get(prediction.modelKey)?.label ?? prediction.modelKey}</span>
            <strong>{pickText(prediction)}</strong>
            <span className={`outcome-pill outcome-${prediction.predictedOutcome || "none"}`}>{outcomeLabel(prediction.predictedOutcome)}</span>
            <span>{scoreText(prediction)}</span>
            <span>{formatPct(prediction.predictedConfidence)}</span>
            <span>{prediction.completed ? formatNumber(prediction.totalPoints, 1) : "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function QualityBar({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total ? (value / total) * 100 : 0;
  return (
    <div className="quality-bar">
      <span>{label}</span>
      <div>
        <i style={{ width: `${pct}%` }} />
      </div>
      <strong>{value}</strong>
    </div>
  );
}

function DownloadLink({ label, href, detail }: { label: string; href: string; detail: string }) {
  return (
    <a className="download-link" href={href}>
      <Download size={18} />
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
    </a>
  );
}
