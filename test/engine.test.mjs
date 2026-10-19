import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState, SYMBOLS } from '../src/domain.mjs';
import { applyStrategies, recordPrices, signalFor } from '../src/engine.mjs';

const config = { feeRate: 0.001, slippageRate: 0.0005 };

function prices(value, timestamp) {
  return Object.fromEntries(SYMBOLS.map((symbol) => [symbol, { usd: value, timestamp, source: 'test' }]));
}

test('benchmark invests once and momentum waits for enough history', () => {
  const state = createInitialState(1_000);
  recordPrices(state, prices(100, '2026-01-01T00:00:00Z'));
  applyStrategies(state, config, '2026-01-01T00:00:00Z');
  assert.equal(state.portfolios.buyHold.trades.length, SYMBOLS.length);
  assert.equal(state.portfolios.momentum.trades.length, 0);
  applyStrategies(state, config, '2026-01-01T00:01:00Z');
  assert.equal(state.portfolios.buyHold.trades.length, SYMBOLS.length);
});

test('momentum buys after a confirmed rising window', () => {
  const state = createInitialState(1_000);
  for (let index = 0; index < 10; index += 1) recordPrices(state, prices(100 + index, `2026-01-01T00:0${index}:00Z`));
  applyStrategies(state, config, '2026-01-01T00:10:00Z');
  assert.equal(state.portfolios.momentum.trades.length, 5);
  assert.equal(state.mode, 'PAPER_ONLY');
});

test('adaptive signal requires confirmation from momentum and trend', () => {
  let value = 100;
  const rising = Array.from({ length: 20 }, (_, index) => {
    value += index % 2 === 0 ? 0.5 : -0.2;
    return value;
  });
  const signal = signalFor(rising);
  assert.equal(signal.ready, true);
  assert.equal(signal.label, 'COMPRA');
  assert.ok(signal.score >= 4);
});
