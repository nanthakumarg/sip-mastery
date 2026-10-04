// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';

// GitHub Pages project site: SITE=https://<user>.github.io BASE=/sip-course
// Custom domain later: BASE=/
export default defineConfig({
  site: process.env.SITE ?? 'https://example.github.io',
  base: process.env.BASE ?? '/',
  trailingSlash: 'ignore',
  integrations: [mdx(), react()],
});
