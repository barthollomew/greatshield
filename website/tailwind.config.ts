import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: '#0b0b0e',
        foreground: '#e7e7ea',
        accent: '#c6a267',
        border: 'rgba(230, 220, 200, 0.25)',
        'border-hover': 'rgba(230, 220, 200, 0.4)',
      },
      fontFamily: {
        mono: [
          'JetBrains Mono',
          'Fira Code',
          'IBM Plex Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Monaco',
          'Consolas',
          'Liberation Mono',
          'Courier New',
          'monospace'
        ],
      },
      letterSpacing: {
        'wide': '0.1em',
      },
      backgroundImage: {
        'grain': 'url("data:image/svg+xml,%3Csvg width="200" height="200" xmlns="http://www.w3.org/2000/svg"%3E%3Cfilter id="grain"%3E%3CfeTurbulence baseFrequency="0.9" numOctaves="4" stitchTiles="stitch"/%3E%3C/filter%3E%3Crect width="100%25" height="100%25" filter="url(%23grain)" opacity="0.025"/%3E%3C/svg%3E")',
      },
    },
  },
  plugins: [],
}

export default config