import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import { courseJsonLd, HOME_DESCRIPTION, HOME_TITLE, moduleJsonLd, moduleTitle } from '../src/lib/seo.ts';

const DIR = path.join(process.cwd(), 'src', 'content', 'modules');
const modules = fs.readdirSync(DIR).filter(f => f.endsWith('.mdx')).map(f => {
  const fm = YAML.parse(/^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(path.join(DIR, f), 'utf8'))![1]!);
  return { id: f.replace(/\.mdx$/, ''), ...fm } as { id: string; module: number; title: string; description: string; level: ('basic' | 'intermediate' | 'advanced')[]; objectives: string[] };
});

describe('search engine metadata', () => {
  it('every module has its own description of 70–160 characters', () => {
    for (const m of modules) {
      expect(m.description?.length, m.id).toBeGreaterThanOrEqual(70);
      expect(m.description.length, m.id).toBeLessThanOrEqual(160);
    }
    expect(new Set(modules.map(m => m.description)).size).toBe(modules.length);
  });

  it('page titles fit in a search result (70 characters or fewer)', () => {
    for (const m of modules) expect(moduleTitle(m.module, m.title).length, m.id).toBeLessThanOrEqual(70);
    expect(moduleTitle(25, 'Proxies, B2BUAs, and SBCs')).toBe('Proxies, B2BUAs, and SBCs · SIP Mastery, Module 25');
    expect(HOME_TITLE.length).toBeLessThanOrEqual(70);
    expect(HOME_DESCRIPTION.length).toBeLessThanOrEqual(160);
  });

  it('builds course and module JSON-LD that links together', () => {
    const home = 'https://sip.example/';
    const seo = modules.map(m => ({ n: m.module, title: m.title, description: m.description, url: `${home}modules/${m.id}/`, level: m.level, objectives: m.objectives, part: { n: 0, title: 'Orientation' } }));
    const [site, course] = courseJsonLd(home, seo) as Record<string, unknown>[];
    expect(site).toMatchObject({ '@type': 'WebSite', url: home });
    expect(course).toMatchObject({ '@type': 'Course', '@id': `${home}#course`, isAccessibleForFree: true });
    expect((course!.hasPart as unknown[]).length).toBe(modules.length);
    const [res, crumbs] = moduleJsonLd(home, seo[16]!) as Record<string, unknown>[];
    expect(res).toMatchObject({ '@type': 'LearningResource', url: seo[16]!.url, isPartOf: { '@id': `${home}#course` } });
    expect((crumbs!.itemListElement as { item: string }[]).at(-1)!.item).toBe(seo[16]!.url);
    expect(() => JSON.parse(JSON.stringify([site, course, res, crumbs]))).not.toThrow();
  });
});
