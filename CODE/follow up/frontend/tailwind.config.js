/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        sovereign: {
          950: "#09090b",
          900: "#121214",
          800: "#1a1a1e",
          700: "#27272a",
          600: "#3f3f46",
          accent: "#a1a1aa",
          "accent-hover": "#d4d4d8",
          "accent-light": "#71717a",
          success: "#52525b",
          warning: "#a1a1aa",
          danger: "#ef4444",
        },
      },
      fontFamily: {
        sans: ["Outfit", "Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
    },
  },
  plugins: [],
};
