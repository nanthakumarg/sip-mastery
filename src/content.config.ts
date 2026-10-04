import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const modules = defineCollection({
  loader: glob({ pattern: '*.mdx', base: './src/content/modules' }),
  schema: z.object({
    module: z.number().int().min(0),
    title: z.string(),
    part: z.number().int().min(0),
    level: z.array(z.enum(['basic', 'intermediate', 'advanced'])).min(1),
    paths: z.object({
      noc: z.enum(['core', 'optional']),
      dev: z.enum(['core', 'optional']),
    }),
    summary: z.string(),
    objectives: z.array(z.string()).min(1),
    status: z.enum(['draft', 'review', 'published']).default('draft'),
  }),
});

export const collections = { modules };
