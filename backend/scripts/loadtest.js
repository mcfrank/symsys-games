// Simulated class: N phones join, play all four games with random timing,
// some never answer (timeouts), some refresh mid-game, some join late.
// Drives the instructor controls and checks every payoff against games.js.
//
//   node scripts/loadtest.js [url] [n]
// The server must have DEV_ADMIN_TOKEN set to the same value as here.

const { io } = require('socket.io-client');
const crypto = require('crypto');
const g = require('../games');

const URL = process.argv[2] || 'http://localhost:8080';
const N = Number(process.argv[3] || 201); // odd, so one pair gets a bot
const LATE = 10; // join after game 1 starts
const ADMIN_TOKEN = process.env.DEV_ADMIN_TOKEN || 'dev-token';
const MAX_DELAY_MS = Number(process.env.MAX_DELAY_MS || 8000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (n) => Math.floor(Math.random() * n);

const clients = [];
const stats = { submits: 0, refreshes: 0, joinClosed: 0 };

const makeClient = (i) => {
  const c = { i, uid: crypto.randomUUID(), view: null, silent: Math.random() < 0.04, refresher: Math.random() < 0.04, pendingKey: null };
  const connect = () => {
    c.socket = io(URL, { transports: ['websocket'], forceNew: true });
    c.socket.on('connect', () => c.socket.emit('hello', { uid: c.uid }));
    c.socket.on('join_closed', () => { stats.joinClosed += 1; });
    c.socket.on('view', (view) => {
      c.view = view;
      const step = view.screen === 'minAccept' ? 'minAccept'
        : view.screen === 'decide' ? ({ pd: 'move', coord: 'move', dictator: 'give' }[view.game] || (view.role === 'proposer' ? 'offer' : 'response'))
          : null;
      if (!step || c.silent) return;
      const key = `${view.game}:${step}`;
      if (c.pendingKey === key) return;
      c.pendingKey = key;
      const value = step === 'move' ? (view.game === 'pd' ? (Math.random() < 0.5 ? 'clean' : 'pollute') : g.COORD_OPTIONS[rand(3)])
        : step === 'response' ? view.offer >= rand(6) : rand(11);
      setTimeout(() => {
        // A few clients "refresh" (drop and reconnect) instead of answering right away.
        if (c.refresher && !c.refreshed) {
          c.refreshed = true;
          stats.refreshes += 1;
          c.pendingKey = null;
          c.socket.disconnect();
          setTimeout(connect, 1000);
          return;
        }
        c.socket.emit('submit', { game: view.game, step, value });
        stats.submits += 1;
      }, 300 + rand(MAX_DELAY_MS));
    });
  };
  connect();
  return c;
};

const admin = io(URL, { transports: ['websocket'] });
let summary = null;
admin.on('summary', (s) => { summary = s; });
admin.on('admin_denied', () => { console.error('admin denied: is DEV_ADMIN_TOKEN set on the server?'); process.exit(1); });
const cmd = (c) => admin.emit('admin_cmd', { cmd: c });

const waitFor = async (pred, ms, label) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (summary && pred(summary)) return true;
    await sleep(200);
  }
  console.log(`  (timed out waiting for ${label})`);
  return false;
};

// Recompute payoffs from the recorded moves and check them.
const checkGame = (key, game) => {
  const errors = [];
  for (const u of game.units) {
    if (!u.payoffs) { errors.push(`${u.id}: unresolved`); continue; }
    const [a, b] = u.members;
    let expected;
    if (key === 'pd') expected = g.pdPayoffs(u.moves[a], u.moves[b]);
    if (key === 'coord') expected = g.coordPayoffs(u.moves[a], u.moves[b]);
    if (key === 'dictator') expected = g.dictatorPayoffs(u.moves[a]);
    if (key === 'ultimatum') {
      const p = u.members.find((m) => u.roles[m] === 'proposer');
      const r = u.members.find((m) => u.roles[m] === 'responder');
      const [pp, rp] = g.ultimatumPayoffs(u.moves[p], u.moves[r]);
      expected = a === p ? [pp, rp] : [rp, pp];
    }
    if (u.payoffs[a] !== expected[0] || u.payoffs[b] !== expected[1]) errors.push(`${u.id}: payoff mismatch`);
  }
  const humans = game.units.flatMap((u) => u.members).filter((m) => m !== g.BOT);
  const bots = game.units.filter((u) => u.bot).length;
  const timedOut = game.units.reduce((n, u) => n + u.timedOut.length, 0);
  return { errors, units: game.units.length, humanSlots: humans.length, bots, timedOut };
};

(async () => {
  admin.emit('admin_hello', { token: ADMIN_TOKEN });
  await waitFor(() => true, 5000, 'admin summary');
  cmd('newSession');
  await sleep(500);
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    clients.push(makeClient(i));
    await sleep(15);
  }
  await waitFor((s) => s.present >= N, 15000, 'joins');
  console.log(`${summary.present} joined in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  let ok = true;
  for (let gi = 0; gi < g.GAME_ORDER.length; gi++) {
    const key = g.GAME_ORDER[gi];
    const gs = Date.now();
    cmd('start');
    if (gi === 0) for (let i = 0; i < LATE; i++) clients.push(makeClient(N + i));
    await waitFor((s) => s.game === key && s.phase === 'open', 5000, `${key} open`);
    await waitFor((s) => s.progress.total > 0 && s.progress.decided === s.progress.total, 120000, `${key} all decided`);
    const hiddenBeforeReveal = !(key in summary.results);
    cmd('reveal');
    await waitFor((s) => s.phase === 'revealed' && key in s.results, 5000, `${key} revealed`);
    const r = checkGame(key, summary.results[key]);
    const lateInGame = summary.results[key].units.flatMap((u) => u.members).filter((m) => clients.slice(N).some((c) => c.uid === m)).length;
    console.log(`${key}: ${r.units} units, ${r.humanSlots} human slots, ${r.bots} bot units, ${r.timedOut} timeouts, late joiners in game: ${lateInGame}, ` +
      `hidden before reveal: ${hiddenBeforeReveal}, ${((Date.now() - gs) / 1000).toFixed(1)}s, errors: ${r.errors.length ? r.errors.slice(0, 3).join('; ') : 'none'}`);
    if (r.errors.length || !hiddenBeforeReveal) ok = false;
    if (gi === 0 && lateInGame !== 0) ok = false;
    if (gi === 1 && lateInGame !== LATE) ok = false;
  }
  const views = clients.filter((c) => c.view?.screen === 'result').length;
  console.log(`submits: ${stats.submits}, refreshes: ${stats.refreshes}, clients on a result screen at the end: ${views}/${clients.length}`);
  console.log(ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
})();
