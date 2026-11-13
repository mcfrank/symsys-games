const test = require('node:test');
const assert = require('node:assert/strict');
const { parsers, prompts } = require('../gemini');

test('parsers pull the answer out of short model replies', () => {
  assert.equal(parsers.pd('Pollute'), 'pollute');
  assert.equal(parsers.pd('clean'), 'clean');
  assert.equal(parsers.pd('I would clean up rather than pollute.'), 'clean');
  assert.equal(parsers.pd('no idea'), null);
  assert.equal(parsers.number('4'), 4);
  assert.equal(parsers.number('10'), 10);
  assert.equal(parsers.number('I offer 5 points.'), 5);
  assert.equal(parsers.number('none'), null);
  assert.equal(parsers.response('Accept'), true);
  assert.equal(parsers.response('reject'), false);
  assert.equal(parsers.coord('Main Quad / Memorial Church'), 'Main Quad / Memorial Church');
  assert.equal(parsers.coord('Hoover Tower.'), 'Hoover Tower');
  assert.equal(parsers.coord('tresidder'), 'Tresidder / CoHo');
});

test('prompts contain the same game text and payoffs students see', () => {
  const pd = prompts.pdPrompt();
  assert.match(pd, /-10 \/ 0/);
  assert.match(pd, /-8 \/ -8/);
  assert.match(prompts.responsePrompt(3), /offers you 3 points and would keep 7/);
  assert.equal((prompts.coordPrompt().match(/^- /gm) || []).length, 7);
});
