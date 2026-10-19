# Security model

## Current guarantees

SafeTradeLab v0.1 is structurally paper-only. The codebase contains no credential fields, wallet libraries, transaction constructors, signing functions, exchange order endpoints, dynamic imports from user input, command execution, or extension system.

Market data has a narrow outbound boundary: HTTPS, host `api.kraken.com`, exact path `/0/public/Ticker`, method GET, fixed asset mapping, timeout, response-size limit, and schema validation. The fetched response is data, never executable input.

The dashboard is local-only and read-only. Its API exposes no mutation route. Browser security headers include a restrictive Content Security Policy.

## Before real money is introduced

Do not add a private key to this application. A real-money phase must be a separately reviewed service with all of the following before activation:

1. hardware-wallet or external signer; no raw seed/private-key storage;
2. exchange/wallet allowlist, asset allowlist, destination allowlist, and maximum order/notional limits;
3. human confirmation for activation and withdrawals;
4. independent risk engine with daily loss, position, slippage, stale-price, and circuit-breaker limits;
5. idempotency, reconciliation, append-only audit records, alerting, and emergency stop;
6. sandbox/testnet validation, threat model, dependency audit, code review, and small-value staged rollout;
7. a one-way deployment boundary so paper mode cannot silently fall through to live mode.

Real execution is intentionally absent, not merely disabled by a boolean.
