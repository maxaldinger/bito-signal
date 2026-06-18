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
    "Live buying-signal intelligence for Bito AI Architect, the context layer for AI-assisted development — ICP scoring, account prioritization and outreach intel for engineering-heavy targets.",
};

// Applied before paint so a stored "dark" preference never flashes light.
// Light is the default: no stored value (or "light") means no .dark class.
// Static compile-time string — no user input flows into it; it deliberately
// contains no `<`/`&` so React renders it verbatim as an executable script.
const THEME_INIT = `(function(){try{if(localStorage.getItem("bito-theme")==="dark"){document.documentElement.classList.add("dark")}}catch(e){}})()`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script>{THEME_INIT}</script>
      </head>
      <body className="bg-ink-950 text-ink-100 antialiased font-sans">
        {children}
      </body>
    </html>
  );
}
