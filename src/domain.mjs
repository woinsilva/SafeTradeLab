export const SYMBOLS = Object.freeze(['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE', 'LINK', 'AVAX']);

export function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function createPortfolio(name, initialCashUsd) {
  return {
    name,
    initialCashUsd,
    cashUsd: initialCashUsd,
    positions: Object.fromEntries(SYMBOLS.map((symbol) => [symbol, 0])),
    trades: [],
  };
}

export function createInitialState(initialCashUsd) {
  return {
    schemaVersion: 2,
    mode: 'PAPER_ONLY',
    startedAt: new Date().toISOString(),
    updatedAt: null,
    lastMarketError: null,
    universe: { symbols: [...SYMBOLS], markets: {}, refreshedAt: null, selectionPolicy: 'bootstrap' },
    prices: {},
    history: Object.fromEntries(SYMBOLS.map((symbol) => [symbol, []])),
    portfolios: {
      buyHold: createPortfolio('Buy & Hold', initialCashUsd),
      momentum: createPortfolio('Momentum', initialCashUsd),
      meanReversion: createPortfolio('Mean Reversion', initialCashUsd),
      adaptive: createPortfolio('Adaptive Trader', initialCashUsd),
    },
    adaptive: { positions: {}, signals: {}, decisions: [], peakValueUsd: initialCashUsd, paused: false },
  };
}

export function migrateState(state, initialCashUsd) {
  if (![1, 2].includes(state?.schemaVersion) || state?.mode !== 'PAPER_ONLY') {
    throw new Error('Unsupported state file');
  }
  state.schemaVersion = 2;
  state.universe ??= { symbols: [...SYMBOLS], markets: {}, refreshedAt: null, selectionPolicy: 'bootstrap' };
  state.universe.symbols = Array.isArray(state.universe.symbols) && state.universe.symbols.length ? state.universe.symbols : [...SYMBOLS];
  state.universe.markets ??= {};
  state.history ??= {};
  state.portfolios ??= {};
  for (const portfolio of Object.values(state.portfolios ?? {})) {
    portfolio.positions ??= {};
    for (const symbol of SYMBOLS) portfolio.positions[symbol] ??= 0;
  }
  state.portfolios.adaptive ??= createPortfolio('Adaptive Trader', initialCashUsd);
  ensureSymbols(state, [...SYMBOLS, ...state.universe.symbols]);
  state.adaptive ??= { positions: {}, signals: {}, decisions: [], peakValueUsd: initialCashUsd, paused: false };
  state.adaptive.positions ??= {};
  state.adaptive.signals ??= {};
  state.adaptive.decisions ??= [];
  state.adaptive.peakValueUsd ??= initialCashUsd;
  state.adaptive.paused ??= false;
  return state;
}

export function ensureSymbols(state, symbols) {
  state.history ??= {};
  for (const symbol of symbols) {
    state.history[symbol] ??= [];
    for (const portfolio of Object.values(state.portfolios ?? {})) {
      portfolio.positions ??= {};
      portfolio.positions[symbol] ??= 0;
    }
  }
}

export function portfolioValue(portfolio, prices) {
  return portfolio.cashUsd + Object.entries(portfolio.positions).reduce((sum, [symbol, quantity]) => {
    return sum + quantity * (prices[symbol]?.usd ?? 0);
  }, 0);
}

export function executePaperTrade(portfolio, { symbol, side, requestedUsd, priceUsd, feeRate, slippageRate, timestamp, reason = 'strategy signal' }) {
  if (!/^[A-Z0-9.]{2,15}$/.test(symbol) || !(symbol in portfolio.positions)) throw new Error('Unsupported symbol');
  if (!['BUY', 'SELL'].includes(side)) throw new Error('Unsupported side');
  if (![requestedUsd, priceUsd, feeRate, slippageRate].every(Number.isFinite)) throw new Error('Invalid trade number');
  if (requestedUsd <= 0 || priceUsd <= 0 || feeRate < 0 || slippageRate < 0) throw new Error('Invalid trade amount');

  const executionPrice = priceUsd * (side === 'BUY' ? 1 + slippageRate : 1 - slippageRate);
  let quantity;
  let notional;
  let fee;

  if (side === 'BUY') {
    notional = Math.min(requestedUsd, portfolio.cashUsd / (1 + feeRate));
    if (notional < 0.01) return false;
    fee = notional * feeRate;
    quantity = notional / executionPrice;
    portfolio.cashUsd -= notional + fee;
    portfolio.positions[symbol] += quantity;
  } else {
    const maxNotional = portfolio.positions[symbol] * executionPrice;
    notional = Math.min(requestedUsd, maxNotional);
    if (notional < 0.01) return false;
    quantity = notional / executionPrice;
    fee = notional * feeRate;
    portfolio.positions[symbol] -= quantity;
    portfolio.cashUsd += notional - fee;
  }

  portfolio.trades.push({
    timestamp,
    symbol,
    side,
    quantity,
    marketPriceUsd: priceUsd,
    executionPriceUsd: executionPrice,
    notionalUsd: notional,
    feeUsd: fee,
    reason: String(reason).slice(0, 240),
  });
  if (portfolio.trades.length > 500) portfolio.trades.splice(0, portfolio.trades.length - 500);
  return true;
}

export function summarizeState(state) {
  const portfolios = Object.fromEntries(Object.entries(state.portfolios).map(([key, portfolio]) => {
    const valueUsd = portfolioValue(portfolio, state.prices);
    return [key, {
      ...portfolio,
      cashUsd: roundMoney(portfolio.cashUsd),
      valueUsd: roundMoney(valueUsd),
      pnlUsd: roundMoney(valueUsd - portfolio.initialCashUsd),
      pnlPercent: portfolio.initialCashUsd ? ((valueUsd / portfolio.initialCashUsd) - 1) * 100 : 0,
      trades: portfolio.trades.slice(-50).reverse(),
    }];
  }));
  return { ...state, portfolios };
}
