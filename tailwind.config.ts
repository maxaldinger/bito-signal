import type { Config } from "tailwindcss";

// Bito Signal palette — terminal-meets-premium-SaaS.
// "ink-*" is the surface scale (true dark, with cool desaturated tints).
// "neon-*" is the accent — Bito-leaning electric green, used sparingly.
// "amber/red/violet" remain as semantic signal hues.
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#f5f7fa",   // primary text on dark
          100: "#e3e8ef",  // bright text
          200: "#c4ccd8",  // body text
          300: "#9aa3b2",  // secondary text
          400: "#6b7280",  // muted labels
          500: "#4b5563",  // faint
          600: "#374151",  // hover borders
          700: "#1f2937",  // borders
          800: "#111827",  // card surface (raised)
          900: "#0a0e1a",  // panel
          950: "#05070d",  // app background
        },
        neon: {
          50: "#ecfdf5",
          100: "#d1fae5",
          200: "#a7f3d0",
          300: "#6ee7b7",
          400: "#34d399",  // primary accent (live, hot signal)
          500: "#10b981",  // brand
          600: "#059669",  // darker accent
          700: "#047857",
          800: "#065f46",
          900: "#064e3b",
        },
        signal: {
          hiring: "#34d399",  // emerald — engineering hiring
          oss: "#a78bfa",     // violet — OSS / GitHub activity
          ma: "#f59e0b",      // amber — M&A
          funding: "#38bdf8", // sky — funding rounds
          ai: "#f472b6",      // pink — AI tooling spend / mentions
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["var(--font-jetbrains)", "JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
        "cursor-blink": {
          "0%, 49%": { opacity: "1" },
          "50%, 100%": { opacity: "0" },
        },
        scanline: {
          "0%": { transform: "translateY(0%)" },
          "100%": { transform: "translateY(100%)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.4s ease-out forwards",
        "pulse-dot": "pulse-dot 2s ease-in-out infinite",
        "cursor-blink": "cursor-blink 1.1s steps(1) infinite",
        "scanline": "scanline 6s linear infinite",
      },
      boxShadow: {
        glow: "0 0 24px -6px rgba(16, 185, 129, 0.45)",
        "glow-sm": "0 0 12px -3px rgba(16, 185, 129, 0.4)",
      },
    },
  },
  plugins: [],
};

export default config;
