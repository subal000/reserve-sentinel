# Kamino tokenized-stock collateral vs. executable exit depth

**Measured:** 2026-09-15, ~19:15 UTC (US market hours — depth is at its daily best).

## Question
How much of each tokenized stock is supplied to Kamino, and how much of it could
actually be sold on Solana DEXs right now?

## Method
- **Collateral:** `api.kamino.finance/kamino-market/{market}/reserves/metrics` for every
  Kamino market holding tokenized equities — xStocks Market (`5wJeMr…`),
  Sentora xStocks Market (`8BNUWR…`), Superstate Opening Bell (`CF32kn…`), STRCx Market (`B7a2Dm…`).
  Summed `totalSupplyUsd` per mint.
- **Depth:** Jupiter swap quotes (`lite-api.jup.ag/swap/v1/quote`) selling a ladder of USD
  sizes into USDC. Loss = 1 − received / notional, notional valued at Jupiter `usdPrice`.
- Anomalies re-quoted by hand; `NO_ROUTES_FOUND` confirmed as a real Jupiter response.

## Result

| asset | supplied on Kamino | max LTV | roughly sellable within ~5% | supplied ÷ sellable |
|---|---|---|---|---|
| GOOGLx | $2,762,595 | 60% | ~$200k (no route at $250k) | ~14× |
| MSTRx  | $3,874,844 | 30% | ~$400k ($1M → −95.6%) | ~10× |
| TSLAx  | $2,695,266 | 55% | ~$350k ($1M → −47.5%) | ~8× |
| QQQx   | $2,744,087 | 70% | ~$500k ($1M → −36.5%) | ~5× |
| NVDAx  | $2,411,374 | 55% | ~$500k ($1M → −45.0%) | ~5× |
| SPYx   | $4,131,622 | 73% | ~$1.1M ($2.5M → −34.9%) | ~4× |
| HOODx  | $616,563   | 30% | ~$250k (no route at $400k) | ~2.5× |
| AAPLx  | $460,877   | 40% | ~$300k (no route at $400k) | ~1.5× |
| CRCLx  | $855,375   | 30% | all of it (−4.7%) | ~1× |

Excluded: **STRCx** (quotes inconsistent — +6.1% at $100k, −100% at $150k). Found on 16 Sept: STRCx's
Token-2022 UI multiplier is 1.086, so every STRCx size was quoted ~8.6% too large (see caveat 6). **FWDI** ($19.7M) and **USCC** ($3.3M) in Superstate Opening Bell have no Jupiter price or route
at all — probably permissioned tokens liquidated through the issuer, not DEXs. Unverified; do not cite.

## Caveats — read before quoting any of this
1. **Supplied ≠ about to be liquidated.** Only positions that cross their threshold get liquidated, usually
   in part. The xStocks market had ~$4.8M USDC borrowed against ~$20M of collateral. "Sell it all at once"
   is a stress bound, not a forecast.
2. **On-chain depth only.** Market makers can refill pools from CEX order books (Kraken, Bybit) and via
   xStocks mint/redeem over minutes-to-hours. Instant DEX depth understates what's sellable given time.
3. **One snapshot, taken during US market hours.** Depth is likely thinner overnight and on weekends.
4. **Kamino only.** Jupiter Lend and Loopscale positions in the same tokens are not yet counted.
5. LTVs published by third-party articles were wrong (e.g. AAPLx listed at 70%; actual 40%). LTVs here are
   from Kamino's API. Kamino's LTV ordering (AAPLx 40% < TSLAx 55%) suggests it already weighs more than
   volatility — don't claim otherwise.
6. **Sizes ignore Token-2022 UI multipliers** (found 16 Sept). `depth.py` converts USD to raw amounts with
   Jupiter's per-token price, but xStocks mints scale balances by a multiplier (dividends): SPYx 1.0057,
   AAPLx 1.0033, QQQx 1.0027, GOOGLx 1.0024, NVDAx 1.0017; MSTRx, TSLAx, CRCLx, HOODx exactly 1. So sizes
   were up to 0.57% too large, which explains the small "gains" on $10k sales (SPYx $10k → $10,059). No
   conclusion in the table changes; STRCx (1.086) is the one it broke.
