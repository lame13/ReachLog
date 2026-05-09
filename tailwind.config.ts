import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#121417",
        muted: "#667085",
        line: "#E5E7EB",
        panel: "#F7F8FA",
        accent: "#0F766E",
        amber: "#B45309",
        rose: "#BE123C"
      },
      boxShadow: {
        soft: "0 12px 28px rgba(18, 20, 23, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
