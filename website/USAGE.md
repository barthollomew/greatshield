# Greatshield Website Usage Guide

This guide covers how to maintain and customize the Greatshield landing website.

## Development

### Local Development
```bash
# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Project Structure
```
website/
├── src/
│   ├── components/     # React components and Astro components
│   ├── layouts/        # Layout templates
│   ├── pages/          # Site pages (routing)
│   └── styles/         # CSS and styling
├── public/             # Static assets
└── dist/               # Built site (generated)
```

## Customization

### Update Repository Links
1. **Header Navigation**: Edit `src/components/HeaderNav.astro`
   - Change GitHub URL in the header button
   
2. **Footer**: Edit `src/components/Footer.astro`
   - Update GitHub link in footer

3. **Download Page**: Edit `src/pages/download.astro`
   - Update binary download URLs
   - Modify release links

### Replace Pixel Art Assets

#### Shield Icon (`/public/pixel-greatshield.svg`)
- Current: Simple pixel-style shield with cross
- Replace with your own 128x128 SVG design
- Ensure it works at small sizes (16x16, 32x32)
- Keep the accent color (#c6a267) or update CSS variables

#### Fireplace GIF (`/public/pixel-fireplace.gif`)
- Current: Placeholder GIF
- Replace with animated pixel fireplace (8-12 frames)
- Keep file size under 60KB for performance
- Recommended dimensions: 64x48 or 80x60 pixels

#### OpenGraph Image (`/public/opengraph-temp.svg`)
- Current: Simple text-based banner
- Replace with 1200x630 branded image
- Should work well as social media preview
- Export as PNG for better compatibility

### Update Discord Permissions

Edit `src/components/InviteUrlBuilder.tsx`:

```typescript
// Update default permission bits
const [permissions, setPermissions] = useState('YOUR_PERMISSION_INTEGER');

// Modify permission list display
const permissionsList = [
  { bit: '2048', name: 'Read Message History', enabled: true },
  // Add/remove permissions as needed
];
```

Common Discord Permission Values:
- Read Message History: 2048
- Send Messages: 2048  
- Manage Messages: 8192
- Use Slash Commands: 2147483648
- Manage Roles: 268435456

### Switch Fonts

If JetBrains Mono is unavailable:

1. **Update Tailwind Config** (`tailwind.config.ts`):
```typescript
fontFamily: {
  mono: [
    'YOUR_PREFERRED_FONT',
    'Fira Code',
    'IBM Plex Mono',
    // ... fallbacks
  ],
},
```

2. **Update CSS** (`src/styles/global.css`):
```css
@import url('GOOGLE_FONTS_URL_FOR_YOUR_FONT');
```

3. **Popular Monospace Alternatives**:
   - Fira Code (has ligatures)
   - Source Code Pro
   - IBM Plex Mono
   - Inconsolata
   - Roboto Mono

### Modify Color Scheme

Edit `tailwind.config.ts` to change the dark theme colors:

```typescript
colors: {
  background: '#0b0b0e',    // Main background
  foreground: '#e7e7ea',    // Text color
  accent: '#c6a267',        // Gold accent
  border: 'rgba(230, 220, 200, 0.25)',
  'border-hover': 'rgba(230, 220, 200, 0.4)',
},
```

### Content Updates

#### Policy Information
- **Models page**: Update model recommendations and specs
- **How it Works**: Modify workflow descriptions
- **Privacy/Terms**: Update legal content for your deployment

#### Feature Descriptions
- **Homepage features**: Edit feature cards and descriptions
- **Performance specs**: Update timing and resource requirements
- **System requirements**: Modify hardware recommendations

## Deployment

### GitHub Pages
1. Set repository variable `ENABLE_PAGES=true`
2. Enable Pages in repo settings
3. Push to main branch triggers automatic deployment

### Custom Domain
1. Add `CNAME` file to `/public/` with your domain
2. Configure DNS CNAME record pointing to `username.github.io`
3. Enable HTTPS in Pages settings

### Manual Deployment
```bash
# Build the site
npm run build

# Deploy dist/ folder to your hosting provider
# Files are in website/dist/
```

## Performance Optimization

### Image Optimization
- Compress pixel art assets
- Use WebP format for larger images
- Optimize SVGs with SVGO

### Font Loading
- Use `font-display: swap` for better loading
- Preload critical fonts
- Consider hosting fonts locally

### Bundle Size
- Remove unused Tailwind classes
- Optimize React components
- Use Astro's built-in optimizations

## Analytics & Monitoring

### Add Analytics
Edit `src/layouts/Layout.astro` to add tracking:

```html
<head>
  <!-- Existing head content -->
  
  <!-- Google Analytics or other tracking -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=GA_MEASUREMENT_ID"></script>
</head>
```

### Performance Monitoring
- Use Lighthouse CI for automated testing
- Monitor Core Web Vitals
- Set up error tracking if needed

## Support

For technical issues with the website:
1. Check browser console for errors
2. Verify all asset paths are correct
3. Test build process locally
4. Review Astro documentation for framework-specific issues

The website follows Astro best practices and should be easily maintainable with basic web development knowledge.