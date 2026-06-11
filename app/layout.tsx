import type { Metadata } from "next";
import "./globals.css";

const siteUrl = "https://worldcupbench.rolln.ai";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "world-cup-bench | World Cup Prediction Model Benchmark",
    template: "%s | world-cup-bench",
  },
  description:
    "Track how leading AI models predict World Cup fixtures, compare win/draw/loss picks, confidence, scorelines, and download the raw benchmark data.",
  applicationName: "world-cup-bench",
  keywords: [
    "World Cup benchmark",
    "World Cup predictions",
    "AI model benchmark",
    "football prediction models",
    "Fable 5",
    "Gemini 3.1 Pro",
    "GPT-5.5",
    "grok-build-0.1",
    "Composer 2.5",
  ],
  authors: [{ name: "rolln" }],
  creator: "rolln",
  publisher: "rolln",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "world-cup-bench",
    title: "world-cup-bench | World Cup Prediction Model Benchmark",
    description:
      "A live benchmark dashboard comparing model predictions across World Cup fixtures, confidence, scorelines, and downloadable raw data.",
    images: [
      {
        url: "/assets/rolln-world-cup-bench-logo.png",
        width: 331,
        height: 150,
        alt: "rolln world-cup-bench",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "world-cup-bench | World Cup Prediction Model Benchmark",
    description: "Compare World Cup predictions from five AI models across every fixture.",
    images: ["/assets/rolln-world-cup-bench-logo.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
