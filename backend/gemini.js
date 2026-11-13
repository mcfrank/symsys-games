// Gemini as a class participant: each game prompt, built from the same text
// students see, is run RUNS times per model. Sampling parameters aren't set
// (Google ignores them on current models), so the variation across runs is
// the model's own default sampling.

const { GoogleGenAI } = require('@google/genai');
const g = require('./games');

const GEMINI_MODELS = (process.env.GEMINI_PARTICIPANT_MODELS || 'gemini-2.5-flash,gemini-3.8-flash')
  .split(',').map((m) => m.trim()).filter(Boolean);
const RUNS = Number.parseInt(process.env.GEMINI_RUNS || '10', 10);
const CONCURRENCY = 8;

let client = null;
const getClient = () => (client ||= new GoogleGenAI({}));

const FRAME = 'You are taking part in a game during a university class.';
const NUMBER = 'Answer with a single whole number from 0 to 10 and nothing else.';

const pdPrompt = () => {
  const p = g.GAMES.pd.payoffs;
  return `${FRAME}\n\n${g.GAMES.pd.scenario}\n\nPoints (yours / your partner's):
- You clean up, partner cleans up: ${p.clean.clean.join(' / ')}
- You clean up, partner pollutes: ${p.clean.pollute.join(' / ')}
- You pollute, partner cleans up: ${p.pollute.clean.join(' / ')}
- You both pollute: ${p.pollute.pollute.join(' / ')}

What do you choose? Answer with one word, "clean" or "pollute", and nothing else.`;
};

const ultimatum = g.GAMES.ultimatum.scenario;
const offerPrompt = () => `${FRAME}\n\n${ultimatum}\n\nYou are the proposer. How many points do you offer the responder? ${NUMBER}`;
const minAcceptPrompt = () => `${FRAME}\n\n${ultimatum}\n\nYou are the responder. ${g.GAMES.ultimatum.minAcceptQuestion} ${NUMBER}`;
const responsePrompt = (offer) => `${FRAME}\n\n${ultimatum}\n\nYou are the responder. The proposer offers you ${offer} points and would keep ${g.PIE - offer}. Do you accept or reject? Answer with one word, "accept" or "reject", and nothing else.`;
const dictatorPrompt = () => `${FRAME}\n\n${g.GAMES.dictator.scenario}\n\nHow many points do you give? ${NUMBER}`;
// Options are shuffled on every run, as they are for students.
const coordPrompt = () => `${FRAME}\n\n${g.GAMES.coord.scenario}\n\nOptions:\n${g.shuffle(g.COORD_OPTIONS).map((o) => `- ${o}`).join('\n')}\n\nAnswer with one option, written exactly as above, and nothing else.`;

// Earliest matching token wins; null if nothing matches.
const firstOf = (text, choices) => {
  let best = null, bestIdx = Infinity;
  for (const [needle, value] of choices) {
    const idx = text.toLowerCase().indexOf(needle.toLowerCase());
    if (idx >= 0 && idx < bestIdx) { best = value; bestIdx = idx; }
  }
  return best;
};
const parseNumber = (text) => {
  const m = text.match(/\b(10|[0-9])\b/);
  return m ? Number(m[1]) : null;
};
const parsers = {
  pd: (t) => firstOf(t, [['clean', 'clean'], ['pollute', 'pollute']]),
  number: parseNumber,
  response: (t) => firstOf(t, [['accept', true], ['reject', false]]),
  // Match on the first part of each option (e.g. "Main Quad", "Tresidder").
  coord: (t) => firstOf(t, g.COORD_OPTIONS.map((o) => [o.split(' / ')[0], o])),
};

const ask = async (model, prompt, parse) => {
  try {
    const r = await getClient().models.generateContent({ model, contents: prompt });
    return parse(r.text || '');
  } catch (error) {
    console.error(`[gemini] ${model}:`, error.message);
    return null;
  }
};

const runPool = async (tasks) => {
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) await tasks[next++]();
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
};

// Returns { model, status, runs, updatedAt, answers: { field: [one value per run] } }.
// Fields: pd, offer, minAccept, response_0 ... response_10, dictator, coord.
// A null value is an unparseable or failed answer.
const runGemini = async (model) => {
  const answers = { pd: [], offer: [], minAccept: [], dictator: [], coord: [] };
  for (let o = 0; o <= g.PIE; o++) answers[`response_${o}`] = [];
  const tasks = [];
  for (let i = 0; i < RUNS; i++) {
    tasks.push(async () => { answers.pd[i] = await ask(model, pdPrompt(), parsers.pd); });
    tasks.push(async () => { answers.offer[i] = await ask(model, offerPrompt(), parsers.number); });
    tasks.push(async () => { answers.minAccept[i] = await ask(model, minAcceptPrompt(), parsers.number); });
    tasks.push(async () => { answers.dictator[i] = await ask(model, dictatorPrompt(), parsers.number); });
    tasks.push(async () => { answers.coord[i] = await ask(model, coordPrompt(), parsers.coord); });
    for (let o = 0; o <= g.PIE; o++) {
      tasks.push(async () => { answers[`response_${o}`][i] = await ask(model, responsePrompt(o), parsers.response); });
    }
  }
  const started = Date.now();
  await runPool(tasks);
  // Fill gaps left by failed calls so arrays have one slot per run.
  for (const k of Object.keys(answers)) answers[k] = Array.from({ length: RUNS }, (_, i) => answers[k][i] ?? null);
  console.log(`[gemini] ${model}: ${tasks.length} calls in ${Math.round((Date.now() - started) / 1000)}s`);
  return { model, status: 'done', runs: RUNS, updatedAt: Date.now(), answers };
};

module.exports = { runGemini, GEMINI_MODELS, parsers, prompts: { pdPrompt, offerPrompt, minAcceptPrompt, responsePrompt, dictatorPrompt, coordPrompt } };
