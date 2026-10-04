// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';

// GitHub Pages project site: https://nanthakumarg.github.io/sip-mastery/
// CI sets SITE and BASE from the repository (.github/workflows/deploy.yml).
// Custom domain later: BASE=/
export default defineConfig({
  site: process.env.SITE ?? 'https://nanthakumarg.github.io',
  base: process.env.BASE ?? '/sip-mastery',
  trailingSlash: 'ignore',
  integrations: [mdx(), react()],
});
