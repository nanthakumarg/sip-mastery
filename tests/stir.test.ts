import { describe, expect, it } from 'vitest';
import { prepareFlow, type FlowData } from '../src/sip/flow.ts';
import { lintFlow } from '../src/sip/lint-flow.ts';
import { lintDiagram } from '../src/sip/lint-diagram.ts';
import { glossaryTerms, loadQuotes } from '../src/lib/data.ts';
import {
  b64uJson, CALL_TIME, canonicalJson, canonicalTn, divPayload, identityHeader, parseIdentity, shakenHeader, shakenPayload, signPassport, SKEW, verifyChecks, verifyJws, X5U,
} from '../src/sip/stir.ts';
import { EXAMPLE_PRIVATE_JWK, EXAMPLE_PUBLIC_JWK, TOKENS } from '../src/sip/stir-data.ts';
import { allStirs, buildStir, STIR_QUOTES, stirKey, type StirOptions } from '../src/sip/stir-flow.ts';

const terms = glossaryTerms();
const quoteIds = new Set(loadQuotes().map(q => q.id));
const labels = (f: FlowData) => f.steps.map(s => `${s.from}>${s.to} ${s.label}`);

describe('PASSporT', () => {
  it('canonical JSON: no whitespace, keys in lexicographic order (RFC 8225 §9)', () => {
    expect(canonicalJson({ x5u: 'u', alg: 'ES256', typ: 'passport', ppt: 'shaken' })).toBe('{"alg":"ES256","ppt":"shaken","typ":"passport","x5u":"u"}');
    expect(canonicalJson(shakenPayload('A', 1))).toMatch(/^\{"attest":"A","dest":\{"tn":\["12285550222"\]\},"iat":1,"orig":\{"tn":"14045550101"\},"origid":"/);
  });

  it('every committed token verifies with the example public key, and carries the expected claims', async () => {
    const expected: Record<string, ReturnType<typeof shakenPayload>> = {
      'A.ok': shakenPayload('A', CALL_TIME), 'A.skew': shakenPayload('A', CALL_TIME - SKEW), 'B.ok': shakenPayload('B', CALL_TIME), 'B.skew': shakenPayload('B', CALL_TIME - SKEW),
      'C.ok': shakenPayload('C', CALL_TIME), 'C.skew': shakenPayload('C', CALL_TIME - SKEW), 'B.asA': { ...shakenPayload('B', CALL_TIME), attest: 'A' }, div: divPayload(CALL_TIME + 20),
    };
    expect(Object.keys(TOKENS).sort()).toEqual(Object.keys(expected).sort());
    for (const [k, jws] of Object.entries(TOKENS)) {
      expect(await verifyJws(jws, EXAMPLE_PUBLIC_JWK), k).toBe(true);
      expect(jws.split('.')[1], k).toBe(b64uJson(expected[k]));
    }
  });

  it('a changed payload breaks the signature; signing again fixes it', async () => {
    const [h, , s] = TOKENS['A.ok']!.split('.');
    const forged = { ...shakenPayload('A', CALL_TIME), orig: { tn: '12025550199' } };
    expect(await verifyJws(`${h}.${b64uJson(forged)}.${s}`, EXAMPLE_PUBLIC_JWK)).toBe(false);
    expect(await verifyJws(await signPassport(shakenHeader(), forged, EXAMPLE_PRIVATE_JWK), EXAMPLE_PUBLIC_JWK)).toBe(true);
  });

  it('parses an Identity header, and the verifier checks time and numbers', () => {
    const p = parseIdentity(identityHeader(TOKENS['A.ok']!, X5U));
    expect(p).toMatchObject({ info: X5U, alg: 'ES256', ppt: 'shaken', header: shakenHeader(), payload: shakenPayload('A', CALL_TIME) });
    expect(p.signature).toHaveLength(64);
    const base = { parsed: p, signatureValid: true, from: '<tel:+14045550101>', to: 'sip:+12285550222@biloxi.example', certTrusted: true };
    expect(verifyChecks({ ...base, now: CALL_TIME + 5 }).verstat).toBe('TN-Validation-Passed');
    expect(verifyChecks({ ...base, now: CALL_TIME + 61 }).verstat).toBe('TN-Validation-Failed');
    expect(verifyChecks({ ...base, now: CALL_TIME, from: '+12285550100' }).verstat).toBe('TN-Validation-Failed');
    expect(verifyChecks({ ...base, parsed: undefined, now: CALL_TIME }).verstat).toBe('No-TN-Validation');
    expect(canonicalTn('"Alice" <sip:+1-404-555-0101@carrier-a.example;user=phone>')).toBe('14045550101');
  });
});

describe('the STIR/SHAKEN generator', () => {
  const extra: StirOptions[] = [{ caller: 'B', transit: 'keeps', clock: 'ok', policy: 'mark', overAttest: true }];
  it('every combination passes the checks', async () => {
    const out: string[] = [];
    for (const o of [...allStirs(), ...extra]) {
      const f = await prepareFlow(buildStir(o));
      for (const i of [...lintFlow(f), ...lintDiagram(f, terms)]) if (i.severity === 'error' || i.rule === 'caption-passive') out.push(`${stirKey(o)} step ${i.step + 1}: [${i.rule}] ${i.message}`);
      for (const s of f.steps) if (s.rfc && !(STIR_QUOTES as readonly string[]).includes(s.rfc)) out.push(`${stirKey(o)}: ${s.rfc} not in the quote list`);
    }
    for (const id of STIR_QUOTES) if (!quoteIds.has(id)) out.push(`unknown quote ${id}`);
    expect(out).toEqual([]);
  });

  it('the Identity header the flow sends is a valid signature', async () => {
    const f = buildStir({ caller: 'A', transit: 'keeps', clock: 'ok', policy: 'mark' });
    const id = f.steps.find(s => s.to === 'transit')!.message!.split('\n').find(l => l.startsWith('Identity:'))!;
    expect(await verifyJws(parseIdentity(id).jws, EXAMPLE_PUBLIC_JWK)).toBe(true);
  });

  it('verstat reaches Bob: passed, failed after a rewrite, none after stripping', () => {
    const verstat = (o: Partial<StirOptions>) => /verstat=([\w-]+)/.exec(buildStir({ caller: 'A', transit: 'keeps', clock: 'ok', policy: 'mark', ...o }).steps.find(s => s.to === 'bob')!.message!)![1];
    expect(verstat({})).toBe('TN-Validation-Passed');
    expect(verstat({ transit: 'rewrites' })).toBe('TN-Validation-Failed');
    expect(verstat({ transit: 'strips' })).toBe('No-TN-Validation');
  });

  it('a rejecting verifier answers 403 Stale Date, 438, or 428', () => {
    const last = (o: Partial<StirOptions>) => labels(buildStir({ caller: 'A', transit: 'keeps', clock: 'ok', policy: 'reject', ...o })).find(l => l.startsWith('term>transit 4'));
    expect(last({ clock: 'slow' })).toBe('term>transit 403 Stale Date');
    expect(last({ transit: 'rewrites' })).toBe('term>transit 438 Invalid Identity Header');
    expect(last({ transit: 'strips' })).toBe('term>transit 428 Use Identity Header');
  });
});
