/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // AI: 主题色 — 深色系控制台风格
        bg: {
          primary: '#0f1117',
          secondary: '#1a1d27',
          card: '#1e2130',
          hover: '#252a3a',
        },
        accent: {
          gold: '#f59e0b',
          blue: '#3b82f6',
          green: '#22c55e',
          red: '#ef4444',
          purple: '#8b5cf6',
          cyan: '#06b6d4',
        },
        border: {
          default: '#2d3148',
          active: '#3b4266',
        },
      },
    },
  },
  plugins: [],
}
