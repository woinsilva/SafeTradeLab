# SafeTradeLab

Clean-room market simulation built to answer one question safely: **would a strategy have made or lost money using real market prices?**

The current version is paper-only. It cannot connect a wallet, sign a transaction, place an exchange order, or move money. Prices come from Kraken's public read-only ticker endpoint every 15 seconds, and each successful update is pushed immediately to the dashboard. Each strategy starts with its own virtual USD 1,000 portfolio and includes simulated fees and slippage.

## Run

Requires Node.js 22 or newer. There are no third-party runtime dependencies.

```powershell
npm test
npm start
```

Open <http://127.0.0.1:18790>.

## Strategies

- **Buy & Hold**: invests once in an equal-weight BTC/ETH/SOL basket; benchmark, not a promise of profit.
- **Momentum**: buys when the short moving average is above the long moving average and exits on reversal.
- **Mean Reversion**: buys when price is sufficiently below its moving average and exits after recovery.
- **Adaptive Trader**: discovers the 30 most liquid Kraken USD markets every 24 hours, excludes stablecoins and leveraged/synthetic symbols, ranks momentum, trend, RSI, and volatility, holds at most three positions, and applies stop-loss, take-profit, trailing-stop, cooldown, and portfolio drawdown limits.

The first two strategies need enough collected samples before trading. Leave the service running so it can build history. Data is stored in `data/state.json` and survives restarts.

## Safety boundary

- only `GET https://api.kraken.com/0/public/Ticker` is permitted by the market-data adapter;
- no wallet, exchange SDK, private key, seed phrase, transaction signing, RPC, shell execution, plugin loader, remote code, Docker socket, camera, clipboard, SSH, or file-browser capability;
- the HTTP server binds only to `127.0.0.1`;
- the broker is a paper ledger and has no network access or live-order method;
- state writes are atomic and the UI displays its data source, age, fees, slippage, and mode.

Read [SECURITY.md](SECURITY.md) before any future wallet work.
