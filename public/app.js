const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' });
const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function render(data) {
  const updated = data.updatedAt ? new Date(data.updatedAt) : null;
  const status = document.querySelector('#status');
  status.textContent = data.lastMarketError
    ? `Último erro de mercado: ${data.lastMarketError.message}`
    : updated ? `Atualizado em ${updated.toLocaleString('pt-BR')}` : 'Aguardando primeira cotação.';
  status.className = `status ${data.lastMarketError ? 'error' : ''}`;

  const prices = document.querySelector('#prices');
  prices.replaceChildren(...Object.entries(data.prices).map(([symbol, quote]) => {
    const card = element('article', 'card');
    card.append(element('span', 'label', symbol), element('strong', '', money.format(quote.usd)));
    return card;
  }));

  const portfolios = document.querySelector('#portfolios');
  portfolios.replaceChildren(...Object.values(data.portfolios).map((portfolio) => {
    const card = element('article', 'card portfolio');
    const pnlClass = portfolio.pnlUsd >= 0 ? 'positive' : 'negative';
    card.append(
      element('span', 'label', portfolio.name),
      element('strong', '', money.format(portfolio.valueUsd)),
      element('span', pnlClass, `${portfolio.pnlUsd >= 0 ? '+' : ''}${money.format(portfolio.pnlUsd)} (${number.format(portfolio.pnlPercent)}%)`),
      element('small', '', `${portfolio.trades.length} operações · caixa ${money.format(portfolio.cashUsd)}`),
    );
    return card;
  }));

  const signals = document.querySelector('#signals');
  signals.replaceChildren(...Object.entries(data.adaptive?.signals ?? {}).map(([symbol, signal]) => {
    const row = element('div', 'signal');
    const labelClass = signal.label === 'COMPRA' ? 'positive' : signal.label === 'VENDA' ? 'negative' : '';
    row.append(
      element('b', '', symbol),
      element('span', labelClass, signal.label),
      element('span', '', signal.ready ? `${signal.score > 0 ? '+' : ''}${signal.score}` : '—'),
      element('small', '', signal.reason),
    );
    return row;
  }));

  const allTrades = Object.values(data.portfolios).flatMap((portfolio) => portfolio.trades.map((trade) => ({ ...trade, strategy: portfolio.name })))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 30);
  const trades = document.querySelector('#trades');
  if (!allTrades.length) {
    trades.replaceChildren(element('p', 'empty', 'As estratégias ainda estão coletando dados.'));
    return;
  }
  trades.replaceChildren(...allTrades.map((trade) => {
    const row = element('div', 'trade');
    row.append(
      element('span', '', new Date(trade.timestamp).toLocaleString('pt-BR')),
      element('span', '', trade.strategy),
      element('b', trade.side === 'BUY' ? 'positive' : 'negative', `${trade.side} ${trade.symbol}`),
      element('span', '', `${money.format(trade.notionalUsd)} · taxa ${money.format(trade.feeUsd)} · ${trade.reason ?? ''}`),
    );
    return row;
  }));
}

async function refresh() {
  try {
    const response = await fetch('/api/state', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
  } catch (error) {
    const status = document.querySelector('#status');
    status.textContent = `Painel indisponível: ${error.message}`;
    status.className = 'status error';
  }
}

void refresh();

const stream = new EventSource('/api/stream');
stream.addEventListener('state', (event) => {
  try {
    render(JSON.parse(event.data));
  } catch {
    // A malformed local event is ignored; the fallback request will retry.
  }
});
stream.onerror = () => {
  const status = document.querySelector('#status');
  status.textContent = 'Reconectando ao fluxo local de preços...';
  status.className = 'status error';
};

setInterval(refresh, 60_000);
