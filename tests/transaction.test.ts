import { describe, expect, it } from 'vitest';
import { retransmitTimes, simulate, type SimRow } from '../src/sip/transaction.ts';

const sends = (rows: SimRow[], label: string) => rows.filter(r => r.msg?.label === label).map(r => r.t);
const last = (rows: SimRow[]) => rows[rows.length - 1]!;

describe('retransmit schedules (RFC 3261 §17.1.1.2, §17.1.2.2)', () => {
  it('Timer A doubles without a cap: seven INVITEs in 32 s', () => {
    expect(retransmitTimes('A')).toEqual([0, 500, 1500, 3500, 7500, 15500, 31500]);
  });
  it('Timer E doubles up to T2 = 4 s', () => {
    expect(retransmitTimes('E')).toEqual([0, 500, 1500, 3500, 7500, 11500, 15500, 19500, 23500, 27500, 31500]);
  });
  it('scales with T1', () => {
    expect(retransmitTimes('A', 1000)).toEqual([0, 1000, 3000, 7000, 15000, 31000, 63000]);
  });
});

describe('INVITE client transaction', () => {
  it('server down over UDP: seven INVITEs, then Timer B at 32 s', () => {
    const rows = simulate({ kind: 'invite', transport: 'udp', final: 486, drop: ['server*'] });
    expect(sends(rows, 'INVITE')).toEqual([0, 500, 1500, 3500, 7500, 15500, 31500]);
    expect(last(rows)).toMatchObject({ t: 32000, timer: { name: 'Timer B' }, client: 'Terminated', server: '—' });
  });

  it('server down over TCP: transport error at once', () => {
    const rows = simulate({ kind: 'invite', transport: 'tcp', final: 486, drop: ['server*'] });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.client).toBe('Terminated');
  });

  it('a lost INVITE is sent again after T1', () => {
    const rows = simulate({ kind: 'invite', transport: 'udp', final: 486, drop: ['INVITE#1'] });
    expect(sends(rows, 'INVITE')).toEqual([0, 500]);
    expect(rows.find(r => r.msg?.label === '100 Trying')!.client).toBe('Proceeding');
  });

  it('486 over UDP: ACK in the same transaction, then Timer I and Timer D', () => {
    const rows = simulate({ kind: 'invite', transport: 'udp', final: 486 });
    const ack = rows.find(r => r.msg?.label === 'ACK')!;
    expect(ack.msg!.core).toBe(false);
    expect(ack).toMatchObject({ t: 4000, client: 'Completed', server: 'Confirmed' });
    expect(rows.find(r => r.timer?.name === 'Timer I')!.t).toBe(9000);
    expect(last(rows)).toMatchObject({ t: 36000, timer: { name: 'Timer D' }, client: 'Terminated', server: 'Terminated' });
  });

  it('486 over TCP: Timer D and Timer I are zero', () => {
    const rows = simulate({ kind: 'invite', transport: 'tcp', final: 486 });
    expect(sends(rows, 'INVITE')).toEqual([0]);
    expect(rows.filter(r => r.timer).map(r => [r.timer!.name, r.t])).toEqual([['Timer D', 4000], ['Timer I', 4000]]);
  });

  it('a lost ACK: Timer G sends the 486 again, and the client sends the ACK again', () => {
    const rows = simulate({ kind: 'invite', transport: 'udp', final: 486, drop: ['ACK#1'] });
    expect(sends(rows, '486 Busy Here')).toEqual([4000, 4500]);
    expect(sends(rows, 'ACK')).toEqual([4000, 4500]);
    expect(rows.find(r => r.t === 4500 && r.msg?.label === 'ACK')!.server).toBe('Confirmed');
  });

  it('every ACK lost: Timer H ends the server transaction at 64×T1', () => {
    const rows = simulate({ kind: 'invite', transport: 'udp', final: 486, drop: ['ACK*'] });
    expect(sends(rows, '486 Busy Here')).toEqual([4000, 4500, 5500, 7500, 11500, 15500, 19500, 23500, 27500, 31500, 35500]);
    expect(rows.find(r => r.timer?.name === 'Timer H')).toMatchObject({ t: 36000, server: 'Terminated' });
  });
});

describe('2xx to INVITE', () => {
  it('RFC 3261: both transactions end at the 200 OK; the ACK comes from the UA core', () => {
    const rows = simulate({ kind: 'invite', transport: 'udp', final: 200 });
    const ok = rows.find(r => r.msg?.label === '200 OK')!;
    expect(ok).toMatchObject({ client: 'Terminated', server: 'Terminated' });
    const ack = rows.find(r => r.msg?.label === 'ACK')!;
    expect(ack.msg!.core).toBe(true);
    expect(ack.timers).toEqual([]);
  });

  it('RFC 6026: both sides wait in Accepted until Timer L and Timer M', () => {
    const rows = simulate({ kind: 'invite', transport: 'udp', final: 200, rfc6026: true });
    expect(rows.find(r => r.msg?.label === '200 OK')).toMatchObject({ client: 'Accepted', server: 'Accepted' });
    expect(rows.filter(r => r.timer).map(r => [r.timer!.name, r.t])).toEqual([['Timer L', 36000], ['Timer M', 36000]]);
  });

  it('the 32-second drop: the core sends the 200 OK until 64×T1, then BYE', () => {
    const rows = simulate({ kind: 'invite', transport: 'udp', final: 200, drop: ['ACK*'] });
    expect(sends(rows, '200 OK')).toEqual([4000, 4500, 5500, 7500, 11500, 15500, 19500, 23500, 27500, 31500, 35500]);
    expect(last(rows)).toMatchObject({ t: 36000, msg: { label: 'BYE', core: true } });
  });
});

describe('non-INVITE transactions', () => {
  it('server down over UDP: eleven requests, then Timer F', () => {
    const rows = simulate({ kind: 'non-invite', transport: 'udp', final: 200, drop: ['server*'] });
    expect(sends(rows, 'OPTIONS')).toHaveLength(11);
    expect(last(rows)).toMatchObject({ t: 32000, timer: { name: 'Timer F' }, client: 'Terminated' });
  });

  it('a lost 200 OK: the request comes again and the server sends the 200 OK again', () => {
    const rows = simulate({ kind: 'non-invite', transport: 'udp', final: 200, drop: ['200#1'] });
    expect(sends(rows, 'OPTIONS')).toEqual([0, 500]);
    expect(sends(rows, '200 OK')).toEqual([0, 500]);
    expect(rows.find(r => r.timer?.name === 'Timer K')!.t).toBe(5500);
    expect(rows.find(r => r.timer?.name === 'Timer J')!.t).toBe(32000);
  });

  it('a slow server sends 100 Trying at 3.5 s; Timer E then waits T2', () => {
    const rows = simulate({ kind: 'non-invite', transport: 'udp', final: 200, slow: true });
    expect(sends(rows, '100 Trying')[0]).toBe(3500);
    expect(sends(rows, 'OPTIONS')).toEqual([0, 500, 1500, 3500]);
    expect(sends(rows, '200 OK')).toEqual([6000]);
  });
});
