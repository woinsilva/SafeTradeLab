import path from 'node:path';

function numberSetting(name, fallback, { min, max }) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return value;
}

export const config = Object.freeze({
  host: '127.0.0.1',
  port: numberSetting('PORT', 18790, { min: 1024, max: 65535 }),
  pollIntervalMs: numberSetting('POLL_INTERVAL_MS', 15_000, { min: 10_000, max: 3_600_000 }),
  initialCashUsd: numberSetting('INITIAL_CASH_USD', 1_000, { min: 1, max: 1_000_000 }),
  feeRate: 0.001,
  slippageRate: 0.0005,
  dataFile: path.resolve('data', 'state.json'),
});
