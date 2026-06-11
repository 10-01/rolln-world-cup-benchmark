# world-cup-bench prediction schema

Use this CSV shape for future model runs:

```csv
record_type,match_id,phase,round,group,team_a,team_b,predicted_score,predicted_winner,team_a_win_prob,draw_prob,team_b_win_prob,likelihood,model_name,notes
```

Rules:

- `record_type` should be `match` for every scored fixture.
- `match_id` should match `public/data/results.csv`, for example `GA1` or `104`.
- `team_a` and `team_b` should use the teams in the match slot.
- `predicted_score` should be regulation score for group matches and projected final score for knockout matches.
- `predicted_winner` should be `Draw`, `team_a`, or `team_b` for group matches. For knockouts, use the advancing or winning team.
- `team_a_win_prob`, `draw_prob`, and `team_b_win_prob` should sum to `1.0` for regulation-time W/D/L.
- `likelihood` should be the probability assigned to `predicted_winner`.
