# world-cup-bench

A live benchmark of frontier AI models predicting the **2026 FIFA World Cup** — built by [rolln](https://rolln.ai), live at [worldcupbench.rolln.ai](https://worldcupbench.rolln.ai).

Before the opening match, five models each predicted all 104 fixtures — winner, scoreline, and win/draw/loss probabilities. Their picks are locked. As full-time results come in, points settle and the leaderboard updates automatically.

**The field:** Fable 5 · Gemini 3.1 Pro · gpt-5.5 · grok-build-0.1 · Composer 2.5

## Scoring

Per completed match (full rubric at [/rubric](https://worldcupbench.rolln.ai/rubric)):

| Component | Points |
|---|---|
| Correct result / advancing team | 10 |
| Confidence adjustment | ±5 × stated confidence |
| Scoreline (exact = 5; partial credit for goal diff, total, implied result) | 0–5 |

Secondary metrics: accuracy, Brier score, log loss, exact-score count. Knockout predictions were made against one shared hypothetical bracket; when the real teams differ, winner picks are scored by name and scoreline/Brier are excluded for that match.

## How it works

- `predictions/*.csv` — each model's raw, locked predictions
- `public/data/results.csv` — canonical kickoff schedule and finals (one row per match)
- `scripts/prepare-data.mjs` — normalizes predictions + results into `public/data/bench-data.json`
- A GitHub Action (and a Vercel cron) fetches finals from API-Football every 30 minutes; scoring re-runs in the browser against the latest results, so standings move the moment a final lands

No API key? The dashboard runs entirely from `results.csv` — set a match's `status`, scores, `result`, and `winner` to register a final manually.

## Develop

```bash
npm install
npm run prepare-data   # rebuild bench-data.json from predictions + results
npm run dev
```

Optional env (see `.env.example`): `API_FOOTBALL_KEY` for live results, `REDIS_URL` for durable snapshots.

## Data downloads

Normalized predictions and full benchmark data are exported at [`/data/normalized-predictions.csv`](https://worldcupbench.rolln.ai/data/normalized-predictions.csv) and [`/data/bench-data.json`](https://worldcupbench.rolln.ai/data/bench-data.json).
