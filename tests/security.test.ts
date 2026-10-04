import { describe, expect, it } from 'vitest';
import { CERT_EXAMPLES, checkServer, sipIdentities } from '../src/sip/cert.ts';
import { ATTACKS, attackStates, DEFENCES, smallestCover } from '../src/sip/attacks.ts';
import { lintFlow } from '../src/sip/lint-flow.ts';
import { prepareFlow } from '../src/sip/flow.ts';
import { loadFlow, loadFlowData } from '../src/lib/data.ts';

const URI = 'sips:bob@biloxi.example';
const ex = (id: string) => CERT_EXAMPLES.find(e => e.id === id)!.cert;

describe('certificate check (RFC 5922 §7)', () => {
  it('accepts a sip URI of the domain in subjectAltName', () => {
    expect(checkServer(URI, ex('good'))).toMatchObject({ ok: true, matched: 'biloxi.example' });
  });

  it('uses DNS names only when there is no sip URI identity', () => {
    expect(sipIdentities(ex('good')).identities).toEqual(['biloxi.example']);
    expect(sipIdentities(ex('dns')).identities).toEqual(['biloxi.example', 'sip1.biloxi.example']);
    expect(checkServer(URI, ex('dns')).ok).toBe(true);
  });

  it('compares the domain of the URI, not the host that DNS returned', () => {
    const r = checkServer(URI, ex('host'));
    expect(r.ok).toBe(false);
    expect(r.rule).toBe('rfc5922-7.2-whole');
  });

  it('rejects wildcards, user URIs, and certificates that do not validate', () => {
    expect(checkServer(URI, ex('wild')).ok).toBe(false);
    expect(checkServer(URI, ex('user'))).toMatchObject({ ok: false, identities: [] });
    expect(checkServer(URI, ex('self'))).toMatchObject({ ok: false, rule: 'rfc5922-7.1-validity' });
  });

  it('reads the CN only when there is no subjectAltName', () => {
    expect(checkServer(URI, ex('cn')).ok).toBe(true);
    expect(sipIdentities({ valid: true, san: ['DNS:other.example'], cn: 'biloxi.example' }).identities).toEqual(['other.example']);
  });

  it('compares names without case, and ignores non-sip URIs', () => {
    expect(checkServer('sip:bob@BILOXI.example', { valid: true, san: ['URI:SIP:Biloxi.Example'] }).ok).toBe(true);
    expect(sipIdentities({ valid: true, san: ['URI:https://biloxi.example'] }).identities).toEqual([]);
  });
});

describe('attack surface model', () => {
  const all = new Set(DEFENCES.map(d => d.id));

  it('leaves every attack open with no defences, and closes all with every defence', () => {
    expect(Object.values(attackStates(new Set())).every(s => s.open)).toBe(true);
    expect(Object.values(attackStates(all)).every(s => !s.open)).toBe(true);
  });

  it('needs TLS as well as SRTP to stop call recording (SDES keys travel in the SDP)', () => {
    expect(attackStates(new Set(['srtp'])).record!.open).toBe(true);
    expect(attackStates(new Set(['srtp', 'tls'])).record!.open).toBe(false);
  });

  it('closes the password attacks only when both ways to steal a password are closed', () => {
    expect(attackStates(new Set(['block'])).hijack!.open).toBe(true); // a captured digest can still be cracked
    expect(attackStates(new Set(['block', 'tls'])).hijack!.open).toBe(false);
    expect(attackStates(new Set(['strong'])).fraud!.open).toBe(false);
    expect(attackStates(new Set(['strong'])).relay!.open).toBe(true);
  });

  it('every attack can be closed, and every defence closes something', () => {
    for (const d of DEFENCES) {
      const before = attackStates(new Set([...all].filter(x => x !== d.id)));
      const closedOnlyByOthers = ATTACKS.every(a => !before[a.id]!.open);
      // Without this defence, something is open — unless another defence covers the same attack.
      if (closedOnlyByOthers) expect(['strong', 'block']).toContain(d.id);
    }
    expect(smallestCover()).toHaveLength(9);
  });
});

describe('security lint rules', () => {
  it('pai-trust: a proxy must not pass on PAI from an untrusted node (RFC 3325 §5)', async () => {
    expect(lintFlow(await loadFlow('pai-forged-passed')).map(i => i.rule)).toEqual(['pai-trust']);
    expect(lintFlow(await loadFlow('pai-forged-removed'))).toEqual([]);
    // Without a trust list, the rule does not run.
    const data = structuredClone(loadFlowData('pai-forged-passed'));
    delete data.trust;
    expect(lintFlow(await prepareFlow(data))).toEqual([]);
  });

  it('user-enumeration: 404 for one user and 401 for another tells a scanner who exists', async () => {
    const broken = lintFlow(await loadFlow('scan-404-401'));
    expect(broken.map(i => `${i.rule}@${i.step}`)).toEqual(['user-enumeration@3']);
    expect(lintFlow(await loadFlow('scan-uniform-401'))).toEqual([]);
  });

  it('a REGISTER for another user is not an auth retry', async () => {
    expect(lintFlow(await loadFlow('scan-uniform-401')).filter(i => i.rule === 'auth-retry')).toEqual([]);
    expect(lintFlow(await loadFlow('toll-fraud'))).toEqual([]);
  });
});
