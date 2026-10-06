/**
 * The data that every flow builder needs (Modules 21 and 22), served once as a
 * static file: the RFC quotes the generators can show, and the header reference.
 * Each builder on a page embeds only what its first flow needs, then loads this.
 */
import { clientRefData, quoteMap } from '../lib/bundle.ts';
import { GENERATOR_QUOTES } from '../sip/generators.ts';

export function GET() {
  return new Response(JSON.stringify({ quotes: quoteMap(GENERATOR_QUOTES), refData: clientRefData() }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
