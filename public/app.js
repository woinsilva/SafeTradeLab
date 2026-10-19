const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' });
const percent = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const compactMoney = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
const rateFormat = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 2, minimumFractionDigits: 2 });

// Display-only descriptions; the rules themselves live in src/engine.mjs.
const STRATEGIES = {
  buyHold: { about: 'Compra uma cesta igual dos mercados uma única vez e não mexe mais. É a referência.', warmup: 0 },
  momentum: { about: 'Compra quando o preço recente sobe acima da média e vende quando a tendência vira.', warmup: 10 },
  meanReversion: { about: 'Compra quando o preço cai abaixo da média e vende quando ele volta ao normal.', warmup: 10 },
  adaptive: { about: 'Escolhe até 3 mercados pela pontuação do scanner, com stop-loss, take-profit e pausa automática.', warmup: 20 },
};

const REASONS = [
  [/^benchmark equal-weight$/, 'compra inicial da cesta de referência'],
  [/^short average crossed above long average$/, 'média curta passou acima da média longa'],
  [/^short average crossed below long average$/, 'média curta caiu abaixo da média longa'],
  [/^price below short mean$/, 'preço abaixo da média recente'],
  [/^price reverted to short mean$/, 'preço voltou à média recente'],
  [/^strategy signal$/, 'sinal da estratégia'],
];

const SIGNAL_TAGS = { COMPRA: ['buy', 'Compra'], VENDA: ['sell', 'Venda'], AGUARDAR: ['wait', 'Aguardar'], AQUECENDO: ['warm', 'Coletando'] };
const DECISION_TAGS = { COMPRA: ['buy', 'Compra'], VENDA: ['sell', 'Venda'], PAUSA: ['pause', 'Pausa'] };
const MARKET_PREVIEW = 12;

const ui = { tradeFilter: 'all', showAllMarkets: false, connection: 'connecting', lastData: null };

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function signed(value, formatter) {
  value = Math.round(value * 100) / 100;
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatter(Math.abs(value))}`;
}

function signedMoney(value) {
  return signed(value, (v) => money.format(v));
}

function signedPercent(value) {
  return signed(value, (v) => `${percent.format(v)}%`);
}

function trendClass(value) {
  if (value > 0.0001) return 'positive';
  if (value < -0.0001) return 'negative';
  return 'neutral';
}

function translateReason(reason) {
  if (!reason) return '';
  const match = REASONS.find(([pattern]) => pattern.test(reason));
  return match ? match[1] : reason;
}

function relativeTime(iso) {
  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 5) return 'agora';
  if (seconds < 60) return `há ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `há ${hours} h`;
  return `há ${Math.round(hours / 24)} dias`;
}

function absoluteTime(iso) {
  return new Date(iso).toLocaleString('pt-BR');
}

function timeNode(iso) {
  const node = element('time', 'muted', relativeTime(iso));
  node.dateTime = iso;
  node.title = absoluteTime(iso);
  node.dataset.relative = iso;
  return node;
}

function tag(kind, text) {
  return element('span', `tag ${kind}`, text);
}

function sampleCount(data) {
  const symbols = data.universe?.symbols ?? [];
  return symbols.reduce((max, symbol) => Math.max(max, data.history?.[symbol]?.length ?? 0), 0);
}

function heldPositions(portfolio, prices) {
  return Object.entries(portfolio.positions ?? {})
    .filter(([, quantity]) => quantity > 0.00000001)
    .map(([symbol, quantity]) => ({ symbol, valueUsd: quantity * (prices[symbol]?.usd ?? 0) }))
    .sort((a, b) => b.valueUsd - a.valueUsd);
}

/* ---------- Status ---------- */

function renderStatus() {
  const data = ui.lastData;
  const box = document.querySelector('#status');
  const title = document.querySelector('#status-title');
  const detail = document.querySelector('#status-detail');
  let state = 'live';
  let heading;
  let text;

  if (ui.connection === 'offline') {
    state = 'error';
    heading = 'Painel sem conexão com o servidor local';
    text = 'Verifique se o comando npm start ainda está rodando. Os números abaixo podem estar desatualizados.';
  } else if (!data) {
    state = 'connecting';
    heading = 'Conectando ao painel...';
    text = 'Buscando os dados mais recentes.';
  } else if (!data.updatedAt) {
    state = data.lastMarketError ? 'error' : 'connecting';
    heading = data.lastMarketError ? 'Não foi possível obter a primeira cotação' : 'Aguardando a primeira cotação';
    text = data.lastMarketError ? `Motivo: ${data.lastMarketError.message}. O laboratório tenta de novo automaticamente.` : 'Isso costuma levar poucos segundos.';
  } else {
    const interval = data.refreshIntervalMs ?? 15_000;
    const age = Date.now() - Date.parse(data.updatedAt);
    const stale = age > interval * 3;
    if (data.lastMarketError) {
      state = 'warning';
      heading = 'Falha na última atualização de preços';
      text = `Motivo: ${data.lastMarketError.message}. Mostrando a última cotação válida (${relativeTime(data.updatedAt)}).`;
    } else if (stale) {
      state = 'warning';
      heading = 'Preços atrasados';
      text = `A última cotação chegou ${relativeTime(data.updatedAt)}. Esperado a cada ${Math.round(interval / 1000)} s.`;
    } else {
      const next = Math.max(0, Math.ceil((interval - age) / 1000));
      heading = ui.connection === 'reconnecting' ? 'Reconectando ao fluxo ao vivo...' : 'Ao vivo · simulação rodando';
      if (ui.connection === 'reconnecting') state = 'warning';
      const markets = data.universe?.symbols?.length ?? 0;
      text = `Última cotação ${relativeTime(data.updatedAt)} · próxima em ~${next} s · ${markets} mercados acompanhados · ${sampleCount(data)} leituras coletadas`;
    }
  }

  box.className = `status ${state}`;
  title.textContent = heading;
  detail.textContent = text;
}

/* ---------- Strategies ---------- */

function strategyState(key, portfolio, data, samples) {
  const warmup = STRATEGIES[key]?.warmup ?? 0;
  if (key === 'adaptive' && data.adaptive?.paused) {
    return { kind: 'pause', label: 'Pausada', hint: 'Perda desde o pico atingiu o limite. Não abre novas posições.' };
  }
  if (samples < warmup) {
    return { kind: 'warm', label: 'Coletando dados', hint: `${samples} de ${warmup} leituras necessárias para começar a operar.`, progress: samples / warmup };
  }
  const positions = heldPositions(portfolio, data.prices).length;
  if (positions) return { kind: 'buy', label: 'Investida', hint: `${positions} ${positions === 1 ? 'posição aberta' : 'posições abertas'}.` };
  return { kind: 'wait', label: 'Em caixa', hint: 'Esperando um sinal para comprar.' };
}

function renderPortfolios(data) {
  const samples = sampleCount(data);
  const benchmark = data.portfolios.buyHold;
  const entries = Object.entries(data.portfolios).sort(([, a], [, b]) => b.pnlUsd - a.pnlUsd);
  const container = document.querySelector('#portfolios');

  container.replaceChildren(...entries.map(([key, portfolio], index) => {
    const card = element('article', `strategy ${key === 'buyHold' ? 'benchmark' : ''}`);
    const state = strategyState(key, portfolio, data, samples);

    const head = element('div', 'strategy-head');
    const name = element('div', 'strategy-name');
    name.append(element('span', 'rank', `${index + 1}º`), element('h3', '', portfolio.name));
    if (key === 'buyHold') name.append(tag('ref', 'Referência'));
    head.append(name, tag(state.kind, state.label));

    const value = element('div', 'strategy-value');
    value.append(
      element('span', 'muted small', 'Valor atual'),
      element('strong', '', money.format(portfolio.valueUsd)),
    );
    const pnl = element('p', `pnl ${trendClass(portfolio.pnlUsd)}`);
    pnl.append(
      element('b', '', `${signedMoney(portfolio.pnlUsd)} (${signedPercent(portfolio.pnlPercent)})`),
      element('span', 'muted', ` desde o início com ${money.format(portfolio.initialCashUsd)}`),
    );
    value.append(pnl);

    if (state.kind === 'warm') {
      value.append(element('p', 'versus neutral', 'Ainda não começou a operar'));
    } else if (key !== 'buyHold' && benchmark) {
      const diff = portfolio.pnlPercent - benchmark.pnlPercent;
      const verdict = Math.abs(diff) < 0.005 ? 'Empatada com a referência' : diff > 0 ? `${signedPercent(diff)} melhor que a referência` : `${signedPercent(diff)} pior que a referência`;
      value.append(element('p', `versus ${trendClass(diff)}`, verdict));
    }

    const invested = Math.max(0, portfolio.valueUsd - portfolio.cashUsd);
    const share = portfolio.valueUsd > 0 ? invested / portfolio.valueUsd : 0;
    const allocation = element('div', 'allocation');
    const bar = element('div', 'bar');
    const fill = element('span', 'bar-fill');
    fill.style.width = `${Math.round(share * 100)}%`;
    bar.append(fill);
    const legend = element('div', 'bar-legend');
    legend.append(
      element('span', '', `Investido ${money.format(invested)}`),
      element('span', '', `Caixa ${money.format(portfolio.cashUsd)}`),
    );
    allocation.append(bar, legend);

    const positions = heldPositions(portfolio, data.prices);
    const chips = element('div', 'chips');
    if (positions.length) {
      for (const position of positions.slice(0, 6)) chips.append(element('span', 'chip', `${position.symbol} ${compactMoney.format(position.valueUsd)}`));
      if (positions.length > 6) chips.append(element('span', 'chip muted', `+${positions.length - 6}`));
    }

    const stateLine = element('p', 'state-hint', state.hint);
    if (state.progress !== undefined) {
      const progress = element('div', 'bar thin');
      const progressFill = element('span', 'bar-fill warm');
      progressFill.style.width = `${Math.round(state.progress * 100)}%`;
      progress.append(progressFill);
      stateLine.append(progress);
    }

    const footer = element('p', 'muted small', `${portfolio.trades.length} ${portfolio.trades.length === 1 ? 'operação' : 'operações'} recentes`);

    card.append(head, element('p', 'about', STRATEGIES[key]?.about ?? ''), value, allocation);
    if (positions.length) card.append(chips);
    card.append(stateLine, footer);
    return card;
  }));
}

/* ---------- Trades ---------- */

function renderTradeFilters(data) {
  const container = document.querySelector('#trade-filters');
  const options = [['all', 'Todas'], ...Object.entries(data.portfolios).map(([key, portfolio]) => [key, portfolio.name])];
  if (!options.some(([key]) => key === ui.tradeFilter)) ui.tradeFilter = 'all';
  container.replaceChildren(...options.map(([key, label]) => {
    const button = element('button', `filter ${ui.tradeFilter === key ? 'active' : ''}`, label);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(ui.tradeFilter === key));
    button.addEventListener('click', () => {
      ui.tradeFilter = key;
      renderTradeFilters(data);
      renderTrades(data);
    });
    return button;
  }));
}

function renderTrades(data) {
  const allTrades = Object.entries(data.portfolios)
    .filter(([key]) => ui.tradeFilter === 'all' || ui.tradeFilter === key)
    .flatMap(([, portfolio]) => portfolio.trades.map((trade) => ({ ...trade, strategy: portfolio.name })))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 30);
  const trades = document.querySelector('#trades');

  if (!allTrades.length) {
    const samples = sampleCount(data);
    const message = ui.tradeFilter === 'all'
      ? `Nenhuma operação ainda. As estratégias estão coletando preços (${samples} leituras até agora) e começam a operar quando tiverem histórico suficiente.`
      : 'Esta estratégia ainda não fez nenhuma operação. Isso é normal enquanto ela coleta dados ou espera um sinal.';
    trades.replaceChildren(element('p', 'empty', message));
    return;
  }

  const head = element('div', 'row trade head');
  for (const label of ['Quando', 'Estratégia', 'Operação', 'Valor', 'Motivo']) head.append(element('span', '', label));

  trades.replaceChildren(head, ...allTrades.map((trade) => {
    const row = element('div', 'row trade');
    const isBuy = trade.side === 'BUY';
    const operation = element('span', 'operation');
    operation.append(tag(isBuy ? 'buy' : 'sell', isBuy ? 'Compra' : 'Venda'), element('b', '', trade.symbol));
    const amount = element('span', 'amount');
    amount.append(element('b', '', money.format(trade.notionalUsd)), element('small', 'muted', `taxa ${money.format(trade.feeUsd)}`));
    row.append(
      timeNode(trade.timestamp),
      element('span', '', trade.strategy),
      operation,
      amount,
      element('span', 'muted reason', translateReason(trade.reason)),
    );
    return row;
  }));
}

/* ---------- Adaptive scanner ---------- */

function renderSignals(data) {
  const signals = Object.entries(data.adaptive?.signals ?? {});
  const counts = { COMPRA: 0, VENDA: 0, AGUARDAR: 0, AQUECENDO: 0 };
  for (const [, signal] of signals) counts[signal.label] = (counts[signal.label] ?? 0) + 1;

  const summary = document.querySelector('#signal-summary');
  summary.replaceChildren(...Object.entries(counts).filter(([, count]) => count > 0).map(([label, count]) => {
    const [kind, text] = SIGNAL_TAGS[label] ?? ['wait', label];
    return tag(kind, `${count} ${text}`);
  }));

  const alert = document.querySelector('#adaptive-alert');
  if (data.adaptive?.paused) {
    alert.replaceChildren(element('p', 'alert', 'O Adaptive Trader está pausado: a carteira caiu além do limite de perda desde o pico. Ele continua vendendo por proteção, mas não abre novas compras.'));
  } else {
    alert.replaceChildren();
  }

  const container = document.querySelector('#signals');
  if (!signals.length) {
    container.replaceChildren(element('p', 'empty', 'O scanner ainda não avaliou nenhum mercado. Ele começa assim que a primeira cotação chegar.'));
  } else {
    const held = data.portfolios.adaptive?.positions ?? {};
    const sorted = signals.sort(([, a], [, b]) => (b.ready - a.ready) || (b.score - a.score));
    const head = element('div', 'row signal head');
    for (const label of ['Mercado', 'Avaliação', 'Pontuação', 'Por quê']) head.append(element('span', '', label));
    container.replaceChildren(head, ...sorted.map(([symbol, signal]) => {
      const market = data.universe?.markets?.[symbol];
      const row = element('div', 'row signal');
      const [kind, text] = SIGNAL_TAGS[signal.label] ?? ['wait', signal.label];

      const name = element('span', 'symbol');
      name.append(element('b', '', symbol));
      if (held[symbol] > 0.00000001) name.append(tag('ref', 'na carteira'));

      const score = element('span', 'score');
      if (signal.ready) {
        const meter = element('span', 'meter');
        const fill = element('span', `meter-fill ${kind}`);
        // Map −7..+5 onto 0..100% so the bar reads left (venda) to right (compra).
        fill.style.width = `${Math.round(((signal.score + 7) / 12) * 100)}%`;
        meter.append(fill);
        score.append(element('b', '', signal.score > 0 ? `+${signal.score}` : String(signal.score)), meter);
      } else {
        score.append(element('span', 'muted', '—'));
      }

      const why = element('span', 'muted reason', signal.ready ? signal.reason : `coletando histórico: ${signal.reason}`);
      if (market) why.append(element('small', '', ` · #${market.rank} em volume (${compactMoney.format(market.volumeUsd)}/24h)`));

      row.append(name, tag(kind, text), score, why);
      return row;
    }));
  }

  const decisions = (data.adaptive?.decisions ?? []).slice(0, 8);
  const list = document.querySelector('#decisions');
  if (!decisions.length) {
    list.replaceChildren(element('p', 'empty', 'Nenhuma decisão ainda. Aparece aqui cada compra, venda ou pausa do Adaptive Trader.'));
    return;
  }
  list.replaceChildren(...decisions.map((decision) => {
    const item = element('div', 'decision');
    const [kind, text] = DECISION_TAGS[decision.action] ?? ['wait', decision.action];
    const line = element('div', 'decision-line');
    line.append(tag(kind, text), element('b', '', decision.symbol === 'CARTEIRA' ? 'Carteira' : decision.symbol), timeNode(decision.timestamp));
    item.append(line, element('p', 'muted small', translateReason(decision.reason)));
    return item;
  }));
}

/* ---------- Market ---------- */

function renderPrices(data) {
  const held = new Set(Object.values(data.portfolios).flatMap((portfolio) => heldPositions(portfolio, data.prices).map((p) => p.symbol)));
  const rows = Object.entries(data.prices).map(([symbol, quote]) => {
    const first = data.history?.[symbol]?.[0]?.usd;
    const change = first ? ((quote.usd / first) - 1) * 100 : null;
    return { symbol, quote, change, rank: data.universe?.markets?.[symbol]?.rank ?? Infinity };
  }).sort((a, b) => a.rank - b.rank || a.symbol.localeCompare(b.symbol));

  const container = document.querySelector('#prices');
  const toggle = document.querySelector('#market-toggle');
  if (!rows.length) {
    container.replaceChildren(element('p', 'empty', 'Ainda não há cotações. Elas aparecem aqui após a primeira leitura.'));
    toggle.hidden = true;
    return;
  }

  const visible = ui.showAllMarkets ? rows : rows.slice(0, MARKET_PREVIEW);
  toggle.hidden = rows.length <= MARKET_PREVIEW;
  toggle.textContent = ui.showAllMarkets ? 'Mostrar menos' : `Mostrar todos (${rows.length})`;

  const head = element('div', 'row market head');
  for (const label of ['Mercado', 'Preço', 'Variação na coleta', 'Volume 24h']) head.append(element('span', '', label));
  container.replaceChildren(head, ...visible.map(({ symbol, quote, change }) => {
    const row = element('div', 'row market');
    const name = element('span', 'symbol');
    name.append(element('b', '', symbol));
    if (held.has(symbol)) name.append(tag('ref', 'em uso'));
    row.append(
      name,
      element('b', 'price', money.format(quote.usd)),
      element('span', change === null ? 'muted' : trendClass(change), change === null ? '—' : signedPercent(change)),
      element('span', 'muted', quote.volumeUsd ? compactMoney.format(quote.volumeUsd) : '—'),
    );
    return row;
  }));
}

/* ---------- Footer & static labels ---------- */

function renderMeta(data) {
  if (data.refreshIntervalMs) document.querySelector('#interval-label').textContent = `${Math.round(data.refreshIntervalMs / 1000)} s`;
  const initial = data.portfolios.buyHold?.initialCashUsd;
  if (initial) document.querySelector('#initial-cash-label').textContent = money.format(initial);
  if (data.simulation) {
    document.querySelector('#footer-costs').textContent = `Cada operação simulada paga taxa de ${rateFormat.format(data.simulation.feeRate)} e slippage de ${rateFormat.format(data.simulation.slippageRate)} · Fonte: Kraken ticker público (somente leitura)`;
  }
}

function render(data) {
  ui.lastData = data;
  renderStatus();
  renderMeta(data);
  renderPortfolios(data);
  renderTradeFilters(data);
  renderTrades(data);
  renderSignals(data);
  renderPrices(data);
}

document.querySelector('#market-toggle').addEventListener('click', () => {
  ui.showAllMarkets = !ui.showAllMarkets;
  if (ui.lastData) renderPrices(ui.lastData);
});

async function refresh() {
  try {
    const response = await fetch('/api/state', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (ui.connection === 'offline' || ui.connection === 'connecting') ui.connection = 'live';
    render(await response.json());
  } catch {
    ui.connection = 'offline';
    renderStatus();
  }
}

void refresh();

const stream = new EventSource('/api/stream');
stream.addEventListener('open', () => {
  ui.connection = 'live';
  renderStatus();
});
stream.addEventListener('state', (event) => {
  try {
    ui.connection = 'live';
    render(JSON.parse(event.data));
  } catch {
    // A malformed local event is ignored; the fallback request will retry.
  }
});
stream.onerror = () => {
  ui.connection = stream.readyState === EventSource.CLOSED ? 'offline' : 'reconnecting';
  renderStatus();
};

// Keep "há X s" labels and the next-update countdown moving between pushes.
setInterval(() => {
  renderStatus();
  for (const node of document.querySelectorAll('[data-relative]')) node.textContent = relativeTime(node.dataset.relative);
}, 1_000);

setInterval(refresh, 60_000);
