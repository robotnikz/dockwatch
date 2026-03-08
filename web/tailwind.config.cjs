/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        dock: {
          bg: 'rgb(var(--dock-bg) / <alpha-value>)',
          card: 'rgb(var(--dock-card) / <alpha-value>)',
          panel: 'rgb(var(--dock-panel) / <alpha-value>)',
          border: 'rgb(var(--dock-border) / <alpha-value>)',
          accent: 'rgb(var(--dock-accent) / <alpha-value>)',
          accentSoft: 'rgb(var(--dock-accent-soft) / <alpha-value>)',
          green: 'rgb(var(--dock-green) / <alpha-value>)',
          red: 'rgb(var(--dock-red) / <alpha-value>)',
          yellow: 'rgb(var(--dock-yellow) / <alpha-value>)',
          text: 'rgb(var(--dock-text) / <alpha-value>)',
          muted: 'rgb(var(--dock-muted) / <alpha-value>)',
        },
      },
      boxShadow: {
        dock: '0 20px 60px rgba(7, 12, 14, 0.22)',
      },
    },
  },
  plugins: [],
};
