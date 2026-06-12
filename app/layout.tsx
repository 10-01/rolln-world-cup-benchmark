import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const siteUrl = "https://worldcupbench.rolln.ai";

const sans = Archivo({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const display = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "World Cup Bench | AI World Cup Prediction Benchmark",
    template: "%s | World Cup Bench",
  },
  description:
    "Track how leading AI models predict World Cup fixtures, compare win/draw/loss picks, confidence, scorelines, and download the raw benchmark data.",
  applicationName: "World Cup Bench",
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
    siteName: "World Cup Bench",
    title: "World Cup Bench | AI World Cup Prediction Benchmark",
    description:
      "A live benchmark dashboard comparing model predictions across World Cup fixtures, confidence, scorelines, and downloadable raw data.",
    images: [
      {
        url: "/assets/rolln-world-cup-bench-logo.png",
        width: 331,
        height: 150,
        alt: "rolln World Cup Bench",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "World Cup Bench | AI World Cup Prediction Benchmark",
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
    <html lang="en" className={`${sans.variable} ${display.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
