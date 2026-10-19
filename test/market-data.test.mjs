import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverUniverse, fetchPrices, marketDataPolicy } from '../src/market-data.mjs';

function ticker(price, volume = 100_000, trades = 10_000, spread = 0.001) {
  return {
    c: [String(price)],
    a: [String(price * (1 + spread / 2))],
    b: [String(price * (1 - spread / 2))],
    v: ['0', String(volume)],
    t: [0, trades],
  };
}

function response(result) {
  return { ok: true, headers: new Headers({ 'content-length': '200' }), json: async () => ({ error: [], result }) };
}

test('market adapter is unauthenticated GET-only and validates selected prices', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return response({ 'BTC/USD': ticker(60_000), 'ETH/USD': ticker(3_000) });
  };
  const result = await fetchPrices({ symbols: ['BTC', 'ETH'], fetchImpl });
  assert.equal(request.url.hostname, 'api.kraken.com');
  assert.equal(request.options.method, 'GET');
  assert.equal(result.BTC.usd, 60_000);
  assert.equal(request.url.searchParams.get('pair'), 'BTCUSD,ETHUSD');
  assert.deepEqual(marketDataPolicy, { method: 'GET', origin: 'https://api.kraken.com', path: '/0/public/Ticker', authenticated: false });
});

test('universe discovery ranks liquid USD markets and excludes stablecoins and wide spreads', async () => {
  const result = {
    'BTC/USD': ticker(60_000, 1_000),
    'ETH/USD': ticker(3_000, 10_000),
    'SOL/USD': ticker(150, 100_000),
    'USDT/USD': ticker(1, 100_000_000),
    'EUR/USD': ticker(1.1, 100_000_000),
    'WIDE/USD': ticker(5, 10_000_000, 10_000, 0.03),
    'BTC/EUR': ticker(55_000, 1_000),
  };
  const universe = await discoverUniverse({ fetchImpl: async () => response(result), limit: 3, minimumDailyVolumeUsd: 1_000, maximumSpreadPercent: 0.01 });
  assert.deepEqual(universe.symbols, ['BTC', 'ETH', 'SOL']);
  assert.equal(universe.markets.BTC.rank, 1);
  assert.equal(universe.markets.USDT, undefined);
  assert.equal(universe.markets.EUR, undefined);
});

test('market adapter rejects malformed data', async () => {
  const fetchImpl = async () => response({});
  await assert.rejects(fetchPrices({ symbols: ['BTC'], fetchImpl }), /Invalid BTC price/);
});
