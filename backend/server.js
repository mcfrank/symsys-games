const express = require('express');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');
const { Firestore } = require('@google-cloud/firestore');
const { OAuth2Client } = require('google-auth-library');
const g = require('./games');
const { runGemini, GEMINI_MODELS } = require('./gemini');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });

app.use(express.static(path.join(__dirname, 'public')));

const DECISION_MS = Number(process.env.DECISION_SECONDS || 45) * 1000; // shorter only in load tests
const PRESENT_MS = 2 * 60 * 1000; // counts as present if seen this recently (phones sleep)
const OAUTH_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
const oauthClient = new OAuth2Client(OAUTH_CLIENT_ID);

const db = new Firestore({ databaseId: process.env.FIRESTORE_DATABASE || '(default)' });
// Local runs use a different prefix so test sessions never touch class data.
const PREFIX = process.env.COLLECTION_PREFIX || 'games';
const sessionsCol = db.collection(`${PREFIX}_sessions`);
const pointerDoc = db.collection(`${PREFIX}_settings`).doc('current');
const geminiCol = db.collection(`${PREFIX}_gemini`);
// Lets the load-test script act as the instructor locally; never set in deploy.sh.
const DEV_ADMIN_TOKEN = process.env.DEV_ADMIN_TOKEN || '';
if (DEV_ADMIN_TOKEN) console.warn('[admin] DEV_ADMIN_TOKEN is set: dev admin login enabled');

// --- State -----------------------------------------------------------------
// One class session at a time, held in memory and snapshotted to Firestore.

const newState = () => ({
  sessionId: crypto.randomUUID(),
  createdAt: Date.now(),
  joinOpen: true,
  gameIndex: -1,
  phase: 'lobby', // lobby | open | closed | revealed
  revealed: {},
  participants: {}, // uid -> { pseudonym, joinedAt, lastSeen }
  games: {}, // key -> { startedAt, closedAt, units: [...] }
});

let state = newState();
let gemini = {}; // model -> results (see gemini.js)
const sockets = new Map(); // uid -> Set(socket id)

let saveTimer = null;
const save = () => {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    const json = JSON.stringify(state);
    if (json.length > 900000) console.warn(`[save] state is ${json.length} bytes, near Firestore's 1MB limit`);
    try {
      await sessionsCol.doc(state.sessionId).set({ json, updatedAt: new Date() });
      await pointerDoc.set({ sessionId: state.sessionId });
    } catch (error) {
      console.error('[save] failed:', error.message);
    }
  }, 1000);
};

const load = async () => {
  try {
    const pointer = await pointerDoc.get();
    if (pointer.exists) {
      const snap = await sessionsCol.doc(pointer.data().sessionId).get();
      if (snap.exists) state = JSON.parse(snap.data().json);
    }
    const geminiDocs = await geminiCol.get();
    for (const d of geminiDocs.docs) gemini[d.id] = d.data();
  } catch (error) {
    console.error('[load] failed, starting fresh:', error.message);
  }
  console.log(`[load] session ${state.sessionId}, ${Object.keys(state.participants).length} participants, phase ${state.phase}`);
};

// --- Participants ----------------------------------------------------------

const ADJECTIVES = ['Teal', 'Amber', 'Coral', 'Indigo', 'Jade', 'Crimson', 'Golden', 'Silver', 'Violet', 'Olive',
  'Azure', 'Rusty', 'Misty', 'Sunny', 'Quiet', 'Brave', 'Clever', 'Gentle', 'Lucky', 'Swift',
  'Mellow', 'Bold', 'Witty', 'Cosmic', 'Breezy', 'Frosty', 'Mossy', 'Sandy', 'Stormy', 'Velvet'];
const ANIMALS = ['Otter', 'Heron', 'Lynx', 'Badger', 'Falcon', 'Gecko', 'Moose', 'Panda', 'Quokka', 'Raven',
  'Salmon', 'Tapir', 'Walrus', 'Yak', 'Bison', 'Coyote', 'Dingo', 'Egret', 'Ferret', 'Ibex',
  'Koala', 'Lemur', 'Marmot', 'Newt', 'Ocelot', 'Puffin', 'Robin', 'Seal', 'Toucan', 'Wombat'];

const newPseudonym = () => {
  const taken = new Set(Object.values(state.participants).map((p) => p.pseudonym));
  for (let i = 0; i < 1000; i++) {
    const name = `${ADJECTIVES[crypto.randomInt(ADJECTIVES.length)]} ${ANIMALS[crypto.randomInt(ANIMALS.length)]}`;
    if (!taken.has(name)) return name;
  }
  return `Player ${Object.keys(state.participants).length + 1}`;
};

const isConnected = (uid) => (sockets.get(uid)?.size || 0) > 0;
const presentUids = () => Object.entries(state.participants)
  .filter(([uid, p]) => isConnected(uid) || Date.now() - p.lastSeen < PRESENT_MS)
  .map(([uid]) => uid);

// --- Game engine -----------------------------------------------------------

const currentKey = () => (state.gameIndex >= 0 ? g.GAME_ORDER[state.gameIndex] : null);
const currentUnits = () => state.games[currentKey()]?.units || [];
const isHuman = (uid) => uid !== g.BOT;
const other = (unit, uid) => (unit.members[0] === uid ? unit.members[1] : unit.members[0]);

// The decision steps a member owes in a unit, in order.
const stepsFor = (key, unit, uid) => {
  if (key === 'pd' || key === 'coord') return ['move'];
  if (key === 'ultimatum') return unit.roles[uid] === 'proposer' ? ['offer'] : ['minAccept', 'response'];
  if (key === 'dictator') return unit.members[0] === uid ? ['give'] : [];
  return [];
};

const proposerOf = (unit) => unit.members.find((m) => unit.roles[m] === 'proposer');
const responderOf = (unit) => unit.members.find((m) => unit.roles[m] === 'responder');

const hasStep = (unit, uid, step) => (step === 'minAccept' ? uid in unit.minAccept : uid in unit.moves);

const resolve = (key, unit) => {
  if (unit.payoffs) return;
  const [a, b] = unit.members;
  let pay = null;
  if ((key === 'pd' || key === 'coord') && a in unit.moves && b in unit.moves) {
    pay = (key === 'pd' ? g.pdPayoffs : g.coordPayoffs)(unit.moves[a], unit.moves[b]);
  } else if (key === 'ultimatum') {
    const p = proposerOf(unit), r = responderOf(unit);
    if (r in unit.moves) {
      const [pp, rp] = g.ultimatumPayoffs(unit.moves[p], unit.moves[r]);
      pay = a === p ? [pp, rp] : [rp, pp];
    }
  } else if (key === 'dictator' && a in unit.moves) {
    pay = g.dictatorPayoffs(unit.moves[a]);
  }
  if (pay) {
    unit.payoffs = { [a]: pay[0], [b]: pay[1] };
    unit.decidedAt = Date.now();
  }
};

// The responder's clock starts once the offer is in and they've answered (or
// skipped) the "lowest offer" question, so that question doesn't eat into it.
const armResponse = (unit, now) => {
  const r = responderOf(unit);
  const ready = proposerOf(unit) in unit.moves && r in unit.minAccept && !(r in unit.moves);
  if (isHuman(r) && ready && !unit.deadlines[`${r}:response`]) unit.deadlines[`${r}:response`] = now + DECISION_MS;
};

// Records a move (human or bot) and runs any follow-on steps.
const applyMove = (key, unit, uid, step, value, now) => {
  if (step === 'minAccept') {
    unit.minAccept[uid] = value;
  } else {
    unit.moves[uid] = value;
  }
  delete unit.deadlines[`${uid}:${step}`];
  if (key === 'ultimatum' && step === 'offer') {
    unit.offerAt = now;
    const r = responderOf(unit);
    if (!isHuman(r)) unit.moves[r] = g.botMove('ultimatum', 'response', Math.random, { offer: value });
  }
  if (key === 'ultimatum') armResponse(unit, now);
  resolve(key, unit);
};

const startGame = (index) => {
  const key = g.GAME_ORDER[index];
  const now = Date.now();
  const players = presentUids();
  const edges = key === 'dictator' ? g.makeDictatorCycle(players) : g.makePairs(players);
  const units = edges.map((members, i) => {
    const unit = {
      id: `${key}-${i}`, members, roles: {}, moves: {}, minAccept: {}, deadlines: {},
      timedOut: [], bot: members.includes(g.BOT), payoffs: null, offerAt: null, decidedAt: null,
    };
    if (key === 'ultimatum') {
      const [p, r] = Math.random() < 0.5 ? members : [members[1], members[0]];
      unit.roles = { [p]: 'proposer', [r]: 'responder' };
    }
    if (key === 'dictator') unit.roles = { [members[0]]: 'dictator', [members[1]]: 'recipient' };
    for (const uid of members) {
      for (const step of stepsFor(key, unit, uid)) {
        if (step === 'response') continue; // set once the offer arrives
        if (isHuman(uid)) unit.deadlines[`${uid}:${step}`] = now + DECISION_MS;
      }
    }
    // Bots move right away (a bot responder answers when the offer arrives).
    const bot = members.find((m) => !isHuman(m));
    if (bot) {
      for (const step of stepsFor(key, unit, bot)) {
        if (step !== 'response') applyMove(key, unit, bot, step, g.botMove(key, step), now);
      }
    }
    return unit;
  });
  state.games[key] = { startedAt: now, closedAt: null, units };
  state.gameIndex = index;
  state.phase = 'open';
};

// Fills every missing human decision with a bot move and flags it.
// `onlyExpired` limits this to decisions past their deadline.
const fillMissing = (onlyExpired) => {
  const key = currentKey();
  const now = Date.now();
  const touched = new Set();
  for (const unit of currentUnits()) {
    for (const [k, deadline] of Object.entries(unit.deadlines)) {
      if (onlyExpired && deadline > now) continue;
      const [uid, step] = k.split(':');
      if (step === 'minAccept') {
        unit.minAccept[uid] = null; // optional question; no bot answer
        delete unit.deadlines[k];
        armResponse(unit, now);
      } else {
        if (!unit.timedOut.includes(uid)) unit.timedOut.push(uid);
        const context = { offer: unit.moves[proposerOf(unit)] };
        applyMove(key, unit, uid, step, g.botMove(key, step, Math.random, context), now);
      }
      unit.members.filter(isHuman).forEach((m) => touched.add(m));
    }
    // A responder with no deadline yet (proposer still pending) when closing.
    if (!onlyExpired) {
      for (const k of Object.keys(unit.deadlines)) {
        const [uid, step] = k.split(':');
        if (!unit.timedOut.includes(uid)) unit.timedOut.push(uid);
        applyMove(key, unit, uid, step, g.botMove(key, step, Math.random, { offer: unit.moves[proposerOf(unit)] }), now);
      }
    }
  }
  return touched;
};

const submit = (uid, gameKey, step, value) => {
  const key = currentKey();
  if (state.phase !== 'open' || gameKey !== key || !g.isValidMove(key, step, value)) return false;
  const unit = currentUnits().find((u) => u.members.includes(uid) && stepsFor(key, u, uid).includes(step) && !hasStep(u, uid, step));
  if (!unit) return false;
  if (step === 'response' && !(proposerOf(unit) in unit.moves)) return false;
  if (step === 'response' && !(uid in unit.minAccept)) return false; // answer minAccept before seeing the offer
  applyMove(key, unit, uid, step, value, Date.now());
  unit.members.filter(isHuman).forEach(pushStudent);
  return true;
};

// --- Views -----------------------------------------------------------------

const studentView = (uid) => {
  const p = state.participants[uid];
  const key = currentKey();
  const base = { pseudonym: p.pseudonym, sessionId: state.sessionId, game: key, gameNumber: state.gameIndex + 1 };
  const units = currentUnits().filter((u) => u.members.includes(uid));
  if (!key || units.length === 0) return { ...base, screen: 'lobby', game: null };

  if (key === 'dictator') {
    const mine = units.find((u) => u.members[0] === uid);
    const toMe = units.find((u) => u.members[1] === uid);
    if (!(uid in mine.moves)) return { ...base, screen: 'decide', role: 'dictator', deadline: mine.deadlines[`${uid}:give`] };
    const received = toMe && toMe.payoffs ? toMe.payoffs[uid] : null;
    return {
      ...base, screen: 'result', give: mine.moves[uid], kept: g.PIE - mine.moves[uid],
      received, receivedPending: Boolean(toMe) && received === null,
      iTimedOut: mine.timedOut.includes(uid),
      giverWasComputer: toMe ? !isHuman(toMe.members[0]) || toMe.timedOut.includes(toMe.members[0]) : false,
    };
  }

  const unit = units[0];
  const partner = other(unit, uid);
  const flags = {
    iTimedOut: unit.timedOut.includes(uid),
    partnerWasComputer: !isHuman(partner) || unit.timedOut.includes(partner),
  };

  if (key === 'pd' || key === 'coord') {
    if (!(uid in unit.moves)) return { ...base, screen: 'decide', deadline: unit.deadlines[`${uid}:move`] };
    if (!unit.payoffs) return { ...base, screen: 'waiting', myMove: unit.moves[uid] };
    return { ...base, screen: 'result', ...flags, myMove: unit.moves[uid], partnerMove: unit.moves[partner], points: unit.payoffs[uid] };
  }

  // ultimatum
  const role = unit.roles[uid];
  const offer = unit.moves[proposerOf(unit)];
  const response = unit.moves[responderOf(unit)];
  if (unit.payoffs) return { ...base, screen: 'result', role, ...flags, offer, accepted: response, points: unit.payoffs[uid] };
  if (role === 'proposer') {
    if (!(uid in unit.moves)) return { ...base, screen: 'decide', role, deadline: unit.deadlines[`${uid}:offer`] };
    return { ...base, screen: 'waiting', role, offer };
  }
  if (!(uid in unit.minAccept)) return { ...base, screen: 'minAccept', role, deadline: unit.deadlines[`${uid}:minAccept`] };
  if (offer === undefined) return { ...base, screen: 'waiting', role };
  return { ...base, screen: 'decide', role, offer, deadline: unit.deadlines[`${uid}:response`] };
};

const pushStudent = (uid) => {
  if (!state.participants[uid]) return;
  const view = studentView(uid);
  for (const id of sockets.get(uid) || []) io.to(id).emit('view', view);
};
const pushAllStudents = () => Object.keys(state.participants).forEach(pushStudent);

// Humans who have made their main decision in the current game, out of all humans in it.
const progress = () => {
  const key = currentKey();
  let decided = 0, total = 0;
  for (const unit of currentUnits()) {
    for (const uid of unit.members.filter(isHuman)) {
      const main = stepsFor(key, unit, uid).filter((s) => s !== 'minAccept');
      if (main.length === 0) continue;
      total += 1;
      if (main.every((s) => uid in unit.moves)) decided += 1;
    }
  }
  return { decided, total };
};

const dashboardSummary = () => ({
  sessionId: state.sessionId,
  joinOpen: state.joinOpen,
  phase: state.phase,
  gameIndex: state.gameIndex,
  game: currentKey(),
  order: g.GAME_ORDER,
  present: presentUids().length,
  joined: Object.keys(state.participants).length,
  progress: progress(),
  // Results only for revealed games, so nothing reaches the projector early.
  results: Object.fromEntries(Object.keys(state.revealed).map((k) => [k, state.games[k]])),
  gemini,
});

let dashTimer = null;
const pushDashboard = () => {
  if (dashTimer) return;
  dashTimer = setTimeout(() => {
    dashTimer = null;
    io.to('dashboard').emit('summary', dashboardSummary());
  }, 300);
};

const changed = () => { save(); pushDashboard(); };

setInterval(() => {
  if (state.phase !== 'open') return;
  const touched = fillMissing(true);
  if (touched.size) {
    touched.forEach(pushStudent);
    changed();
  }
}, 1000).unref();

// --- Admin -----------------------------------------------------------------

const verifyAdmin = async (token) => {
  if (DEV_ADMIN_TOKEN && token === DEV_ADMIN_TOKEN) return 'dev@localhost';
  if (!token || !OAUTH_CLIENT_ID) return null;
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken: token, audience: OAUTH_CLIENT_ID });
    const payload = ticket.getPayload();
    const email = (payload?.email || '').toLowerCase();
    return payload?.email_verified && ADMIN_EMAILS.includes(email) ? email : null;
  } catch {
    return null;
  }
};

const adminCommand = (cmd) => {
  if (cmd === 'start' && (state.phase === 'lobby' || state.phase === 'revealed') && state.gameIndex + 1 < g.GAME_ORDER.length) {
    startGame(state.gameIndex + 1);
    pushAllStudents();
  } else if (cmd === 'close' && state.phase === 'open') {
    fillMissing(false);
    state.phase = 'closed';
    state.games[currentKey()].closedAt = Date.now();
    pushAllStudents();
  } else if (cmd === 'reveal' && (state.phase === 'open' || state.phase === 'closed')) {
    if (state.phase === 'open') adminCommand('close');
    state.phase = 'revealed';
    state.revealed[currentKey()] = true;
  } else if (cmd === 'toggleJoin') {
    state.joinOpen = !state.joinOpen;
  } else if (cmd === 'newSession') {
    const keep = Object.keys(state.participants).filter(isConnected);
    state = newState();
    for (const uid of keep) state.participants[uid] = { pseudonym: newPseudonym(), joinedAt: Date.now(), lastSeen: Date.now() };
    pushAllStudents();
  } else if (cmd === 'runGemini') {
    startGeminiRuns();
    return;
  } else {
    return;
  }
  changed();
};

let geminiRunning = false;
const startGeminiRuns = async () => {
  if (geminiRunning) return;
  geminiRunning = true;
  try {
    for (const model of GEMINI_MODELS) {
      gemini[model] = { status: 'running', updatedAt: Date.now() };
      pushDashboard();
      gemini[model] = await runGemini(model);
      await geminiCol.doc(model).set(gemini[model]).catch((e) => console.error('[gemini] save failed:', e.message));
      pushDashboard();
    }
  } finally {
    geminiRunning = false;
  }
};

// --- Sockets ---------------------------------------------------------------

const UID_RE = /^[A-Za-z0-9-]{8,64}$/;

io.on('connection', (socket) => {
  socket.on('hello', ({ uid } = {}) => {
    if (typeof uid !== 'string' || !UID_RE.test(uid)) return;
    if (!state.participants[uid]) {
      if (!state.joinOpen) {
        socket.emit('join_closed');
        return;
      }
      state.participants[uid] = { pseudonym: newPseudonym(), joinedAt: Date.now(), lastSeen: Date.now() };
      changed();
    }
    socket.data.uid = uid;
    if (!sockets.has(uid)) sockets.set(uid, new Set());
    sockets.get(uid).add(socket.id);
    state.participants[uid].lastSeen = Date.now();
    socket.emit('view', studentView(uid));
    pushDashboard();
  });

  socket.on('submit', ({ game, step, value } = {}) => {
    const uid = socket.data.uid;
    if (!uid || !state.participants[uid]) return;
    if (submit(uid, game, step, value)) changed();
    else socket.emit('view', studentView(uid));
  });

  socket.on('admin_hello', async ({ token } = {}) => {
    const email = await verifyAdmin(token);
    if (!email) {
      socket.emit('admin_denied');
      return;
    }
    socket.data.admin = email;
    socket.join('dashboard');
    socket.emit('summary', dashboardSummary());
  });

  socket.on('admin_cmd', ({ cmd } = {}) => {
    if (!socket.data.admin) return;
    console.log(`[admin] ${socket.data.admin}: ${cmd}`);
    adminCommand(cmd);
  });

  socket.on('disconnect', () => {
    const uid = socket.data.uid;
    if (!uid) return;
    sockets.get(uid)?.delete(socket.id);
    if (state.participants[uid]) state.participants[uid].lastSeen = Date.now();
    save();
    pushDashboard();
  });
});

// --- HTTP ------------------------------------------------------------------

app.get('/api/config', (req, res) => {
  res.json({ oauthClientId: OAUTH_CLIENT_ID });
});

app.get('/api/games', (req, res) => {
  res.json({ order: g.GAME_ORDER, games: g.GAMES, pie: g.PIE });
});

const csvEscape = (v) => {
  if (v === undefined || v === null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// One row per human per unit, plus one row per Gemini answer.
app.get('/api/admin/export.csv', async (req, res) => {
  const email = await verifyAdmin((req.headers.authorization || '').replace(/^Bearer /, ''));
  if (!email) return res.status(401).send('unauthorized');
  const cols = ['source', 'session_id', 'game', 'unit_id', 'player_id', 'pseudonym', 'role', 'decision', 'min_accept',
    'partner_id', 'partner_decision', 'points', 'partner_is_bot', 'timed_out', 'partner_timed_out', 'started_at', 'decided_at'];
  const rows = [];
  for (const key of g.GAME_ORDER) {
    const game = state.games[key];
    if (!game) continue;
    for (const unit of game.units) {
      for (const uid of unit.members.filter(isHuman)) {
        if (key === 'dictator' && uid !== unit.members[0]) continue; // the dictator's row covers this unit
        const partner = other(unit, uid);
        rows.push({
          source: 'student', session_id: state.sessionId, game: key, unit_id: unit.id, player_id: uid,
          pseudonym: state.participants[uid]?.pseudonym, role: unit.roles[uid] || '',
          decision: unit.moves[uid], min_accept: unit.minAccept[uid],
          partner_id: partner, partner_decision: unit.moves[partner],
          points: unit.payoffs?.[uid], partner_is_bot: !isHuman(partner),
          timed_out: unit.timedOut.includes(uid), partner_timed_out: unit.timedOut.includes(partner),
          started_at: new Date(game.startedAt).toISOString(),
          decided_at: unit.decidedAt ? new Date(unit.decidedAt).toISOString() : '',
        });
      }
    }
  }
  for (const [model, r] of Object.entries(gemini)) {
    for (const [field, values] of Object.entries(r.answers || {})) {
      (Array.isArray(values) ? values : []).forEach((v, i) => rows.push({ source: model, game: field, unit_id: `run-${i + 1}`, decision: v }));
    }
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="symsys-games-${state.sessionId.slice(0, 8)}.csv"`);
  res.send([cols.join(',')].concat(rows.map((r) => cols.map((c) => csvEscape(r[c])).join(','))).join('\n'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 8080;
load().then(() => {
  server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
  if (GEMINI_MODELS.some((m) => !gemini[m] || gemini[m].status !== 'done')) startGeminiRuns();
});
