import assert from 'node:assert/strict';
import test from 'node:test';
import { createPortfolio, executePaperTrade, portfolioValue } from '../src/domain.mjs';

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
  assert.throws(() => executePaperTrade(portfolio, { symbol: 'DOGE', side: 'BUY', requestedUsd: 10, priceUsd: 1, feeRate: 0, slippageRate: 0, timestamp: 'now' }), /Unsupported symbol/);
  assert.throws(() => executePaperTrade(portfolio, { symbol: 'BTC', side: 'TRANSFER', requestedUsd: 10, priceUsd: 1, feeRate: 0, slippageRate: 0, timestamp: 'now' }), /Unsupported side/);
});
