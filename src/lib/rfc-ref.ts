/**
 * How the course names and links an RFC section. Most RFCs number their
 * sections ("16.6"); a few older ones, such as RFC 2782, use headings only
 * ("The format of the SRV RR"). Shared by the build and the islands.
 */

/** True for "16.6", "A.1", "Appendix B"; false for a heading such as "Usage rules". */
export const isNumberedSection = (section: string) => /^(\d+(\.\d+)*|[A-Z](\.\d+)*|Appendix [A-Z])$/.test(section);

/** Link to the RFC on rfc-editor.org, at the section when it has a number. */
export const rfcUrl = (rfc: number, section?: string) =>
  `https://www.rfc-editor.org/rfc/rfc${rfc}${section && isNumberedSection(section) ? `#section-${section}` : ''}`;

/** "RFC 3261 §16.6 · Request Forwarding", or "RFC 2782 · The format of the SRV RR". */
export function quoteSource(q: { rfc: number; section: string; title: string }): string {
  return isNumberedSection(q.section) ? `RFC ${q.rfc} §${q.section} · ${q.title}` : `RFC ${q.rfc} · ${q.title}`;
}
