# Safe Tx Service

## First-time init with Docker Compose

From the repo root:

```bash
cp .env.example .env
# fill all required values, especially deployer key + Safe bytecodes
docker compose up
```

What happens:

1. `db` starts PostgreSQL.
2. `init` runs once, waits for DB, deploys Safe contracts with `DEPLOYER_PRIVATE_KEY`, and writes addresses to:
   - `app_config` in Postgres
   - `/shared/contracts.json` (via `contracts_shared` volume)
3. `api` starts without deployer permissions and resolves addresses in this order:
   - `app_config` (DB)
   - `/shared/contracts.json`
   - env vars

On subsequent `docker compose up`, `init` is idempotent: if `app_config` already contains required keys, it logs `already initialized` and exits.

## Tenant auth modes (optional)

Set `TENANT_AUTH_MODE` to one of:

- `none` (default)
- `siwe` (requires `TENANT_WALLET_PRIVATE_KEY`)
- `api_key` (requires `TENANT_API_KEY`)

Tenant credentials are only attached to indexing/receipt visibility RPC calls (e.g. `eth_getBlockReceipts`).

## Advanced calldata / target controls

These are disabled by default:

- `ALLOW_ADVANCED_CALLDATA=false`
- `ALLOW_DELEGATECALL=false`
- `ALLOW_CUSTOM_TARGETS=false`

The API enforces these flags server-side, and the UI hides custom-call flows when advanced calldata is disabled.
