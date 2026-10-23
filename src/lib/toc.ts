/** "On this page" entries for a module, from the headings that Astro collects while rendering the MDX. */

export interface Heading { depth: number; slug: string; text: string }

export interface TocEntry {
  slug: string;
  depth: 2 | 3;
  /** The section number, such as "10.4"; undefined for "Common mistakes" and "Summary". */
  num?: string;
  title: string;
}

export function tocEntries(headings: Heading[]): TocEntry[] {
  return headings.filter(h => h.depth === 2 || h.depth === 3).map(h => {
    const m = /^(\d+(?:\.\d+)+)\s+(.+)$/.exec(h.text.trim());
    return { slug: h.slug, depth: h.depth as 2 | 3, num: m?.[1], title: m?.[2] ?? h.text.trim() };
  });
}
