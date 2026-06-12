import type { MetadataRoute } from "next";

const siteUrl = "https://worldcupbench.rolln.ai";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    {
      url: siteUrl,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${siteUrl}/rubric`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${siteUrl}/data/normalized-predictions.csv`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.7,
    },
    {
      url: `${siteUrl}/data/bench-data.json`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.6,
    },
  ];
}
