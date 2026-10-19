const API_ORIGIN = 'https://api.kraken.com';
const TICKER_PATH = '/0/public/Ticker';
const STABLE_ASSETS = new Set(['USDT', 'USDC', 'DAI', 'PYUSD', 'USDS', 'TUSD', 'FDUSD', 'EURT', 'USDQ']);
const FIAT_ASSETS = new Set(['EUR', 'GBP', 'CAD', 'CHF', 'JPY', 'AUD']);
const UNSUITABLE_PATTERN = /(BULL|BEAR|[235][LS]|UP|DOWN)$/;

function validateSymbol(symbol) {
  return /^[A-Z0-9.]{2,15}$/.test(symbol) && !symbol.includes('USD') && !STABLE_ASSETS.has(symbol) && !FIAT_ASSETS.has(symbol) && !UNSUITABLE_PATTERN.test(symbol);
}

function tickerUrl(symbols) {
  const url = new URL(TICKER_PATH, API_ORIGIN);
  url.searchParams.set('assetVersion', '1');
  if (symbols?.length) {
    if (symbols.length > 60 || symbols.some((symbol) => !validateSymbol(symbol))) throw new Error('Market-data symbol rejected');
    url.searchParams.set('pair', symbols.map((symbol) => `${symbol}USD`).join(','));
  }
  return url;
}

async function fetchTicker(url, fetchImpl) {
  if (url.protocol !== 'https:' || url.origin !== API_ORIGIN || url.pathname !== TICKER_PATH) {
    throw new Error('Market-data endpoint rejected by allowlist');
  }
  const response = await fetchImpl(url, {
    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10_000),
    headers: { accept: 'application/json', 'user-agent': 'SafeTradeLab/0.2' },
  });
  if (!response.ok) throw new Error(`Market data returned HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > 5_000_000) throw new Error('Market-data response too large');
  const body = await response.json();
  if (!Array.isArray(body.error) || body.error.length || !body.result || typeof body.result !== 'object') {
    throw new Error('Invalid market-data response');
  }
  return body.result;
}

function parseTicker(symbol, ticker, timestamp) {
  const usd = Number(ticker?.c?.[0]);
  const ask = Number(ticker?.a?.[0]);
  const bid = Number(ticker?.b?.[0]);
  const volume24h = Number(ticker?.v?.[1]);
  const trades24h = Number(ticker?.t?.[1]);
  if (![usd, ask, bid, volume24h, trades24h].every(Number.isFinite) || usd <= 0 || ask <= 0 || bid <= 0 || ask < bid) return null;
  const volumeUsd = volume24h * usd;
  const spreadPercent = (ask - bid) / ((ask + bid) / 2);
  return { symbol, usd, timestamp, source: 'Kraken public ticker', volumeUsd, spreadPercent, trades24h };
}

export async function discoverUniverse({ fetchImpl = fetch, limit = 30, minimumDailyVolumeUsd = 1_000_000, maximumSpreadPercent = 0.01 } = {}) {
  const result = await fetchTicker(tickerUrl(), fetchImpl);
  const timestamp = new Date().toISOString();
  const candidates = [];
  for (const [pair, ticker] of Object.entries(result)) {
    if (!pair.endsWith('/USD')) continue;
    const symbol = pair.slice(0, -4);
    if (!validateSymbol(symbol)) continue;
    const market = parseTicker(symbol, ticker, timestamp);
    if (!market || market.volumeUsd < minimumDailyVolumeUsd || market.spreadPercent > maximumSpreadPercent || market.trades24h < 100) continue;
    candidates.push(market);
  }
  candidates.sort((left, right) => right.volumeUsd - left.volumeUsd);
  const selected = candidates.slice(0, limit);
  if (selected.length < Math.min(10, limit)) throw new Error('Too few liquid USD markets returned');
  return {
    symbols: selected.map((market) => market.symbol),
    markets: Object.fromEntries(selected.map((market, index) => [market.symbol, { rank: index + 1, volumeUsd: market.volumeUsd, spreadPercent: market.spreadPercent, trades24h: market.trades24h }])),
    refreshedAt: timestamp,
    selectionPolicy: `top ${limit} USD markets by 24h notional volume; stable/leveraged assets excluded`,
  };
}

export async function fetchPrices({ symbols, fetchImpl = fetch } = {}) {
  if (!Array.isArray(symbols) || symbols.length === 0) throw new Error('No market-data symbols configured');
  const result = await fetchTicker(tickerUrl(symbols), fetchImpl);
  const timestamp = new Date().toISOString();
  const prices = {};
  for (const symbol of symbols) {
    const market = parseTicker(symbol, result[`${symbol}/USD`], timestamp);
    if (!market) throw new Error(`Invalid ${symbol} price`);
    prices[symbol] = market;
  }
  return prices;
}

export const marketDataPolicy = Object.freeze({ method: 'GET', origin: API_ORIGIN, path: TICKER_PATH, authenticated: false });
