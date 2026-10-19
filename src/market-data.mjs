import { SYMBOLS } from './domain.mjs';

const ENDPOINT = new URL('https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD,SOLUSD');
const KRAKEN_KEYS = Object.freeze({ BTC: 'XXBTZUSD', ETH: 'XETHZUSD', SOL: 'SOLUSD' });

function validateEndpoint(url) {
  if (url.protocol !== 'https:' || url.hostname !== 'api.kraken.com' || url.pathname !== '/0/public/Ticker') {
    throw new Error('Market-data endpoint rejected by allowlist');
  }
}

export async function fetchPrices({ fetchImpl = fetch } = {}) {
  validateEndpoint(ENDPOINT);
  const response = await fetchImpl(ENDPOINT, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(8_000),
    headers: { accept: 'application/json', 'user-agent': 'SafeTradeLab/0.1' },
  });
  if (!response.ok) throw new Error(`Market data returned HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > 100_000) throw new Error('Market-data response too large');
  const body = await response.json();
  if (!Array.isArray(body.error) || body.error.length || !body.result || typeof body.result !== 'object') {
    throw new Error('Invalid market-data response');
  }
  const timestamp = new Date().toISOString();
  const prices = {};
  for (const symbol of SYMBOLS) {
    const ticker = body.result[KRAKEN_KEYS[symbol]];
    const usd = Number(ticker?.c?.[0]);
    if (!Number.isFinite(usd) || usd <= 0) throw new Error(`Invalid ${symbol} price`);
    prices[symbol] = { usd, timestamp, source: 'Kraken public ticker' };
  }
  return prices;
}

export const marketDataPolicy = Object.freeze({
  method: 'GET',
  origin: ENDPOINT.origin,
  path: ENDPOINT.pathname,
  authenticated: false,
});
