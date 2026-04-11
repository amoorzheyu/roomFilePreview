/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        abyss: '#050507',
        carbon: '#101010',
        'warm-charcoal': '#3d3a39',
        signal: '#00d992',
        mint: '#2fd6a1',
        snow: '#f2f2f2',
        parchment: '#b8b3b0',
        steel: '#8b949e',
        danger: '#fb565b',
        'danger-bg': 'rgba(251, 86, 91, 0.12)',
        'danger-border': 'rgba(251, 86, 91, 0.35)',
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
        mono: [
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'Liberation Mono',
          'Courier New',
          'monospace',
        ],
      },
      boxShadow: {
        ambient: '0 0 15px rgba(92, 88, 85, 0.2)',
        dramatic: '0 20px 60px rgba(0, 0, 0, 0.7), inset 0 0 0 1px rgba(148, 163, 184, 0.1)',
      },
    },
  },
  plugins: [],
}
