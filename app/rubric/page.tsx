import type { Metadata } from "next";
import { Dashboard } from "../components/Dashboard";
import { getBenchPageData } from "../lib/bench-page-data";

export const metadata: Metadata = {
  title: "Rubric",
  description: "Scoring rubric and secondary metrics for World Cup Bench, the AI World Cup prediction benchmark.",
  alternates: { canonical: "/rubric" },
};

export default async function RubricPage() {
  const data = await getBenchPageData();
  return <Dashboard initialData={data} tab="rubric" />;
}