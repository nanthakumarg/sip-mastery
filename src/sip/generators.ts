/**
 * The flow generators behind the FlowBuilder island (Modules 21 to 25), each
 * with the options it shows. One island renders any of them from this table.
 */
import type { FlowData } from './flow.ts';
import {
  allCalls, applyChange, buildCall, CALL_QUOTES, callKey, DEFAULT_CALL, FORWARDS, inactive, LOSSES, OUTCOMES, PATHS,
} from './callflow.ts';
import {
  allReinvites, applyReinvite, buildReinvite, CHANGES, DEFAULT_REINVITE, METHODS, REINVITE_QUOTES, reinviteKey, RESULTS, SENDERS,
} from './reinvite.ts';
import {
  allTransfers, applyTransfer, buildTransfer, DEFAULT_TRANSFER, HANGUPS, TARGETS, TRANSFER_QUOTES, transferInactive, transferKey, TYPES,
} from './transfer.ts';
import {
  allEvents, ANSWERS, applyEvents, buildEvents, DEFAULT_EVENTS, ENDS, EVENTS_QUOTES, eventsInactive, eventsKey, PACKAGES,
} from './events.ts';
import {
  allTrunks, applyTrunk, buildTrunk, CALLER_IDS, DEFAULT_TRUNK, NUMBERS, PSTN_OUTCOMES, REDIRECTS, TRUNK_QUOTES, trunkInactive, trunkKey, TRUNKS,
} from './trunk.ts';
import { allBalances, applyBalance, BALANCE_QUOTES, balanceInactive, balanceKey, buildBalance, DEFAULT_BALANCE, FAILURES } from './balance.ts';

/** One row of controls: a choice of values for one option, or on/off toggles. */
export type Row =
  | { kind: 'choice'; label: string; key: string; items: Record<string, string> }
  | { kind: 'toggles'; label: string; items: [key: string, label: string][] };

type Options = Record<string, string | boolean>;

export interface Generator {
  rows: Row[];
  defaults: Options;
  /** Applies one change; the option that changed wins, and others move (with a note each). */
  apply(o: Options, change: Options): { options: Options; notes: string[] };
  /** Options that have no effect now, with the reason. */
  inactive(o: Options): Record<string, string | undefined>;
  /** The flow id is `${kind}-${key(o)}`. */
  key(o: Options): string;
  build(o: Options): FlowData;
  quotes: readonly string[];
  all(): Options[];
}

// The generators have typed options; the table works with plain records.
const wrap = (g: { [K in keyof Generator]: any }): Generator => g as Generator;

export const GENERATORS = {
  call: wrap({
    rows: [
      { kind: 'choice', label: 'Path', key: 'path', items: PATHS },
      { kind: 'choice', label: 'Outcome', key: 'outcome', items: OUTCOMES },
      { kind: 'toggles', label: 'What if', items: [['recordRoute', 'Record-Route'], ['auth', '407 challenge'], ['lateOffer', 'Late offer'], ['earlyMedia', 'Early media (183)']] },
      { kind: 'choice', label: 'Lost packet', key: 'lose', items: LOSSES },
      { kind: 'choice', label: 'Forwarding', key: 'forward', items: FORWARDS },
      { kind: 'choice', label: 'Hangs up', key: 'hangup', items: { alice: 'Alice', bob: 'Bob' } },
    ],
    defaults: DEFAULT_CALL, apply: applyChange, inactive, key: callKey, build: buildCall, quotes: CALL_QUOTES, all: allCalls,
  }),
  reinvite: wrap({
    rows: [
      { kind: 'choice', label: 'Change', key: 'change', items: CHANGES },
      { kind: 'choice', label: 'Method', key: 'method', items: METHODS },
      { kind: 'choice', label: 'Sent by', key: 'by', items: SENDERS },
      { kind: 'choice', label: 'Result', key: 'result', items: RESULTS },
    ],
    defaults: DEFAULT_REINVITE, apply: applyReinvite, inactive: () => ({}), key: reinviteKey, build: buildReinvite, quotes: REINVITE_QUOTES, all: allReinvites,
  }),
  transfer: wrap({
    rows: [
      { kind: 'choice', label: 'Transfer', key: 'type', items: TYPES },
      { kind: 'choice', label: 'Carol', key: 'target', items: TARGETS },
      { kind: 'choice', label: 'Alice hangs up', key: 'hangup', items: HANGUPS },
      { kind: 'toggles', label: 'What if', items: [['hold', 'Alice holds Bob first']] },
    ],
    defaults: DEFAULT_TRANSFER, apply: applyTransfer, inactive: transferInactive, key: transferKey, build: buildTransfer, quotes: TRANSFER_QUOTES, all: allTransfers,
  }),
  events: wrap({
    rows: [
      { kind: 'choice', label: 'Package', key: 'package', items: PACKAGES },
      { kind: 'choice', label: 'Notifier', key: 'answer', items: ANSWERS },
      { kind: 'choice', label: 'End', key: 'end', items: ENDS },
      { kind: 'toggles', label: 'What if', items: [['refresh', 'Alice refreshes once'], ['early', 'NOTIFY before the 200 OK']] },
    ],
    defaults: DEFAULT_EVENTS, apply: applyEvents, inactive: eventsInactive, key: eventsKey, build: buildEvents, quotes: EVENTS_QUOTES, all: allEvents,
  }),
  trunk: wrap({
    rows: [
      { kind: 'choice', label: 'Trunk', key: 'trunk', items: TRUNKS },
      { kind: 'choice', label: 'Number sent', key: 'number', items: NUMBERS },
      { kind: 'choice', label: 'Caller ID', key: 'callerId', items: CALLER_IDS },
      { kind: 'choice', label: 'Forwarded call', key: 'redirect', items: REDIRECTS },
      { kind: 'choice', label: 'The PSTN', key: 'outcome', items: PSTN_OUTCOMES },
      { kind: 'toggles', label: 'What if', items: [['earlyMedia', 'In-band tones (183)']] },
    ],
    defaults: DEFAULT_TRUNK, apply: applyTrunk, inactive: trunkInactive, key: trunkKey, build: buildTrunk, quotes: TRUNK_QUOTES, all: allTrunks,
  }),
  balance: wrap({
    rows: [
      { kind: 'choice', label: 'PBX A', key: 'failure', items: FAILURES },
      { kind: 'toggles', label: 'What if', items: [['probe', 'OPTIONS health checks']] },
    ],
    defaults: DEFAULT_BALANCE, apply: applyBalance, inactive: balanceInactive, key: balanceKey, build: buildBalance, quotes: BALANCE_QUOTES, all: allBalances,
  }),
};

export type GeneratorKind = keyof typeof GENERATORS;

/** Every quote id any generator can attach to a step. */
export const GENERATOR_QUOTES = [...new Set(Object.values(GENERATORS).flatMap(g => [...g.quotes]))];
