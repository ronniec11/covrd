/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: '#111210',
        surface: '#1c1c1a',
        'surface-2': '#252523',
        'surface-3': '#2e2e2b',
        accent: '#4ade80',
        'accent-dim': '#22c55e',
        'accent-glow': 'rgba(74,222,128,0.15)',
        muted: '#6b7280',
        border: '#2e2e2b',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
