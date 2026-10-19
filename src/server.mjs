import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.mjs';
import { createInitialState, migrateState, summarizeState } from './domain.mjs';
import { applyStrategies, recordPrices } from './engine.mjs';
import { fetchPrices, marketDataPolicy } from './market-data.mjs';
import { loadState, saveState } from './store.mjs';

const publicRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
let state = migrateState(await loadState(config.dataFile, createInitialState(config.initialCashUsd)), config.initialCashUsd);
let updateInProgress = false;
const streamClients = new Set();

function publicState() {
  return {
    ...summarizeState(state),
    marketDataPolicy,
    simulation: { feeRate: config.feeRate, slippageRate: config.slippageRate },
    refreshIntervalMs: config.pollIntervalMs,
  };
}

function broadcastState() {
  const event = `event: state\ndata: ${JSON.stringify(publicState())}\n\n`;
  for (const client of streamClients) client.write(event);
}

async function updateMarket() {
  if (updateInProgress) return;
  updateInProgress = true;
  try {
    const prices = await fetchPrices();
    recordPrices(state, prices);
    applyStrategies(state, config);
    await saveState(config.dataFile, state);
    broadcastState();
  } catch (error) {
    state.lastMarketError = { timestamp: new Date().toISOString(), message: String(error.message ?? error).slice(0, 200) };
    console.error(`[market] ${state.lastMarketError.message}`);
  } finally {
    updateInProgress = false;
  }
}

const securityHeaders = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

async function serveFile(response, name, contentType) {
  const file = path.join(publicRoot, name);
  await stat(file);
  response.writeHead(200, { ...securityHeaders, 'content-type': contentType });
  createReadStream(file).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${config.host}:${config.port}`);
    if (request.method !== 'GET') {
      response.writeHead(405, { ...securityHeaders, allow: 'GET' }).end('Method not allowed');
      return;
    }
    if (url.pathname === '/api/state') {
      response.writeHead(200, { ...securityHeaders, 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(publicState()));
      return;
    }
    if (url.pathname === '/api/stream') {
      response.writeHead(200, {
        ...securityHeaders,
        'content-type': 'text/event-stream; charset=utf-8',
        connection: 'keep-alive',
      });
      response.write(`event: state\ndata: ${JSON.stringify(publicState())}\n\n`);
      streamClients.add(response);
      request.on('close', () => streamClients.delete(response));
      return;
    }
    if (url.pathname === '/health') {
      response.writeHead(200, { ...securityHeaders, 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ ok: true, mode: state.mode, updatedAt: state.updatedAt }));
      return;
    }
    if (url.pathname === '/' || url.pathname === '/index.html') return await serveFile(response, 'index.html', 'text/html; charset=utf-8');
    if (url.pathname === '/app.js') return await serveFile(response, 'app.js', 'text/javascript; charset=utf-8');
    if (url.pathname === '/styles.css') return await serveFile(response, 'styles.css', 'text/css; charset=utf-8');
    response.writeHead(404, securityHeaders).end('Not found');
  } catch {
    response.writeHead(500, securityHeaders).end('Internal error');
  }
});

server.listen(config.port, config.host, () => {
  console.log(`SafeTradeLab PAPER_ONLY listening at http://${config.host}:${config.port}`);
  void updateMarket();
});
const timer = setInterval(() => void updateMarket(), config.pollIntervalMs);
timer.unref();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    clearInterval(timer);
    for (const client of streamClients) client.end();
    server.close(() => process.exit(0));
  });
}
