// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';

// GitHub Pages with a custom domain: https://sip.nanthakumar.com/
// Without the custom domain: SITE=https://nanthakumarg.github.io BASE=/sip-mastery
export default defineConfig({
  site: process.env.SITE ?? 'https://sip.nanthakumar.com',
  base: process.env.BASE ?? '/',
  trailingSlash: 'ignore',
  integrations: [mdx(), react()],
});
