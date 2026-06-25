// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
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
