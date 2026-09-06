/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Backed by CSS variables (see :root / :root.dark in index.css) so
        // the same class names (bg-surface, text-muted, border-border, etc.)
        // work in both themes — the value swaps, the classes don't.
        // rgb(var(...) / <alpha-value>) preserves Tailwind's opacity
        // modifiers (bg-surface/30 etc.), which are used throughout.
        bg: 'rgb(var(--color-bg) / <alpha-value>)',
        surface: 'rgb(var(--color-surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--color-surface-2) / <alpha-value>)',
        'surface-3': 'rgb(var(--color-surface-3) / <alpha-value>)',
        accent: 'rgb(var(--color-accent) / <alpha-value>)',
        'accent-dim': 'rgb(var(--color-accent-dim) / <alpha-value>)',
        'accent-glow': 'rgb(var(--color-accent) / 0.15)',
        muted: 'rgb(var(--color-muted) / <alpha-value>)',
        border: 'rgb(var(--color-border) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
