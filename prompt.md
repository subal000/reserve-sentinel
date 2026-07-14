You are helping me build ReserveSentinel, a real-time, on-chain risk scoring 
system for tokenized RWA stocks on Solana. This is a hackathon project with 
a 5-day window. I want to build it properly, not just a prototype.

## What this project does

Tokenized stocks on Solana (like AAPLx, TSLAx, CRCLx from xStocks, or CRCLON 
from Ondo, or SPCX from Backpack/Sunrise) can break. In June 2026, xStocks 
couldn't source enough real SpaceX shares to back demand, and over $1B in 
customer orders got cancelled. Nobody saw it coming because there was no 
public warning system.

ReserveSentinel watches three real-time signals per tracked token:
- Premium/discount vs the real stock's reference price (via Pyth)
- On-chain liquidity depth (how thin are the DEX pools)
- Mint/burn velocity anomaly (sudden spike in new token creation = procurement stress)

It combines these into a 0-100 composite score and writes it to an on-chain 
Anchor PDA. Free public dashboard for regular holders. Same data readable 
by DeFi protocols as a composable risk feed.

## Tech stack

- On-chain: Anchor (Rust), deployed to Solana mainnet
- Indexer + scoring engine: Go
- Event streaming: Helius webhooks (mint/burn events per token)
- Price reference: Pyth on-chain equity price feeds
- Pool data: Direct Solana RPC reads on Raydium/Jupiter pool accounts
- Time series: ClickHouse Cloud (free tier)
- Hosting: Fly.io
- Frontend: Next.js (App Router)
- Alerts: Telegram Bot API

## Tokens to track (confirm mint addresses from Solscan before hardcoding)

- CRCLx (xStocks, Circle stock)
- CRCLON (Ondo, Circle stock) ← same underlying, different issuer, flagship comparison case
- SPCX (Backpack/Sunrise, SpaceX)
- AAPLx (xStocks, Apple)
- TSLAx (xStocks, Tesla)
- MU tokenized (Backpack/Sunrise, Micron)
- 1-2 thin long-tail names from xstocks.fi (pick the lowest volume ones listed)

## On-chain program: the AssetScore account

One PDA per tracked mint. Seeds: [b"asset_score", mint.as_ref()]

Fields:
- mint: Pubkey
- issuer: u8 (0=xStocks, 1=Ondo, 2=Backpack/Sunrise, 3=other)
- underlying_ticker: [u8; 8] (e.g. b"CRCL    " - groups cross-issuer wrappers)
- trust_tier: u8 (0-3, manually set, 3=redeemable-custodial, 0=purely synthetic)
- score: u8 (0-100 composite)
- premium_bps: i32 (signed basis points vs reference price)
- liquidity_depth_usd: u64 (USD to move price 1%)
- mint_burn_z: i32 (z-score of mint/burn velocity, scaled x100)
- last_updated: i64 (unix timestamp)
- authority: Pubkey (backend keypair allowed to call update_score)

Instructions needed:
- initialize_asset(mint, issuer, underlying_ticker, trust_tier, authority)
- update_score(score, premium_bps, liquidity_depth_usd, mint_burn_z)
  → authority-gated, anyone can read, only authority can write

## Scoring formula

price_component = 100 - min(100, abs(premium_bps) / 10)
liquidity_component = scaled 0-100 based on depth_usd (tune after seeing real data)
procurement_component = 100 - min(100, max(0, mint_burn_z / 100))
trust_tier_component = trust_tier * 25  (0, 25, 50, 75, or 100)

composite = (0.30 * price) + (0.25 * liquidity) + (0.25 * procurement) + (0.20 * trust_tier)

Also map composite to a plain-English label:
- 80-100: "Looks safe"
- 60-79: "Watch this one"
- 40-59: "Showing warning signs"
- 0-39: "High risk"

## Go indexer structure

cmd/
  indexer/main.go       ← entry point, starts webhook server + scheduler
internal/
  helius/               ← webhook handler, parses mint/burn events
  pyth/                 ← reads Pyth price account for each tracked asset
  pool/                 ← reads Raydium/Jupiter pool reserves via RPC
  scoring/              ← computes the four components + composite
  clickhouse/           ← writes time series score history
  anchor/               ← calls update_score instruction on-chain
config/
  assets.json           ← list of tracked mints with issuer + ticker metadata

The indexer should:
1. On startup, load assets.json and verify all mint addresses exist on mainnet
2. Start an HTTP server on :8080 for Helius webhooks
3. On each webhook event: update the mint/burn window for that asset, 
   recompute score, write to ClickHouse, call update_score on-chain if 
   score changed by more than 2 points
4. Also run a ticker every 60s to refresh price + liquidity for all assets 
   even if no mint/burn events came in

## Frontend structure (Next.js App Router)

app/
  page.tsx              ← main dashboard, grid of asset score cards
  compare/[ticker]/     ← cross-issuer comparison view (e.g. CRCL: xStocks vs Ondo)
  basket/               ← read-only basket demo, pick assets, see aggregate score
components/
  ScoreCard.tsx         ← per-asset card: name, issuer, plain-English label, 
                           color-coded score (green/yellow/orange/red), 
                           premium_bps, last_updated
  IssuerBadge.tsx       ← shows trust_tier visually
  ScoreHistory.tsx      ← sparkline from ClickHouse time series
  CrossIssuerView.tsx   ← side by side comparison for same underlying_ticker

Read scores directly from on-chain PDAs using @coral-xyz/anchor on the 
frontend. Don't proxy through a backend API for reads, that defeats the 
point of putting it on-chain.

## Repo structure

reserve-sentinel/
  programs/
    reserve-sentinel/   ← Anchor program
  app/                  ← Next.js frontend
  indexer/              ← Go indexer
  scripts/
    init_assets.ts      ← one-time script to call initialize_asset for each tracked mint
    backtest.ts         ← pulls historical on-chain mint data and runs scoring retroactively
  config/
    assets.json         ← shared asset config used by indexer and init script
  README.md

## What I want you to do first

1. Scaffold the full repo structure above with placeholder files
2. Write the complete Anchor program (initialize_asset + update_score, 
   the AssetScore account, proper error handling, tests)
3. Write assets.json with the tracked tokens (use placeholder mint addresses 
   clearly marked as TODO, I will fill in the real ones from Solscan)
4. Write the Go indexer skeleton: main.go, the internal package structure, 
   config loading, and the Helius webhook handler stub

Do not start the frontend yet. Get the on-chain program and indexer structure 
solid first.

Ask me before making any assumptions about:
- Exact Pyth price feed account addresses for equity feeds on Solana mainnet
- Which DEX venue Backpack/Sunrise assets primarily trade on
- Fly.io vs Railway vs Render for indexer hosting (I have Fly.io set up already)

My Go version is 1.22. I use go modules. Anchor version should be the latest 
stable. I am comfortable with Rust at a reading level but not a writing level, 
so feel free to write the Anchor program fully, just explain any non-obvious 
decisions inline as comments.