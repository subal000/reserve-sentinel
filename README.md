# ReserveSentinel

Real-time, on-chain risk scoring for tokenized RWA stocks on Solana.

In June 2026, xStocks couldn't source enough real SpaceX shares to back demand
— over $1B in customer orders got cancelled, with no public warning system.
ReserveSentinel is that warning system: it watches three real-time signals per
tracked token (price deviation, on-chain liquidity, mint/burn velocity),
combines them into one score, and publishes it **on-chain** — free for anyone
to read, composable for any DeFi protocol to check trustlessly.

**🎥 Demo video:** https://www.loom.com/share/51901ee42c8b478593f58733ef3a447e
**🔗 Live app:** https://reserve-sentinel.vercel.app — reads live scores directly from on-chain PDAs on Solana devnet
**⛓️ Program:** [`BVkkMMqDuFRgzNtwy9Uc87cJu574YDU6j4us9i7EYMba`](https://explorer.solana.com/address/BVkkMMqDuFRgzNtwy9Uc87cJu574YDU6j4us9i7EYMba?cluster=devnet) on devnet

<!-- add a screenshot or GIF of the dashboard / compare view here before submitting -->

## Try it locally

```bash
git clone <this-repo-url> && cd ReserveSentinel

# Frontend — reads on-chain scores directly, no backend needed
cd app && npm install
cp .env.example .env.local   # devnet defaults already work
npm run dev                  # → http://localhost:3000
```
See [Frontend](#frontend-app) below for the ClickHouse-backed history pages,
and [Indexer](#indexer) / [On-chain program](#on-chain-program) to run the
full pipeline that computes and pushes scores.

## What it solves

Different issuers wrap the *same* real-world stock with wildly different trust
models — xStocks' CRCLx vs Ondo's CRCLon are both "Circle stock" but score
differently on-chain because their actual liquidity and backing differ. No
existing tool surfaces that gap before it costs someone money. ReserveSentinel
does, and backs it up with a [real backtest](#status) against actual on-chain
mint/burn history — not a simulation.

## Signals → score

| Signal | Source | Component |
|---|---|---|
| Premium/discount vs real stock | Pyth equity price feed | `price` |
| On-chain liquidity depth | Raydium/Jupiter pool reserves via RPC | `liquidity` |
| Mint/burn velocity anomaly | Helius webhooks (z-score) | `procurement` |
| Custodial trust tier (manual) | config | `trust_tier` |

```
composite = 0.30·price + 0.25·liquidity + 0.25·procurement + 0.20·trust_tier
```

Labels: **80-100** "Looks safe" · **60-79** "Watch this one" · **40-59**
"Showing warning signs" · **0-39** "High risk".

The scoring math lives in [`indexer/internal/scoring`](indexer/internal/scoring/scoring.go)
and is unit-tested. The on-chain program only stores results.

Calibration (tuned against real observed data, 2026-07): `liquidity` uses a
**log10 scale** ($1k→0, $1M→100) because real 1%-depths span ~$40–$560k. When a
token's DEX liquidity is below ~$1k the price is unreliable (a 1-token quote
returns ~$0, i.e. a bogus −100% "premium"), so the `price` component is skipped
for it and the (correctly low) `liquidity` component carries the risk — this is
why CRCLon (Ondo, mint/redeem-first, ~$41 depth) scores below CRCLx despite a
higher trust tier. The frontend's breakdown mirrors these constants.

## Repo layout

```
programs/reserve-sentinel/   Anchor program (AssetScore PDA + 2 instructions)
indexer/                     Go scoring engine (webhook server + 60s ticker)
scripts/                     init_assets.ts (bootstrap), backtest.ts (replay)
config/assets.json           shared asset registry (indexer + init script)
tests/                       Anchor TS tests
```

## On-chain program

One `AssetScore` PDA per mint. Seeds: `[b"asset_score", mint]`.

- `initialize_asset(issuer, underlying_ticker, trust_tier, authority)` — admin, once per mint.
- `update_score(score, premium_bps, liquidity_depth_usd, mint_burn_z)` — authority-gated write; **reads are permissionless**.

```bash
anchor build
anchor test --validator legacy   # ts-mocha vs solana-test-validator (see note)
anchor deploy                    # after `anchor keys sync` for the target cluster
```

Toolchain: **Anchor 1.1.2** (Rust crate `anchor-lang = "1.1.2"`, JS client
`@coral-xyz/anchor@0.32.1` — the JS client versions separately and never went to
1.x). Anchor 1.x defaults its test validator to `surfpool`; pass
`--validator legacy` to use the classic `solana-test-validator` (or
`brew install txtx/taps/surfpool` to use the default). All 5 tests pass on legacy.

> Why not Anchor 0.30.1? The host toolchain is rustc 1.94, and 0.30.1's IDL
> generator calls a `proc_macro` API removed from stable rustc — no proc-macro2
> pin fixes it. 1.1.2's IDL builder works on modern rustc.

Program ID (local placeholder): `BVkkMMqDuFRgzNtwy9Uc87cJu574YDU6j4us9i7EYMba`
— regenerate a dedicated keypair for mainnet.

## Frontend (`app/`)

Next.js 14 App Router. Reads `AssetScore` PDAs **directly from chain via
`@coral-xyz/anchor`** in Server Components — no separate backend API. Dark
"risk monitor" theme (see [brand.md](brand.md)).

```bash
cd app
npm install
cp .env.example .env.local     # set NEXT_PUBLIC_RPC_URL / NEXT_PUBLIC_CLUSTER
npm run dev                    # http://localhost:3000
```

Pages: `/` dashboard (grid, riskiest-first), `/compare/[ticker]` cross-issuer view
(CRCL → CRCLx vs CRCLon side-by-side with a risk-gap banner + score-trend
sparklines), `/basket` read-only blended-risk demo. The per-asset "why this
score" breakdown re-derives the four weighted components from the raw on-chain
signals (mirrors the Go `scoring` package).

### Score history (ClickHouse)

The indexer writes a `ScoreRow` per asset per cycle to ClickHouse; the compare
page reads it server-side ([lib/clickhouse.ts](app/lib/clickhouse.ts)) and renders
a sparkline ([ScoreHistory](app/components/ScoreHistory.tsx)). Reads degrade
gracefully (empty → "accruing" note) if ClickHouse is down.

Local dev (Docker/OrbStack): `./scripts/dev_clickhouse.sh` runs a ClickHouse
container and the indexer against it. Then set the `CLICKHOUSE_*` vars in
`app/.env.local` (see `.env.example`) and run the frontend. Swap the URL/creds
for ClickHouse Cloud in production — the query is identical.

## Indexer

```bash
cd indexer
go build ./...
go test ./...

SOLANA_RPC_URL=<helius-rpc> \
HERMES_URL=https://hermes.pyth.network \
AUTHORITY_KEYPAIR=~/secrets/authority.json \
CLICKHOUSE_DSN=<clickhouse-cloud-dsn> \
HELIUS_WEBHOOK_SECRET=<secret> \
go run ./cmd/indexer --assets ../config/assets.json
```

Flow: verify mints on startup → serve Helius webhooks on `:8080/webhook` →
on each event update the mint/burn window, recompute, write ClickHouse, and push
`update_score` on-chain if the score moved >2 points → every 60s refresh price +
liquidity for all assets regardless of events.

Hosting target: **Fly.io** (already set up).

## Data sources (from research, 2026-07)

- **Price reference → Pyth Hermes (pull), not on-chain accounts.** Pyth has *no*
  sponsored on-chain equity price accounts on Solana, so the indexer pulls latest
  prices from Hermes by feed ID. xStocks have 24/7 `Crypto.<T>X/USD` feeds
  (preferred for the tokens); others use market-hours `Equity.US.<T>/USD` (enforce
  staleness + confidence checks; feeds may move to Pyth Pro after 2026-07-31).
- **SPCX has no reference** — SpaceX is private, so the premium component is
  disabled for it; liquidity + mint/burn signals still apply.
- **Liquidity → Jupiter, not a single pool.** These are canonical SPL mints with
  liquidity across many AMM pools (Meteora-dominant) aggregated by Jupiter. Derive
  price + 1% depth by simulating Jupiter quotes at increasing size; enumerate pools
  via GeckoTerminal/Birdeye if per-pool reserves are needed.

Verified mint/feed values are in [`config/assets.json`](config/assets.json) with
per-field confidence notes (verify medium-confidence mints on Solscan before a
mainnet deploy). Still open: **CRCLON (Ondo) mint**, the two long-tail names, and
exact Jupiter/pool wiring.

## Status

**Implemented + verified:**
- Anchor program — 5 passing tests (happy path + 3 error cases).
- Scoring + mint/burn velocity — full logic, unit-tested.
- **Pyth Hermes client** — pull-by-feed-id; live-tested (AAPL ≈ $315).
- **Jupiter market client** — price + 1%-depth via exponential-ramp quote search;
  live-tested (AAPLx ≈ $315, 1%-depth ≈ $4.4k).
- **Helius webhook parser** — nets `tokenBalanceChanges` per mint (mint>0 / burn<0
  / transfers cancel); unit-tested.
- **ClickHouse writer** — lazy connect + DDL + batched insert (no-op without DSN).
- **On-chain `update_score` sender** — solana-go tx builder; instruction
  discriminators cross-checked against the generated IDL.

- **On-chain round-trip** — the Go sender init+update+read-back was verified
  end-to-end against a local validator with the program deployed.
- **Devnet (staging)** — program deployed to devnet; `init_assets.ts` initialized
  all 6 non-placeholder assets (idempotent; PDAs read back with correct metadata).
  Dry-run only — authority is the default wallet and mints are mainnet addresses
  used as PDA seeds; live scores need the program on mainnet + a dedicated
  indexer authority. Run: `ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
  ANCHOR_WALLET=~/.config/solana/id.json AUTHORITY_PUBKEY=<pubkey> yarn init-assets`.

- **Backtest** (`scripts/backtest.ts`) — reconstructs real on-chain mint/burn
  history and replays the procurement-velocity signal. Only that signal is
  backtestable (no historical Pyth premium or DEX depth exists to reconstruct).
  Signature listing uses any RPC; bulk parsing uses Helius's Enhanced
  Transactions REST endpoint (`POST /v0/transactions`) — free-tier friendly,
  unlike batched JSON-RPC. Net mint/burn per tx comes from summing
  `accountData[].tokenBalanceChanges` for the target mint (same approach as
  the Go webhook parser) — NOT Helius's top-level `type` field, which
  classifies the whole tx rather than any one token in it, and NOT
  `tokenTransfers`, which doesn't represent pure mint/burn at all. SPCX itself
  trades too heavily right now for signature-paging to reach interesting
  history cheaply; CRCLon (thin liquidity) is the working example — see
  `/backtest` in the frontend for a rendered chart (static JSON exported via
  `--json`, not a live fetch): `HELIUS_API_KEY=<key> npx ts-node
  scripts/backtest.ts --mint <MINT> --symbol <SYM> --json
  app/lib/backtest-data/<name>.json`.

Tests:
- Unit: `cd indexer && go test ./...`
- Live HTTP (Hermes/Jupiter), opt-in: `RS_LIVE=1 go test ./...`
- Full on-chain round-trip (spins up a validator, deploys, runs the Go
  init→update→read test): `./scripts/localnet_roundtrip.sh`
