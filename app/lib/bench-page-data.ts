import benchData from "../../public/data/bench-data.json";
import type { BenchData } from "../components/Dashboard";

async function getInitialLiveResults() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch("/api/live-results", {
      next: { revalidate: 75 },
      signal: controller.signal,
    });
    const json = await res.json();
    if (json?.ok && Array.isArray(json.results) && json.results.length) {
      return json.results;
    }
  } catch {}
  finally {
    clearTimeout(timeoutId);
  }
  return null;
}

export async function getBenchPageData(): Promise<BenchData> {
  const staticData = benchData as BenchData;
  const liveResults = await getInitialLiveResults();
  return liveResults ? { ...staticData, results: liveResults } : staticData;
}