export const SYMBOLS = Object.freeze(['BTC', 'ETH', 'SOL']);

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
    schemaVersion: 1,
    mode: 'PAPER_ONLY',
    startedAt: new Date().toISOString(),
    updatedAt: null,
    lastMarketError: null,
    prices: {},
    history: Object.fromEntries(SYMBOLS.map((symbol) => [symbol, []])),
    portfolios: {
      buyHold: createPortfolio('Buy & Hold', initialCashUsd),
      momentum: createPortfolio('Momentum', initialCashUsd),
      meanReversion: createPortfolio('Mean Reversion', initialCashUsd),
    },
  };
}

export function portfolioValue(portfolio, prices) {
  return portfolio.cashUsd + SYMBOLS.reduce((sum, symbol) => {
    return sum + portfolio.positions[symbol] * (prices[symbol]?.usd ?? 0);
  }, 0);
}

export function executePaperTrade(portfolio, { symbol, side, requestedUsd, priceUsd, feeRate, slippageRate, timestamp }) {
  if (!SYMBOLS.includes(symbol)) throw new Error('Unsupported symbol');
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
