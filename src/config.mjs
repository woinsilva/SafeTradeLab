import path from 'node:path';

function numberSetting(name, fallback, { min, max }) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return value;
}

function hostSetting() {
  const value = process.env.HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '0.0.0.0'].includes(value)) throw new Error('HOST must be 127.0.0.1 or 0.0.0.0');
  return value;
}

export const config = Object.freeze({
  host: hostSetting(),
  port: numberSetting('PORT', 18790, { min: 1024, max: 65535 }),
  pollIntervalMs: numberSetting('POLL_INTERVAL_MS', 15_000, { min: 10_000, max: 3_600_000 }),
  initialCashUsd: numberSetting('INITIAL_CASH_USD', 1_000, { min: 1, max: 1_000_000 }),
  feeRate: 0.001,
  slippageRate: 0.0005,
  maxOpenPositions: 3,
  universeSize: 30,
  universeRefreshMs: 24 * 60 * 60_000,
  minimumDailyVolumeUsd: 1_000_000,
  maximumSpreadPercent: 0.01,
  positionAllocation: 0.25,
  stopLossPercent: 0.02,
  takeProfitPercent: 0.04,
  trailingStopPercent: 0.015,
  maxDrawdownPercent: 0.05,
  cooldownMs: 5 * 60_000,
  dataFile: path.resolve('data', 'state.json'),
});
