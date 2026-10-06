/**
 * Number normaliser (Module 24.2): turns what a user dialled on a PBX phone
 * into an E.164 number, step by step, with the URIs a SIP trunk carries
 * (RFC 3966 tel URI, RFC 3261 §19.1.6 user=phone) and the ISUP format a
 * gateway in the same country would send (RFC 3398 §12.2). Two example dial
 * plans: a PBX in Atlanta (USA) and one in London (UK). Pure TypeScript.
 */

export interface DialPlan {
  id: 'us' | 'uk';
  label: string;
  /** Country code, without +. */
  cc: string;
  /** Area code of the PBX, for local numbers. */
  area: string;
  /** Digits the PBX user dials first for an outside line. */
  outside: string;
  /** International prefix: what follows is a country code. */
  intl: string;
  /** National trunk prefix, dropped in E.164 (UK 0); the USA uses 1 + ten digits instead. */
  trunk: string;
  /** Length of a national significant number. */
  nsn: number[];
  /** Length of a local number, dialled without the area code. */
  local: number;
  emergency: string[];
}

export const PLANS: Record<DialPlan['id'], DialPlan> = {
  us: { id: 'us', label: 'PBX in Atlanta, USA', cc: '1', area: '404', outside: '9', intl: '011', trunk: '1', nsn: [10], local: 7, emergency: ['911'] },
  uk: { id: 'uk', label: 'PBX in London, UK', cc: '44', area: '20', outside: '9', intl: '00', trunk: '0', nsn: [9, 10], local: 8, emergency: ['999', '112'] },
};

export type NumberKind = 'e164' | 'international' | 'national' | 'local' | 'emergency' | 'invalid';

export interface Normalised {
  kind: NumberKind;
  /** What the PBX did, one change per step. */
  steps: { what: string; result: string }[];
  /** E.164 with +, when the number is complete. */
  e164?: string;
  tel?: string;
  sip?: string;
  /** A local tel URI must name its scope (RFC 3966 §5.1.5). */
  localTel?: string;
  /** What a gateway in the PBX's country puts in the ISUP called party number. */
  isup?: { digits: string; noa: 'national' | 'international' };
  /** Why the number cannot be normalised, or what to watch. */
  note?: string;
}

const TRUNK_HOST = 'sip.carrier.example';

export function normalise(input: string, plan: DialPlan): Normalised {
  const steps: Normalised['steps'] = [];
  const clean = input.replace(/[\s\-.()]/g, '');
  if (clean !== input.trim()) steps.push({ what: 'Remove spaces, dashes, dots, and brackets', result: clean });
  if (!/^\+?\d+$/.test(clean)) return { kind: 'invalid', steps, note: 'A telephone number has only digits, with an optional + at the start.' };

  let n = clean;
  if (n.startsWith('+')) return complete('e164', n, steps, plan);

  if (n.startsWith(plan.outside) && n.length > plan.outside.length) {
    n = n.slice(plan.outside.length);
    steps.push({ what: `Remove the outside-line prefix ${plan.outside}`, result: n });
  } else {
    return { kind: 'invalid', steps, note: `Users of this PBX dial ${plan.outside} first for an outside line. Without it, the PBX treats the digits as an extension.` };
  }

  if (plan.emergency.includes(n)) {
    return {
      kind: 'emergency', steps, sip: `sip:${n}@${TRUNK_HOST};user=phone`,
      note: 'An emergency number is not an E.164 number. The PBX sends it as dialled, on a route that the carrier has agreed for emergency calls, with the caller\'s location.',
    };
  }
  if (n.startsWith(plan.intl)) {
    n = '+' + n.slice(plan.intl.length);
    steps.push({ what: `Replace the international prefix ${plan.intl} with +`, result: n });
    return complete('international', n, steps, plan);
  }
  if (plan.id === 'us' && n.length === 11 && n.startsWith(plan.trunk)) {
    n = '+' + n;
    steps.push({ what: 'Add + before 1, the country code', result: n });
    return complete('national', n, steps, plan);
  }
  if (plan.id === 'uk' && n.startsWith(plan.trunk) && plan.nsn.includes(n.length - 1)) {
    n = `+${plan.cc}${n.slice(1)}`;
    steps.push({ what: `Replace the trunk prefix ${plan.trunk} with +${plan.cc}`, result: n });
    return complete('national', n, steps, plan);
  }
  if (plan.id === 'us' && plan.nsn.includes(n.length)) {
    n = `+${plan.cc}${n}`;
    steps.push({ what: `Add +${plan.cc}, the country code`, result: n });
    return complete('national', n, steps, plan);
  }
  if (n.length === plan.local && !n.startsWith(plan.trunk)) {
    const local = n;
    n = `+${plan.cc}${plan.area}${n}`;
    steps.push({ what: `Add +${plan.cc} and the PBX's area code, ${plan.area}`, result: n });
    const r = complete('local', n, steps, plan);
    return { ...r, localTel: `tel:${local};phone-context=+${plan.cc}-${plan.area}` };
  }
  return { kind: 'invalid', steps, note: `${n.length} digits do not make a number in this dial plan. The carrier would answer 484 Address Incomplete or 404 Not Found.` };
}

function complete(kind: NumberKind, e164: string, steps: Normalised['steps'], plan: DialPlan): Normalised {
  const digits = e164.slice(1);
  if (digits.length < 8 || digits.length > 15) {
    return { kind: 'invalid', steps, note: `E.164 numbers have at most 15 digits after the +, and real ones have at least 8. This one has ${digits.length}.` };
  }
  const home = digits.startsWith(plan.cc);
  return {
    kind, steps, e164, tel: `tel:${e164}`, sip: `sip:${e164}@${TRUNK_HOST};user=phone`,
    isup: home ? { digits: digits.slice(plan.cc.length), noa: 'national' } : { digits, noa: 'international' },
  };
}
