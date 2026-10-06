/**
 * Search engine data shared by the pages: titles, and schema.org JSON-LD
 * for the course (home page) and each module (a learning resource).
 * Pure: the caller passes absolute URLs.
 */
import { LEVEL_LABEL, pad2 } from './outline.ts';

export const SITE_NAME = 'SIP Mastery';
export const HOME_TITLE = 'SIP Mastery: a free, interactive SIP course';
export const HOME_DESCRIPTION = 'Learn SIP by watching it work: a free course with interactive call flows, from REGISTER and INVITE to NAT, SDP, RTP, SBCs, WebRTC, and VoLTE.';
export const AUTHOR = { '@type': 'Person', name: 'Nanthakumar' } as const;

/** "Proxies, B2BUAs, and SBCs · SIP Mastery, Module 25" */
export const moduleTitle = (n: number, title: string) => `${title} · ${SITE_NAME}, Module ${pad2(n)}`;

export interface SeoModule {
  n: number;
  title: string;
  description: string;
  url: string;
  level: (keyof typeof LEVEL_LABEL)[];
  objectives: string[];
  part: { n: number; title: string };
}

const courseRef = (home: string) => ({ '@type': 'Course', '@id': `${home}#course`, name: SITE_NAME, url: home });

export function courseJsonLd(home: string, modules: SeoModule[]): object[] {
  return [
    { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: home, inLanguage: 'en' },
    {
      '@context': 'https://schema.org',
      '@type': 'Course',
      '@id': `${home}#course`,
      name: SITE_NAME,
      description: HOME_DESCRIPTION,
      url: home,
      inLanguage: 'en',
      isAccessibleForFree: true,
      provider: { ...AUTHOR, url: home },
      author: { ...AUTHOR, url: home },
      educationalLevel: 'Beginner to advanced',
      teaches: 'The Session Initiation Protocol (SIP), SDP, RTP, and VoIP call flows',
      license: 'https://creativecommons.org/licenses/by/4.0/',
      offers: { '@type': 'Offer', category: 'Free', price: 0, priceCurrency: 'USD' },
      hasCourseInstance: { '@type': 'CourseInstance', courseMode: 'online', courseWorkload: `PT${modules.length}H` },
      numberOfCredits: 0,
      hasPart: modules.map(m => ({ '@type': 'LearningResource', name: `Module ${pad2(m.n)}: ${m.title}`, url: m.url, position: m.n })),
    },
  ];
}

export function moduleJsonLd(home: string, m: SeoModule): object[] {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'LearningResource',
      name: m.title,
      headline: `Module ${pad2(m.n)}: ${m.title}`,
      description: m.description,
      url: m.url,
      inLanguage: 'en',
      learningResourceType: 'Interactive lesson',
      educationalLevel: m.level.map(l => LEVEL_LABEL[l]).join(', '),
      teaches: m.objectives,
      isAccessibleForFree: true,
      position: m.n,
      author: { ...AUTHOR, url: home },
      isPartOf: courseRef(home),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: SITE_NAME, item: home },
        { '@type': 'ListItem', position: 2, name: `Part ${m.part.n}: ${m.part.title}`, item: `${home}#map` },
        { '@type': 'ListItem', position: 3, name: `Module ${pad2(m.n)}: ${m.title}`, item: m.url },
      ],
    },
  ];
}
