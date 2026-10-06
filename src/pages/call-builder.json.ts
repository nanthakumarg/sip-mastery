/**
 * The data that every call flow builder needs (Module 21), served once as a
 * static file: the RFC quotes the generator can show, and the header reference.
 * Each builder on the page embeds only what its first flow needs, then loads this.
 */
import { clientRefData, quoteMap } from '../lib/bundle.ts';
import { CALL_QUOTES } from '../sip/callflow.ts';

export function GET() {
  return new Response(JSON.stringify({ quotes: quoteMap([...CALL_QUOTES]), refData: clientRefData() }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
