import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchPrices, marketDataPolicy } from '../src/market-data.mjs';

test('market adapter is unauthenticated GET-only and validates the response', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      headers: new Headers({ 'content-length': '200' }),
      json: async () => ({ error: [], result: {
        'BTC/USD': { c: ['60000'] }, 'ETH/USD': { c: ['3000'] }, 'SOL/USD': { c: ['150'] },
        'XRP/USD': { c: ['1'] }, 'ADA/USD': { c: ['0.5'] }, 'DOGE/USD': { c: ['0.2'] },
        'LINK/USD': { c: ['15'] }, 'AVAX/USD': { c: ['25'] },
      } }),
    };
  };
  const result = await fetchPrices({ fetchImpl });
  assert.equal(request.url.hostname, 'api.kraken.com');
  assert.equal(request.options.method, 'GET');
  assert.equal(result.BTC.usd, 60_000);
  assert.deepEqual(marketDataPolicy, { method: 'GET', origin: 'https://api.kraken.com', path: '/0/public/Ticker', authenticated: false });
});

test('market adapter rejects malformed data', async () => {
  const fetchImpl = async () => ({ ok: true, headers: new Headers(), json: async () => ({ error: [], result: {} }) });
  await assert.rejects(fetchPrices({ fetchImpl }), /Invalid BTC price/);
});
