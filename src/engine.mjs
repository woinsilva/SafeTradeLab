import { SYMBOLS, executePaperTrade, portfolioValue } from './domain.mjs';

function average(samples) {
  return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}

function isInvested(portfolio, symbol) {
  return portfolio.positions[symbol] > 0.00000001;
}

export function applyStrategies(state, config, now = new Date().toISOString()) {
  const { feeRate, slippageRate } = config;
  const trade = (portfolio, symbol, side, requestedUsd) => executePaperTrade(portfolio, {
    symbol,
    side,
    requestedUsd,
    priceUsd: state.prices[symbol].usd,
    feeRate,
    slippageRate,
    timestamp: now,
  });

  const benchmark = state.portfolios.buyHold;
  if (benchmark.trades.length === 0) {
    for (const symbol of SYMBOLS) trade(benchmark, symbol, 'BUY', benchmark.initialCashUsd / SYMBOLS.length);
  }

  for (const symbol of SYMBOLS) {
    const samples = state.history[symbol].map((point) => point.usd);
    const price = state.prices[symbol].usd;

    if (samples.length >= 10) {
      const short = average(samples.slice(-3));
      const long = average(samples.slice(-10));
      const portfolio = state.portfolios.momentum;
      if (!isInvested(portfolio, symbol) && short > long * 1.001) {
        trade(portfolio, symbol, 'BUY', portfolioValue(portfolio, state.prices) * 0.2);
      } else if (isInvested(portfolio, symbol) && short < long * 0.999) {
        trade(portfolio, symbol, 'SELL', Number.MAX_SAFE_INTEGER);
      }
    }

    if (samples.length >= 10) {
      const mean = average(samples.slice(-10));
      const portfolio = state.portfolios.meanReversion;
      if (!isInvested(portfolio, symbol) && price < mean * 0.995) {
        trade(portfolio, symbol, 'BUY', portfolioValue(portfolio, state.prices) * 0.2);
      } else if (isInvested(portfolio, symbol) && price >= mean) {
        trade(portfolio, symbol, 'SELL', Number.MAX_SAFE_INTEGER);
      }
    }
  }
}

export function recordPrices(state, prices, maxSamples = 1_440) {
  state.prices = prices;
  for (const symbol of SYMBOLS) {
    state.history[symbol].push({ timestamp: prices[symbol].timestamp, usd: prices[symbol].usd });
    if (state.history[symbol].length > maxSamples) {
      state.history[symbol].splice(0, state.history[symbol].length - maxSamples);
    }
  }
  state.updatedAt = new Date().toISOString();
  state.lastMarketError = null;
}
