const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('../games');

test('PD payoffs match the slide matrix (row / column)', () => {
  assert.deepEqual(g.pdPayoffs('clean', 'clean'), [-2, -2]);
  assert.deepEqual(g.pdPayoffs('clean', 'pollute'), [-10, 0]);
  assert.deepEqual(g.pdPayoffs('pollute', 'clean'), [0, -10]);
  assert.deepEqual(g.pdPayoffs('pollute', 'pollute'), [-8, -8]);
});

test('PD: polluting is a dominant strategy, so both polluting is the Nash equilibrium', () => {
  for (const partner of ['clean', 'pollute']) {
    assert.ok(g.pdPayoffs('pollute', partner)[0] > g.pdPayoffs('clean', partner)[0]);
  }
});

test('ultimatum payoffs: accept gives (10 - offer, offer); reject gives (0, 0)', () => {
  for (let offer = 0; offer <= 10; offer++) {
    assert.deepEqual(g.ultimatumPayoffs(offer, true), [10 - offer, offer]);
    assert.deepEqual(g.ultimatumPayoffs(offer, false), [0, 0]);
  }
});

test('dictator payoffs: (10 - give, give)', () => {
  for (let give = 0; give <= 10; give++) {
    assert.deepEqual(g.dictatorPayoffs(give), [10 - give, give]);
  }
});

test('coordination: +5 each on a match, 0 otherwise', () => {
  assert.deepEqual(g.coordPayoffs('Hoover Tower', 'Hoover Tower'), [5, 5]);
  assert.deepEqual(g.coordPayoffs('Hoover Tower', 'The Oval'), [0, 0]);
  assert.equal(g.COORD_OPTIONS.length, 7);
  assert.ok(!g.COORD_OPTIONS.includes('Other'));
});

test('move validation', () => {
  assert.ok(g.isValidMove('pd', 'move', 'clean'));
  assert.ok(!g.isValidMove('pd', 'move', 'defect'));
  assert.ok(g.isValidMove('ultimatum', 'offer', 0));
  assert.ok(g.isValidMove('ultimatum', 'offer', 10));
  assert.ok(!g.isValidMove('ultimatum', 'offer', 11));
  assert.ok(!g.isValidMove('ultimatum', 'offer', 2.5));
  assert.ok(!g.isValidMove('ultimatum', 'offer', '5'));
  assert.ok(g.isValidMove('ultimatum', 'response', false));
  assert.ok(!g.isValidMove('ultimatum', 'response', 'yes'));
  assert.ok(g.isValidMove('dictator', 'give', 3));
  assert.ok(g.isValidMove('coord', 'move', 'Old Union'));
  assert.ok(!g.isValidMove('coord', 'move', 'Other'));
});

test('bot moves follow the handoff', () => {
  assert.equal(g.botMove('ultimatum', 'offer'), 4);
  assert.equal(g.botMove('ultimatum', 'response', Math.random, { offer: 3 }), true);
  assert.equal(g.botMove('ultimatum', 'response', Math.random, { offer: 2 }), false);
  assert.equal(g.botMove('dictator', 'give'), 2);
  assert.equal(g.botMove('coord', 'move'), 'Main Quad / Memorial Church');
  assert.equal(g.botMove('pd', 'move', () => 0.1), 'clean');
  assert.equal(g.botMove('pd', 'move', () => 0.9), 'pollute');
});

const ids = (n) => Array.from({ length: n }, (_, i) => `u${i}`);

test('makePairs: everyone appears exactly once; odd count gets one bot', () => {
  for (const n of [0, 1, 2, 3, 10, 251]) {
    const pairs = g.makePairs(ids(n));
    const flat = pairs.flat().filter((u) => u !== g.BOT);
    assert.equal(flat.length, n);
    assert.equal(new Set(flat).size, n);
    assert.equal(pairs.flat().filter((u) => u === g.BOT).length, n % 2);
  }
});

test('makeDictatorCycle: everyone gives once and receives once, never to themselves', () => {
  for (const n of [2, 3, 7, 250]) {
    const edges = g.makeDictatorCycle(ids(n));
    assert.equal(edges.length, n);
    assert.equal(new Set(edges.map((e) => e[0])).size, n);
    assert.equal(new Set(edges.map((e) => e[1])).size, n);
    for (const [from, to] of edges) assert.notEqual(from, to);
  }
  assert.deepEqual(g.makeDictatorCycle(['solo']), [['solo', g.BOT]]);
  assert.deepEqual(g.makeDictatorCycle([]), []);
});
