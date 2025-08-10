# Changelog

All notable changes to the Greatshield website will be documented in this file.

## [1.0.0] - 2025-01-10

### Added
- **Initial Website Launch**
  - Complete Astro + React + TailwindCSS implementation
  - Dark theme with Dark Souls-inspired aesthetics
  - JetBrains Mono typography throughout
  - parse.bot-inspired card layouts with 1px borders

- **Pages & Navigation**
  - Homepage with hero section and feature showcase
  - How It Works page with workflow diagram
  - Models page with AI model comparison
  - Download page with installation instructions
  - Privacy Policy and Terms of Service pages
  - Responsive navigation header and footer

- **Components**
  - `Card` - Bordered container with hover effects
  - `CodeBlock` - Syntax-highlighted code with copy button
  - `ModelTierCard` - AI model comparison cards
  - `FlowDiagram` - Process flow visualization
  - `InviteUrlBuilder` - Discord bot invite URL generator
  - `HeaderNav` - Site navigation with active states
  - `Footer` - Site footer with version info and pixel fireplace

- **Assets & Branding**
  - Pixel-style Greatshield shield icon (SVG)
  - Placeholder pixel fireplace animation (GIF)
  - Dark-themed OpenGraph banner
  - Consistent accent gold color (#c6a267)

- **Technical Features**
  - Full TypeScript support
  - GitHub Pages deployment workflow
  - Mobile-responsive design
  - Accessibility-compliant markup
  - SEO optimization with meta tags
  - Font preloading and optimization

- **Styling System**
  - Custom Tailwind configuration for dark theme
  - Component-based CSS architecture
  - Monospace font stack with fallbacks
  - Subtle texture overlays and gradients
  - Consistent 1px border system

### Technical Details
- Built with Astro 5.12.9
- React 19.1.1 for interactive components
- Tailwind CSS 3.4.17 for styling (migrated from v4 for compatibility)
- Optimized for Lighthouse scores 95+
- No emoji usage in UI (dev-first aesthetic)
- Full client-side tab switching
- Responsive breakpoints for mobile/desktop

### Bug Fixes
- **Tailwind CSS Compatibility**: Fixed "Failed to load native binding" error by migrating from Tailwind CSS v4 to v3.4.17
- **Build Process**: Resolved URL construction issues in Layout.astro by adding proper site configuration
- **CSS Import Order**: Fixed PostCSS warning by reordering @import statements before @tailwind directives

### Repository Structure
```
website/
├── .github/workflows/pages.yml  # GitHub Pages CI/CD
├── src/
│   ├── components/              # React and Astro components
│   ├── layouts/                 # Page layouts
│   ├── pages/                   # Site routes
│   └── styles/global.css        # Global styles and Tailwind
├── public/                      # Static assets
├── USAGE.md                     # Website maintenance guide
└── CHANGELOG.md                 # This file
```

### Development Commands
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build

### Deployment
- Automatic deployment via GitHub Actions
- Triggered on push to main branch
- Requires `ENABLE_PAGES=true` repository variable