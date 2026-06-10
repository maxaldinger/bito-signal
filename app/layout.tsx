import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Bito Signal | SWE-Heavy Account Intelligence",
  description:
    "Live buying-signal intelligence for Bito's AI code-review platform — ICP scoring, account prioritization and outreach intel for engineering-heavy targets.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="bg-ink-950 text-ink-100 antialiased font-sans">
        {children}
      </body>
    </html>
  );
}
