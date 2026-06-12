// Applies the official FIFA World Cup 2026 kickoff schedule to public/data/results.csv.
// Times sourced from the published day-by-day schedule (UK kickoff times converted to UTC, BST = UTC+1).
// Only fills kickoff_utc — never touches status/score columns, so it is safe to rerun at any time.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const RESULTS_PATH = path.join(ROOT, "public", "data", "results.csv");

const KICKOFFS = {
  // Matchday 1
  GA1: "2026-06-11T19:00:00Z",
  GA2: "2026-06-12T02:00:00Z",
  GB1: "2026-06-12T19:00:00Z",
  GD1: "2026-06-13T01:00:00Z",
  GB2: "2026-06-13T19:00:00Z",
  GC1: "2026-06-13T22:00:00Z",
  GC2: "2026-06-14T01:00:00Z",
  GD2: "2026-06-14T04:00:00Z",
  GE1: "2026-06-14T17:00:00Z",
  GF1: "2026-06-14T20:00:00Z",
  GE2: "2026-06-14T23:00:00Z",
  GF2: "2026-06-15T02:00:00Z",
  GH1: "2026-06-15T16:00:00Z",
  GG1: "2026-06-15T19:00:00Z",
  GH2: "2026-06-15T22:00:00Z",
  GG2: "2026-06-16T01:00:00Z",
  GI1: "2026-06-16T19:00:00Z",
  GI2: "2026-06-16T22:00:00Z",
  GJ1: "2026-06-17T01:00:00Z",
  GJ2: "2026-06-17T04:00:00Z",
  GK1: "2026-06-17T17:00:00Z",
  GL1: "2026-06-17T20:00:00Z",
  GL2: "2026-06-17T23:00:00Z",
  GK2: "2026-06-18T02:00:00Z",
  // Matchday 2
  GA3: "2026-06-18T16:00:00Z",
  GB3: "2026-06-18T19:00:00Z",
  GB4: "2026-06-18T22:00:00Z",
  GA4: "2026-06-19T01:00:00Z",
  GD4: "2026-06-19T19:00:00Z",
  GC3: "2026-06-19T22:00:00Z",
  GC4: "2026-06-20T00:30:00Z",
  GD3: "2026-06-20T03:00:00Z",
  GF4: "2026-06-20T17:00:00Z",
  GE4: "2026-06-20T20:00:00Z",
  GE3: "2026-06-21T00:00:00Z",
  GF3: "2026-06-21T04:00:00Z",
  GH4: "2026-06-21T16:00:00Z",
  GG4: "2026-06-21T19:00:00Z",
  GH3: "2026-06-21T22:00:00Z",
  GG3: "2026-06-22T01:00:00Z",
  GJ4: "2026-06-22T17:00:00Z",
  GI4: "2026-06-22T21:00:00Z",
  GI3: "2026-06-23T00:00:00Z",
  GJ3: "2026-06-23T03:00:00Z",
  GK4: "2026-06-23T17:00:00Z",
  GL4: "2026-06-23T20:00:00Z",
  GL3: "2026-06-23T23:00:00Z",
  GK3: "2026-06-24T02:00:00Z",
  // Matchday 3 (simultaneous final group games)
  GB5: "2026-06-24T19:00:00Z",
  GB6: "2026-06-24T19:00:00Z",
  GC5: "2026-06-24T22:00:00Z",
  GC6: "2026-06-24T22:00:00Z",
  GA5: "2026-06-25T01:00:00Z",
  GA6: "2026-06-25T01:00:00Z",
  GE5: "2026-06-25T20:00:00Z",
  GE6: "2026-06-25T20:00:00Z",
  GF5: "2026-06-25T23:00:00Z",
  GF6: "2026-06-25T23:00:00Z",
  GD5: "2026-06-26T02:00:00Z",
  GD6: "2026-06-26T02:00:00Z",
  GI5: "2026-06-26T19:00:00Z",
  GI6: "2026-06-26T19:00:00Z",
  GH5: "2026-06-27T00:00:00Z",
  GH6: "2026-06-27T00:00:00Z",
  GG5: "2026-06-27T03:00:00Z",
  GG6: "2026-06-27T03:00:00Z",
  GL5: "2026-06-27T21:00:00Z",
  GL6: "2026-06-27T21:00:00Z",
  GK5: "2026-06-27T23:30:00Z",
  GK6: "2026-06-27T23:30:00Z",
  GJ5: "2026-06-28T02:00:00Z",
  GJ6: "2026-06-28T02:00:00Z",
  // Round of 32 (FIFA match numbers)
  73: "2026-06-28T19:00:00Z",
  76: "2026-06-29T17:00:00Z",
  74: "2026-06-29T20:30:00Z",
  75: "2026-06-30T01:00:00Z",
  78: "2026-06-30T17:00:00Z",
  77: "2026-06-30T21:00:00Z",
  79: "2026-07-01T01:00:00Z",
  80: "2026-07-01T16:00:00Z",
  82: "2026-07-01T20:00:00Z",
  81: "2026-07-02T00:00:00Z",
  84: "2026-07-02T19:00:00Z",
  83: "2026-07-02T23:00:00Z",
  85: "2026-07-03T03:00:00Z",
  88: "2026-07-03T18:00:00Z",
  86: "2026-07-03T22:00:00Z",
  87: "2026-07-04T01:30:00Z",
  // Round of 16
  90: "2026-07-04T17:00:00Z",
  89: "2026-07-04T21:00:00Z",
  91: "2026-07-05T20:00:00Z",
  92: "2026-07-06T00:00:00Z",
  93: "2026-07-06T19:00:00Z",
  94: "2026-07-07T00:00:00Z",
  95: "2026-07-07T16:00:00Z",
  96: "2026-07-07T20:00:00Z",
  // Quarter-finals
  97: "2026-07-09T20:00:00Z",
  98: "2026-07-10T19:00:00Z",
  99: "2026-07-11T21:00:00Z",
  100: "2026-07-12T01:00:00Z",
  // Semi-finals, third place, final
  101: "2026-07-14T19:00:00Z",
  102: "2026-07-15T19:00:00Z",
  103: "2026-07-18T21:00:00Z",
  104: "2026-07-19T19:00:00Z",
};

const scheduleSize = Object.keys(KICKOFFS).length;
if (scheduleSize !== 104) {
  throw new Error(`Schedule must contain 104 kickoffs, found ${scheduleSize}.`);
}

const lines = fs.readFileSync(RESULTS_PATH, "utf8").trimEnd().split("\n");
const headers = lines[0].split(",");
const kickoffIndex = headers.indexOf("kickoff_utc");
const idIndex = headers.indexOf("match_id");
if (kickoffIndex < 0 || idIndex < 0) throw new Error("results.csv is missing expected columns.");

let applied = 0;
const missing = [];
const updated = lines.map((line, lineIndex) => {
  if (lineIndex === 0) return line;
  const cells = line.split(",");
  const matchId = cells[idIndex];
  const kickoff = KICKOFFS[matchId];
  if (!kickoff) {
    missing.push(matchId);
    return line;
  }
  cells[kickoffIndex] = kickoff;
  applied += 1;
  return cells.join(",");
});

if (missing.length) throw new Error(`No kickoff found for: ${missing.join(", ")}`);
fs.writeFileSync(RESULTS_PATH, `${updated.join("\n")}\n`);
console.log(`Applied kickoff times to ${applied} fixtures.`);
