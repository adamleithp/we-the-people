// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://wethepeoplegather.com',
  // The pages were renamed in the 28 Sept copy update; old links still land.
  redirects: {
    '/idea': '/problem',
    '/practice': '/hope',
    '/join': '/#im-in',
  },
  vite: {
    plugins: [tailwindcss()],
    // ffmpeg.wasm (the /studio encoder) spawns its own worker by URL; Vite's
    // dependency pre-bundling breaks that path, so leave it as shipped
    optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  },
  experimental: {
    fonts: [
      {
        // Anton — heavy condensed display sans for the WE THE PEOPLE wordmark.
        // The Fonts API self-hosts, subsets, preloads and generates a
        // size-adjusted fallback so there's no layout shift.
        provider: fontProviders.google(),
        name: 'Anton',
        cssVariable: '--font-anton',
        weights: [400],
        styles: ['normal'],
        subsets: ['latin'],
        fallbacks: ['Arial Narrow', 'sans-serif'],
      },
      {
        // Suwannaphum — serif for the /map5 trial's headings.
        provider: fontProviders.google(),
        name: 'Suwannaphum',
        cssVariable: '--font-suwannaphum',
        weights: [700, 900],
        styles: ['normal'],
        subsets: ['latin'],
        fallbacks: ['Georgia', 'serif'],
      },
      {
        // Lateef ExtraBold — the /map5 trial's wordmark.
        provider: fontProviders.google(),
        name: 'Lateef',
        cssVariable: '--font-lateef',
        weights: [800],
        styles: ['normal'],
        subsets: ['latin'],
        fallbacks: ['Georgia', 'serif'],
      },
    ],
  },
});
