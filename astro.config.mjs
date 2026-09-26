// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://wethepeoplegather.com',
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
    ],
  },
});
