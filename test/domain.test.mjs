import assert from 'node:assert/strict';
import test from 'node:test';
import { createPortfolio, executePaperTrade, migrateState, portfolioValue } from '../src/domain.mjs';

test('paper buy and sell account for fees and slippage without overspending', () => {
  const portfolio = createPortfolio('test', 1_000);
  assert.equal(executePaperTrade(portfolio, { symbol: 'BTC', side: 'BUY', requestedUsd: 1_000, priceUsd: 100, feeRate: 0.001, slippageRate: 0.0005, timestamp: 'now' }), true);
  assert.ok(portfolio.cashUsd >= -1e-9);
  assert.equal(portfolio.trades.length, 1);
  const valueAfterBuy = portfolioValue(portfolio, { BTC: { usd: 100 }, ETH: { usd: 1 }, SOL: { usd: 1 } });
  assert.ok(valueAfterBuy < 1_000);
  assert.equal(executePaperTrade(portfolio, { symbol: 'BTC', side: 'SELL', requestedUsd: Number.MAX_SAFE_INTEGER, priceUsd: 110, feeRate: 0.001, slippageRate: 0.0005, timestamp: 'later' }), true);
  assert.ok(portfolio.positions.BTC < 1e-9);
  assert.equal(portfolio.trades.length, 2);
});

test('broker rejects unknown assets and sides', () => {
  const portfolio = createPortfolio('test', 1_000);
  assert.throws(() => executePaperTrade(portfolio, { symbol: 'DOT', side: 'BUY', requestedUsd: 10, priceUsd: 1, feeRate: 0, slippageRate: 0, timestamp: 'now' }), /Unsupported symbol/);
  assert.throws(() => executePaperTrade(portfolio, { symbol: 'BTC', side: 'TRANSFER', requestedUsd: 10, priceUsd: 1, feeRate: 0, slippageRate: 0, timestamp: 'now' }), /Unsupported side/);
});

test('schema migration preserves old balances and adds the adaptive portfolio', () => {
  const old = {
    schemaVersion: 1,
    mode: 'PAPER_ONLY',
    history: { BTC: [{ usd: 100 }] },
    portfolios: { buyHold: createPortfolio('Buy & Hold', 1_000) },
  };
  old.portfolios.buyHold.cashUsd = 900;
  const migrated = migrateState(old, 1_000);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.portfolios.buyHold.cashUsd, 900);
  assert.equal(migrated.portfolios.adaptive.cashUsd, 1_000);
  assert.deepEqual(migrated.history.AVAX, []);
});
