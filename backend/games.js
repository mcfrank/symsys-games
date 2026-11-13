// Game definitions, payoffs, pairing and bot moves. Pure functions only, so
// they can be unit-tested; server.js owns state, timing and I/O.
//
// The text here is the single source for what students see on their phones
// and for the prompts Gemini gets.

const GAME_ORDER = ['pd', 'ultimatum', 'dictator', 'coord'];
const PIE = 10;
const BOT = 'bot';

const COORD_OPTIONS = [
  'Main Quad / Memorial Church',
  'Hoover Tower',
  'The Oval',
  'Tresidder / CoHo',
  'Green Library',
  'White Plaza',
  'Old Union',
];

// PD payoffs as [your points, partner's points], indexed [yourMove][partnerMove].
const PD_PAYOFFS = {
  clean: { clean: [-2, -2], pollute: [-10, 0] },
  pollute: { clean: [0, -10], pollute: [-8, -8] },
};

const GAMES = {
  pd: {
    title: 'Clean up or pollute?',
    scenario: 'You and a partner live on the same river. Without talking, each of you decides whether to clean up your waste or pollute. Your points depend on both choices.',
    options: [{ value: 'clean', label: 'Clean up' }, { value: 'pollute', label: 'Pollute' }],
    payoffs: PD_PAYOFFS,
  },
  ultimatum: {
    title: 'Ultimatum game',
    scenario: `There are ${PIE} points to split. The proposer offers the responder a whole number of points from 0 to ${PIE} and keeps the rest. If the responder accepts, you both get that split. If the responder rejects, you both get 0.`,
    minAcceptQuestion: "Before you see the offer: what's the lowest offer you'd accept?",
  },
  dictator: {
    title: 'Dictator game',
    scenario: `You have ${PIE} points to split with a randomly chosen classmate. You decide how many points (0 to ${PIE}) to give them, and you keep the rest. They have no say.`,
  },
  coord: {
    title: 'Where do you meet?',
    scenario: 'You and a classmate are separated on campus with dead phones. You agreed to meet at noon but never said where. Where do you go? You both get 5 points if you pick the same place, and 0 if not.',
    options: COORD_OPTIONS.map((label) => ({ value: label, label })),
  },
};

// --- Payoffs ---------------------------------------------------------------

const pdPayoffs = (a, b) => PD_PAYOFFS[a][b];

const ultimatumPayoffs = (offer, accepted) => (accepted ? [PIE - offer, offer] : [0, 0]);

const dictatorPayoffs = (give) => [PIE - give, give];

const coordPayoffs = (a, b) => (a === b ? [5, 5] : [0, 0]);

// --- Move validation -------------------------------------------------------

const isAmount = (v) => Number.isInteger(v) && v >= 0 && v <= PIE;

const isValidMove = (game, step, value) => {
  if (game === 'pd') return value === 'clean' || value === 'pollute';
  if (game === 'coord') return COORD_OPTIONS.includes(value);
  if (game === 'ultimatum' && (step === 'offer' || step === 'minAccept')) return isAmount(value);
  if (game === 'ultimatum' && step === 'response') return typeof value === 'boolean';
  if (game === 'dictator') return isAmount(value);
  return false;
};

// --- Bots (odd class sizes and timeouts; from the handoff) -----------------

const botMove = (game, step, rng = Math.random, context = {}) => {
  if (game === 'pd') return rng() < 0.5 ? 'clean' : 'pollute';
  if (game === 'coord') return COORD_OPTIONS[0];
  if (game === 'ultimatum' && step === 'offer') return 4;
  if (game === 'ultimatum' && step === 'minAccept') return 3;
  if (game === 'ultimatum' && step === 'response') return context.offer >= 3;
  if (game === 'dictator') return 2;
  throw new Error(`no bot move for ${game}/${step}`);
};

// --- Pairing ---------------------------------------------------------------

const shuffle = (items, rng = Math.random) => {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Random pairs; with an odd count, the last person is paired with a bot.
const makePairs = (uids, rng = Math.random) => {
  const s = shuffle(uids, rng);
  const pairs = [];
  for (let i = 0; i < s.length; i += 2) {
    pairs.push([s[i], i + 1 < s.length ? s[i + 1] : BOT]);
  }
  return pairs;
};

// Everyone is a dictator once and a recipient once: give to the next person
// in a random cycle. A single player gives to a bot.
const makeDictatorCycle = (uids, rng = Math.random) => {
  if (uids.length === 0) return [];
  if (uids.length === 1) return [[uids[0], BOT]];
  const s = shuffle(uids, rng);
  return s.map((uid, i) => [uid, s[(i + 1) % s.length]]);
};

module.exports = {
  GAME_ORDER, GAMES, PIE, BOT, COORD_OPTIONS,
  pdPayoffs, ultimatumPayoffs, dictatorPayoffs, coordPayoffs,
  isValidMove, botMove, shuffle, makePairs, makeDictatorCycle,
};
