import { describe, expect, it } from 'vitest';
import { dissect } from '../src/sip/uri.ts';

const kinds = (s: string) => dissect(s).parts.filter(p => p.kind !== 'sep').map(p => `${p.kind}=${p.text}`);
const levels = (s: string) => dissect(s).notes.map(n => n.level);

describe('dissect', () => {
  it('splits a full SIP URI into its RFC 3261 §19.1.1 parts', () => {
    expect(kinds('sip:alice:secret@atlanta.example:5060;transport=tcp?subject=project')).toEqual([
      'scheme=sip', 'user=alice', 'password=secret', 'host=atlanta.example', 'port=5060',
      'uri-param=transport=tcp', 'uri-header=subject=project',
    ]);
  });

  it('keeps offsets that point back into the input', () => {
    const input = '"Alice" <sip:alice@atlanta.example>;tag=9fxced76sl';
    for (const p of dissect(input).parts) expect(input.slice(p.start, p.start + p.text.length)).toBe(p.text);
  });

  it('reads a name-addr with header parameters outside the brackets', () => {
    const d = dissect('Bob <sip:bob@biloxi.example>;tag=314159');
    expect(d.nameAddr).toBe(true);
    expect(d.parts.find(p => p.kind === 'header-param')).toMatchObject({ name: 'tag', value: '314159' });
    expect(d.role).toBe('aor');
  });

  it('guesses AOR, Contact, and route roles', () => {
    expect(dissect('sip:alice@atlanta.example').role).toBe('aor');
    expect(dissect('sip:alice@192.0.2.10:5060').role).toBe('contact');
    expect(dissect('<sip:proxy.atlanta.example;lr>').role).toBe('route');
    expect(dissect('sip:+12025550123@carrier.example;user=phone').role).toBe('phone');
  });

  it('reads IPv6 hosts with ports', () => {
    expect(kinds('sip:bob@[2001:db8::10]:5070')).toEqual(['scheme=sip', 'user=bob', 'host=[2001:db8::10]', 'port=5070']);
  });

  it('flags errors and risky choices', () => {
    expect(levels('sip:@atlanta.example')).toContain('error');
    expect(levels('sip:alice@atlanta.example:99999')).toContain('error');
    expect(levels('sips:alice@atlanta.example;transport=udp')).toContain('error');
    expect(levels('sip:alice@atlanta.example;transport=tcp;transport=udp')).toContain('error');
    expect(levels('sip:alice:pw@atlanta.example')).toContain('warn');
    expect(levels('sip:alice@192.168.1.20')).toContain('warn');
    expect(levels('http://example.com')).toEqual(['error']);
  });

  it('reads tel URIs (RFC 3966)', () => {
    expect(kinds('tel:+1-202-555-0123')).toEqual(['scheme=tel', 'number=+1-202-555-0123']);
    expect(levels('tel:+1-202-555-0123')).not.toContain('error');
    expect(levels('tel:7042')).toContain('error');
    expect(levels('tel:7042;phone-context=example.com')).not.toContain('error');
  });
});

describe('dissect in header mode (RFC 3261 §20.10)', () => {
  const h = (s: string) => dissect(s, { header: true });

  it('reads the header name and keeps params outside the brackets on the header', () => {
    const d = h('Contact: <sip:alice@192.0.2.10:5060;transport=tcp>;expires=3600');
    expect(d.parts[0]).toMatchObject({ kind: 'hname', text: 'Contact' });
    expect(d.uri).toBe('sip:alice@192.0.2.10:5060;transport=tcp');
    expect(d.headerParams).toEqual(['expires=3600']);
    expect(d.notes.some(n => n.level !== 'info')).toBe(false);
  });

  it('gives every parameter to the header when there are no brackets', () => {
    const d = h('Contact: sip:alice@192.0.2.10:5060;expires=3600');
    expect(d.uri).toBe('sip:alice@192.0.2.10:5060');
    expect(d.headerParams).toEqual(['expires=3600']);
    expect(d.notes.some(n => n.level === 'warn')).toBe(false);
  });

  it('warns when a URI parameter loses its brackets', () => {
    const d = h('Contact: sip:alice@192.0.2.10:5060;transport=tcp');
    expect(d.headerParams).toEqual(['transport=tcp']);
    expect(d.notes.find(n => n.level === 'warn')?.text).toMatch(/<sip:alice@192\.0\.2\.10:5060;transport=tcp>/);
  });

  it('warns when a header parameter is trapped inside the brackets', () => {
    const d = h('Contact: <sip:alice@192.0.2.10:5060;expires=3600>');
    expect(d.headerParams).toEqual([]);
    expect(d.notes.some(n => n.level === 'warn' && /expires/.test(n.text))).toBe(true);
  });

  it('reads compact header names', () => {
    expect(h('m: <sip:alice@192.0.2.10>').parts[0]).toMatchObject({ kind: 'hname', text: 'm' });
  });
});
