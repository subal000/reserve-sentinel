# Tokenized stocks pledged across lenders vs what can actually be sold

**$40.0M of tokenized stocks is posted as loan collateral on Solana. About $5.3M of it
can be sold within 5% of the price a retail seller gets. That is 13%.**

Measured 16 Sept 2026, 05:42 UTC (01:42 ET — **US markets closed**; see caveat 3).

## Question

Kamino and Jupiter Lend both accept tokenized stocks as collateral, and both liquidate into the
same Solana liquidity. Each prices how far a stock can fall. Neither publishes whether the
collateral could be sold, and neither can see the other's exposure. So: how much is pledged, and
how much is sellable?

## Method

1. **Pledged.** Kamino: all 41 markets via `api.kamino.finance/v2/kamino-market`, then each
   market's `reserves/metrics` (`totalSupplyUsd` per reserve). Jupiter Lend: all 80 borrow vaults
   via `lite-api.jup.ag/lend/v1/borrow/vaults` (`totalSupply` x `supplyToken.price`). Loopscale's
   own API host does not resolve, so its holdings come from DefiLlama's token breakdown.
2. **Which mints are stocks.** A mint counts as a tokenized stock when Jupiter's `/price/v3`
   returns a `stockData` block for it. 12 of 137 pledged mints qualified.
3. **Sellable.** For each mint, a ladder of Jupiter sell quotes from $1,000 to $16M. Loss is
   measured against the **$1,000 sale of the same token**, not an oracle, so it isolates market
   impact from any premium or discount to the underlying share. Sizes are converted through the
   Token-2022 scaled UI multiplier (`scaledUiAmountConfig`, applying `newMultiplier` once its
   timestamp has passed), without which sizes are wrong by up to 8.6% (STRCx).
4. The 1% / 5% / 10% figures interpolate between the two bracketing ladder points.

Reproduce: `python3 collateral.py` then `python3 sellable.py`. Raw output in the two JSON files.

## Result

| Token | Kamino | Jupiter Lend | Pledged | Sellable @5% | Covered | Route ends |
|---|---|---|---|---|---|---|
| SPYx   | $4.15M | $14.08M | $18.23M | $2.08M | 11.4% | — |
| QQQx   | $2.75M | $1.63M  | $4.38M  | $472k  | 10.8% | — |
| TSLAx  | $2.70M | $1.55M  | $4.24M  | $502k  | 11.8% | no route at $16M |
| NVDAx  | $2.41M | $1.47M  | $3.88M  | $509k  | 13.1% | — |
| MSTRx  | $3.85M | —       | $3.85M  | $373k  | 9.7%  | — |
| GOOGLx | $2.77M | —       | $2.77M  | $100k  | 3.6%  | **no route at $250k** |
| CRCLx  | $841k  | —       | $841k   | $703k  | 83.6% | — |
| HOODx  | $613k  | —       | $613k   | $248k  | 40.5% | **no route at $500k** |
| AAPLx  | $461k  | —       | $461k   | $250k  | 54.3% | **no route at $500k** |
| **Total** | **$21.26M** | **$18.74M** | **$39.99M** | **$5.35M** | **13.4%** | |

STRCx ($723k pledged) is excluded from the totals above: its quotes return zero proceeds rather
than "no route" at $250k and up, the same anomaly seen on 15 Sept. Dropping it changes the total
to $39.27M pledged and 13.3% covered. GLXY ($13) and METAx ($1) are dust.

Two results stand out beyond the headline:

- **GOOGLx has no Jupiter route above $100k**, against $2.77M pledged on Kamino. Not "expensive to
  sell" — no route at all at that size.
- **SPYx is 46% of all pledged stock collateral**, and $14.1M of it sits in a single venue,
  Jupiter Lend, against $2.1M of sellable depth.

## Why the two lenders can't net out

Kamino and Jupiter Lend liquidate into the same pools. If both liquidate at once, the depth
measured here is shared, not doubled: the second seller gets what's left after the first. Every
per-lender risk model implicitly assumes it is the only seller.

## Caveats — read before quoting any of this

1. **Pledged is not "about to be liquidated."** Only positions past their threshold get
   liquidated, usually partially. This is a stress bound, not a forecast.
2. **On-chain depth only.** Market makers refill from CEX order books (Kraken, Bybit) and via
   issuer mint/redeem over minutes to hours. Instant DEX depth understates what's sellable with time.
3. **Taken overnight, with US markets closed.** Tokenized-stock depth is thinner off-hours. The
   15 Sept snapshot (19:15 UTC, market open) is the daytime comparison; CRCLx for example sold
   $855k at −4.7% then vs $703k within 5% now.
4. **One snapshot.** No history yet. The indexer records depth continuously; this study does not.
5. **Loopscale holds almost no tokenized stock** (MSTRx $30.8k, CRCLx $761 per DefiLlama). Its RWA
   exposure is private credit (ONYC $39.2M, ACRED $2.4M). Any "three lenders" claim is wrong: two
   lenders matter here.
6. **Kamino's `totalSupplyUsd` and Jupiter's `price` are the venues' own numbers**, not independently
   verified.
