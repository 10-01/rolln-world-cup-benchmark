import { Dashboard } from "./components/Dashboard";
import { getBenchPageData } from "./lib/bench-page-data";

const siteUrl = "https://worldcupbench.rolln.ai";

export default async function Home() {
  const data = await getBenchPageData();

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "world-cup-bench",
    url: siteUrl,
    applicationCategory: "SportsApplication",
    operatingSystem: "Web",
    description:
      "A benchmark dashboard comparing AI model predictions for World Cup fixtures, including win/draw/loss picks, confidence, scorelines, and raw downloadable data.",
    publisher: {
      "@type": "Organization",
      name: "rolln",
      url: "https://rolln.ai",
    },
    mainEntity: {
      "@type": "Dataset",
      name: "world-cup-bench normalized predictions",
      description: `${data.predictions.length} normalized predictions across ${data.matches.length} World Cup fixtures from ${data.models.length} AI models.`,
      url: `${siteUrl}/data/normalized-predictions.csv`,
      distribution: [
        {
          "@type": "DataDownload",
          encodingFormat: "text/csv",
          contentUrl: `${siteUrl}/data/normalized-predictions.csv`,
        },
        {
          "@type": "DataDownload",
          encodingFormat: "application/json",
          contentUrl: `${siteUrl}/data/bench-data.json`,
        },
      ],
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <Dashboard initialData={data} tab="overview" />
    </>
  );
}