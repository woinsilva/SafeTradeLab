import { SYMBOLS, executePaperTrade, portfolioValue } from './domain.mjs';

function average(samples) {
  return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}

function standardDeviation(samples) {
  const mean = average(samples);
  return Math.sqrt(average(samples.map((value) => (value - mean) ** 2)));
}

function rsi(samples, periods = 14) {
  const window = samples.slice(-(periods + 1));
  const changes = window.slice(1).map((value, index) => value - window[index]);
  const gains = changes.reduce((sum, change) => sum + Math.max(0, change), 0) / periods;
  const losses = changes.reduce((sum, change) => sum + Math.max(0, -change), 0) / periods;
  if (losses === 0) return gains === 0 ? 50 : 100;
  return 100 - (100 / (1 + gains / losses));
}

function isInvested(portfolio, symbol) {
  return portfolio.positions[symbol] > 0.00000001;
}

export function signalFor(samples) {
  if (samples.length < 20) return { ready: false, score: 0, label: 'AQUECENDO', reason: `${samples.length}/20 amostras` };
  const price = samples.at(-1);
  const sma5 = average(samples.slice(-5));
  const sma20 = average(samples.slice(-20));
  const momentum = (price / samples.at(-5)) - 1;
  const trend = (sma5 / sma20) - 1;
  const rsi14 = rsi(samples);
  const window = samples.slice(-20);
  const returns = window.slice(1).map((value, index) => (value / window[index]) - 1);
  const volatility = standardDeviation(returns);
  let score = 0;
  if (momentum > 0.0015) score += 2;
  else if (momentum < -0.0015) score -= 2;
  if (trend > 0.001) score += 2;
  else if (trend < -0.001) score -= 2;
  if (rsi14 >= 52 && rsi14 <= 70) score += 1;
  if (rsi14 > 78) score -= 2;
  if (rsi14 < 30) score -= 1;
  if (volatility > 0.025) score -= 1;
  const label = score >= 4 ? 'COMPRA' : score <= -3 ? 'VENDA' : 'AGUARDAR';
  return {
    ready: true, score, label,
    reason: `momentum ${(momentum * 100).toFixed(2)}%, tendência ${(trend * 100).toFixed(2)}%, RSI ${rsi14.toFixed(1)}`,
    momentum, trend, rsi: rsi14, volatility,
  };
}

function appendDecision(state, decision) {
  state.adaptive.decisions.unshift(decision);
  if (state.adaptive.decisions.length > 100) state.adaptive.decisions.length = 100;
}

function applyAdaptiveStrategy(state, config, now) {
  const portfolio = state.portfolios.adaptive;
  const value = portfolioValue(portfolio, state.prices);
  state.adaptive.peakValueUsd = Math.max(state.adaptive.peakValueUsd, value);
  const drawdown = state.adaptive.peakValueUsd > 0 ? 1 - (value / state.adaptive.peakValueUsd) : 0;
  state.adaptive.paused = drawdown >= config.maxDrawdownPercent;

  for (const symbol of SYMBOLS) {
    state.adaptive.signals[symbol] = signalFor(state.history[symbol].map((point) => point.usd));
  }

  for (const symbol of SYMBOLS) {
    if (!isInvested(portfolio, symbol)) continue;
    const price = state.prices[symbol].usd;
    const position = state.adaptive.positions[symbol];
    if (!position) continue;
    position.highestPriceUsd = Math.max(position.highestPriceUsd, price);
    const returnSinceEntry = (price / position.entryPriceUsd) - 1;
    const trailingReturn = (price / position.highestPriceUsd) - 1;
    const signal = state.adaptive.signals[symbol];
    let reason = null;
    if (returnSinceEntry <= -config.stopLossPercent) reason = `stop-loss ${(returnSinceEntry * 100).toFixed(2)}%`;
    else if (returnSinceEntry >= config.takeProfitPercent) reason = `take-profit ${(returnSinceEntry * 100).toFixed(2)}%`;
    else if (trailingReturn <= -config.trailingStopPercent) reason = `trailing-stop ${(trailingReturn * 100).toFixed(2)}%`;
    else if (signal.score <= -3) reason = `reversão do sinal: ${signal.reason}`;
    if (reason) {
      executePaperTrade(portfolio, {
        symbol, side: 'SELL', requestedUsd: Number.MAX_SAFE_INTEGER, priceUsd: price,
        feeRate: config.feeRate, slippageRate: config.slippageRate, timestamp: now, reason,
      });
      delete state.adaptive.positions[symbol];
      appendDecision(state, { timestamp: now, symbol, action: 'VENDA', reason });
    }
  }

  if (state.adaptive.paused) {
    if (state.adaptive.decisions[0]?.action !== 'PAUSA') {
      appendDecision(state, { timestamp: now, symbol: 'CARTEIRA', action: 'PAUSA', reason: `drawdown ${(drawdown * 100).toFixed(2)}% atingiu o limite` });
    }
    return;
  }

  const openPositions = SYMBOLS.filter((symbol) => isInvested(portfolio, symbol)).length;
  let availableSlots = config.maxOpenPositions - openPositions;
  if (availableSlots <= 0) return;
  const candidates = SYMBOLS
    .filter((symbol) => !isInvested(portfolio, symbol))
    .map((symbol) => ({ symbol, signal: state.adaptive.signals[symbol] }))
    .filter(({ signal }) => signal.ready && signal.score >= 4)
    .sort((left, right) => right.signal.score - left.signal.score);

  for (const { symbol, signal } of candidates) {
    if (availableSlots <= 0) break;
    const previous = portfolio.trades.findLast((trade) => trade.symbol === symbol);
    if (previous && Date.parse(now) - Date.parse(previous.timestamp) < config.cooldownMs) continue;
    const requestedUsd = Math.min(portfolio.cashUsd * 0.9, portfolioValue(portfolio, state.prices) * config.positionAllocation);
    const traded = executePaperTrade(portfolio, {
      symbol, side: 'BUY', requestedUsd, priceUsd: state.prices[symbol].usd,
      feeRate: config.feeRate, slippageRate: config.slippageRate, timestamp: now,
      reason: `sinal ${signal.score}/5: ${signal.reason}`,
    });
    if (traded) {
      const trade = portfolio.trades.at(-1);
      state.adaptive.positions[symbol] = { entryPriceUsd: trade.executionPriceUsd, highestPriceUsd: state.prices[symbol].usd, openedAt: now };
      appendDecision(state, { timestamp: now, symbol, action: 'COMPRA', reason: trade.reason });
      availableSlots -= 1;
    }
  }
}

export function applyStrategies(state, config, now = new Date().toISOString()) {
  const trade = (portfolio, symbol, side, requestedUsd, reason) => executePaperTrade(portfolio, {
    symbol, side, requestedUsd, priceUsd: state.prices[symbol].usd,
    feeRate: config.feeRate, slippageRate: config.slippageRate, timestamp: now, reason,
  });

  const benchmark = state.portfolios.buyHold;
  if (benchmark.trades.length === 0) {
    for (const symbol of SYMBOLS) trade(benchmark, symbol, 'BUY', benchmark.initialCashUsd / SYMBOLS.length, 'benchmark equal-weight');
  }

  for (const symbol of SYMBOLS) {
    const samples = state.history[symbol].map((point) => point.usd);
    if (samples.length < 10) continue;
    const price = state.prices[symbol].usd;
    const short = average(samples.slice(-3));
    const long = average(samples.slice(-10));
    const momentum = state.portfolios.momentum;
    if (!isInvested(momentum, symbol) && short > long * 1.001) {
      trade(momentum, symbol, 'BUY', portfolioValue(momentum, state.prices) * 0.2, 'short average crossed above long average');
    } else if (isInvested(momentum, symbol) && short < long * 0.999) {
      trade(momentum, symbol, 'SELL', Number.MAX_SAFE_INTEGER, 'short average crossed below long average');
    }
    const meanReversion = state.portfolios.meanReversion;
    const mean = average(samples.slice(-10));
    if (!isInvested(meanReversion, symbol) && price < mean * 0.995) {
      trade(meanReversion, symbol, 'BUY', portfolioValue(meanReversion, state.prices) * 0.2, 'price below short mean');
    } else if (isInvested(meanReversion, symbol) && price >= mean) {
      trade(meanReversion, symbol, 'SELL', Number.MAX_SAFE_INTEGER, 'price reverted to short mean');
    }
  }

  applyAdaptiveStrategy(state, config, now);
}

export function recordPrices(state, prices, maxSamples = 5_760) {
  state.prices = prices;
  for (const symbol of SYMBOLS) {
    state.history[symbol].push({ timestamp: prices[symbol].timestamp, usd: prices[symbol].usd });
    if (state.history[symbol].length > maxSamples) state.history[symbol].splice(0, state.history[symbol].length - maxSamples);
  }
  state.updatedAt = new Date().toISOString();
  state.lastMarketError = null;
}
