// Class statistics for the dashboard, computed from the server's units.
//
// Individual decisions count whenever a human made them (their partner may
// have been a bot or timed out; their choice was still real). Pair-level
// results (outcome grid, average points, acceptance of a given offer, match
// rate) use only pairs of two humans where nobody timed out.

import type { GeminiResult, Unit } from './types';

const BOT = 'bot';
export const AMOUNTS = Array.from({ length: 11 }, (_, i) => i);

const madeBy = (u: Unit, uid: string) => uid !== BOT && !u.timedOut.includes(uid);
const cleanPair = (u: Unit) => !u.bot && u.timedOut.length === 0;
const roleOf = (u: Unit, role: string) => u.members.find((m) => u.roles[m] === role)!;

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
export const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const countAmounts = (xs: number[]) => AMOUNTS.map((a) => xs.filter((x) => x === a).length);

export const pdStats = (units: Unit[]) => {
  const choices = units.flatMap((u) => u.members.filter((m) => madeBy(u, m)).map((m) => u.moves[m] as string));
  // Player-perspective outcome grid: [you][partner], counting players.
  const grid = { clean: { clean: 0, pollute: 0 }, pollute: { clean: 0, pollute: 0 } };
  const points: number[] = [];
  const pairs = units.filter(cleanPair);
  for (const u of pairs) {
    const [a, b] = u.members;
    const ma = u.moves[a] as 'clean' | 'pollute', mb = u.moves[b] as 'clean' | 'pollute';
    grid[ma][mb] += 1;
    grid[mb][ma] += 1;
    points.push(u.payoffs![a], u.payoffs![b]);
  }
  return {
    n: choices.length,
    pctClean: choices.length ? choices.filter((c) => c === 'clean').length / choices.length : NaN,
    grid,
    nPairs: pairs.length,
    avgPoints: mean(points),
  };
};

export const ultimatumOffers = (units: Unit[]) => {
  const byUid: Record<string, number> = {};
  for (const u of units) {
    const p = roleOf(u, 'proposer');
    if (madeBy(u, p)) byUid[p] = u.moves[p] as number;
  }
  return byUid;
};

export const ultimatumStats = (units: Unit[]) => {
  const offers = Object.values(ultimatumOffers(units));
  // Acceptance of real offers: the responder decided, and the offer came from a person.
  const acceptance = AMOUNTS.map(() => ({ n: 0, accepted: 0 }));
  const minAccept: number[] = [];
  for (const u of units) {
    const p = roleOf(u, 'proposer'), r = roleOf(u, 'responder');
    if (madeBy(u, r) && madeBy(u, p) && r in u.moves) {
      const cell = acceptance[u.moves[p] as number];
      cell.n += 1;
      if (u.moves[r]) cell.accepted += 1;
    }
    if (r !== BOT && u.minAccept[r] != null) minAccept.push(u.minAccept[r] as number);
  }
  // Share of responders who said they'd accept an offer of x (minAccept <= x).
  const minAcceptCurve = AMOUNTS.map((x) => (minAccept.length ? minAccept.filter((m) => m <= x).length / minAccept.length : NaN));
  return { offers, counts: countAmounts(offers), mean: mean(offers), median: median(offers), acceptance, minAccept, minAcceptCurve };
};

export const dictatorStats = (units: Unit[], ultimatumUnits: Unit[]) => {
  const giftsByUid: Record<string, number> = {};
  for (const u of units) {
    const d = u.members[0];
    if (madeBy(u, d)) giftsByUid[d] = u.moves[d] as number;
  }
  const gifts = Object.values(giftsByUid);
  const offersByUid = ultimatumOffers(ultimatumUnits);
  const offers = Object.values(offersByUid);
  // Students who were both an ultimatum proposer and a dictator.
  const both = Object.keys(giftsByUid).filter((uid) => uid in offersByUid);
  return {
    gifts, giftCounts: countAmounts(gifts), meanGift: mean(gifts), medianGift: median(gifts),
    offers, offerCounts: countAmounts(offers), meanOffer: mean(offers),
    within: { n: both.length, meanOffer: mean(both.map((u) => offersByUid[u])), meanGift: mean(both.map((u) => giftsByUid[u])) },
  };
};

export const coordStats = (units: Unit[], options: string[]) => {
  const choices = units.flatMap((u) => u.members.filter((m) => madeBy(u, m)).map((m) => u.moves[m] as string));
  const pairs = units.filter(cleanPair);
  const matched = pairs.filter((u) => u.moves[u.members[0]] === u.moves[u.members[1]]).length;
  return {
    n: choices.length,
    counts: options.map((o) => choices.filter((c) => c === o).length),
    nPairs: pairs.length,
    pctMatched: pairs.length ? matched / pairs.length : NaN,
    chance: 1 / options.length,
  };
};

// --- Gemini ----------------------------------------------------------------

export const geminiLabel = (model: string) =>
  model.replace(/^gemini-/, 'Gemini ').replace(/-flash/, ' Flash').replace(/-pro/, ' Pro').replace(/-lite/, ' Lite');

const valid = <T,>(xs: (T | null)[] | undefined) => (xs || []).filter((x): x is T => x !== null && x !== undefined);

export const geminiStats = (r: GeminiResult, options: string[]) => {
  const a = r.answers || {};
  const pd = valid<string>(a.pd as (string | null)[]);
  const nums = (k: string) => valid<number>(a[k] as (number | null)[]);
  return {
    label: geminiLabel(r.model),
    pctClean: pd.length ? pd.filter((x) => x === 'clean').length / pd.length : NaN,
    nPd: pd.length,
    offers: nums('offer'),
    minAccept: nums('minAccept'),
    gifts: nums('dictator'),
    acceptance: AMOUNTS.map((o) => {
      const rs = valid<boolean>(a[`response_${o}`] as (boolean | null)[]);
      return rs.length ? rs.filter(Boolean).length / rs.length : NaN;
    }),
    coordCounts: options.map((o) => valid<string>(a.coord as (string | null)[]).filter((c) => c === o).length),
  };
};
