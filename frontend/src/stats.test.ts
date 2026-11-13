import { describe, expect, it } from 'vitest';
import type { Unit } from './types';
import { coordStats, dictatorStats, median, pdStats, ultimatumStats } from './stats';

const unit = (over: Partial<Unit>): Unit => ({
  id: 'x', members: ['a', 'b'], roles: {}, moves: {}, minAccept: {}, timedOut: [], bot: false, payoffs: null, ...over,
});

describe('pdStats', () => {
  const units = [
    unit({ members: ['a', 'b'], moves: { a: 'clean', b: 'clean' }, payoffs: { a: -2, b: -2 } }),
    unit({ members: ['c', 'd'], moves: { c: 'clean', d: 'pollute' }, payoffs: { c: -10, d: 0 } }),
    // bot pair: e's choice counts, the pair doesn't
    unit({ members: ['e', 'bot'], bot: true, moves: { e: 'pollute', bot: 'clean' }, payoffs: { e: 0, bot: -10 } }),
    // f timed out: g's choice counts, f's (a bot's) doesn't, the pair doesn't
    unit({ members: ['f', 'g'], timedOut: ['f'], moves: { f: 'clean', g: 'pollute' }, payoffs: { f: -10, g: 0 } }),
  ];
  const s = pdStats(units);
  it('counts every human decision', () => {
    expect(s.n).toBe(6); // a b c d e g
    expect(s.pctClean).toBeCloseTo(3 / 6);
  });
  it('builds the outcome grid and average from clean pairs only', () => {
    expect(s.nPairs).toBe(2);
    expect(s.grid).toEqual({ clean: { clean: 2, pollute: 1 }, pollute: { clean: 1, pollute: 0 } });
    expect(s.avgPoints).toBeCloseTo((-2 - 2 - 10 + 0) / 4);
  });
});

describe('ultimatumStats', () => {
  const units = [
    unit({ members: ['a', 'b'], roles: { a: 'proposer', b: 'responder' }, moves: { a: 4, b: true }, minAccept: { b: 3 } }),
    unit({ members: ['c', 'd'], roles: { c: 'responder', d: 'proposer' }, moves: { d: 1, c: false }, minAccept: { c: 2 } }),
    // responder timed out: offer counts, acceptance doesn't; minAccept was skipped
    unit({ members: ['e', 'f'], roles: { e: 'proposer', f: 'responder' }, timedOut: ['f'], moves: { e: 5, f: true }, minAccept: { f: null } }),
  ];
  const s = ultimatumStats(units);
  it('collects human offers', () => {
    expect(s.offers.sort()).toEqual([1, 4, 5]);
    expect(s.mean).toBeCloseTo(10 / 3);
    expect(s.median).toBe(4);
  });
  it('computes acceptance from decided human pairs', () => {
    expect(s.acceptance[4]).toEqual({ n: 1, accepted: 1 });
    expect(s.acceptance[1]).toEqual({ n: 1, accepted: 0 });
    expect(s.acceptance[5]).toEqual({ n: 0, accepted: 0 });
  });
  it('builds the stated minimum-acceptance curve', () => {
    expect(s.minAccept.sort()).toEqual([2, 3]);
    expect(s.minAcceptCurve[1]).toBe(0);
    expect(s.minAcceptCurve[2]).toBe(0.5);
    expect(s.minAcceptCurve[3]).toBe(1);
  });
});

describe('dictatorStats', () => {
  const ult = [unit({ members: ['a', 'b'], roles: { a: 'proposer', b: 'responder' }, moves: { a: 5, b: true } })];
  const dict = [
    unit({ members: ['a', 'b'], moves: { a: 2 } }),
    unit({ members: ['b', 'a'], moves: { b: 0 } }),
  ];
  const s = dictatorStats(dict, ult);
  it('compares the same students across games', () => {
    expect(s.gifts.sort()).toEqual([0, 2]);
    expect(s.within).toEqual({ n: 1, meanOffer: 5, meanGift: 2 });
  });
});

describe('coordStats', () => {
  const opts = ['X', 'Y'];
  const s = coordStats([
    unit({ members: ['a', 'b'], moves: { a: 'X', b: 'X' } }),
    unit({ members: ['c', 'd'], moves: { c: 'X', d: 'Y' } }),
  ], opts);
  it('counts choices and matches', () => {
    expect(s.counts).toEqual([3, 1]);
    expect(s.pctMatched).toBe(0.5);
    expect(s.chance).toBe(0.5);
  });
});

it('median', () => {
  expect(median([3, 1, 2])).toBe(2);
  expect(median([1, 2, 3, 4])).toBe(2.5);
});
