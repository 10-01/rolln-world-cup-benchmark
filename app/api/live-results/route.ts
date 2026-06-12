import { NextRequest, NextResponse } from "next/server";
import { getResolvedResults, persistSnapshot } from "../../../src/lib/resolve-results";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const isCron = url.searchParams.has("cron") || url.searchParams.get("snapshot") === "1";
  const forceFresh = url.searchParams.has("force") || url.searchParams.get("force") === "1";

  if (isCron) {
    // Vercel cron (or manual trigger) — force a fresh resolve + persist the snapshot.
    const result = await persistSnapshot();
    return NextResponse.json(
      {
        ok: result.ok,
        source: "cron",
        updatedAt: result.updatedAt,
        count: result.count,
        error: result.error,
      },
      { status: 200 }
    );
  }

  // Normal request: getResolvedResults will prefer a recent durable snapshot
  // (no football API call) when available, otherwise live-resolve.
  // ?force=1 bypasses the snapshot (useful for manual "refresh live now").
  const resolved = await getResolvedResults({ forceFresh });

  const cacheSeconds = resolved.source === "snapshot" && !forceFresh ? 60 : 45;

  return NextResponse.json(
    {
      ok: !resolved.error,
      results: resolved.results,
      source: resolved.source,
      updatedAt: resolved.updatedAt,
      snapshotAt: resolved.snapshotAt,
      error: resolved.error,
    },
    {
      status: 200,
      headers: {
        // Short edge cache. The real durability comes from the KV snapshot written by cron.
        "Cache-Control": `s-maxage=${cacheSeconds}, stale-while-revalidate=300`,
      },
    }
  );
}
