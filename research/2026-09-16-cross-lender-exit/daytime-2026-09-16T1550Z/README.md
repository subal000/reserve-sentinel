# US-hours re-run — 16 Sept 2026, 15:50 UTC (11:50 ET, market open)

Same method and ladder as the overnight snapshot in the parent folder, with one
change: when a route ends between two ladder steps, the gap is now bisected
(4 steps) so the ceiling is measured instead of reported as the last filled step.

Reproduce: `python3 ../collateral.py . && python3 ../sellable.py .`

## Result

| | Overnight (05:42 UTC) | US hours (15:50 UTC) |
|---|---|---|
| Pledged (Kamino + Jupiter Lend) | $39.27M | $39.37M |
| Sellable within 5% | $5.24M | $5.53M |
| Covered | **13.3%** | **14.1%** |

**Opening the US market barely changed on-chain exit depth.** Liquidity for these
tokens tracks the market makers' on-chain inventory, not the stock exchange's hours.

| Token | Overnight @5% | US hours @5% |
|---|---|---|
| SPYx | $2.08M | $2.02M |
| QQQx | $472k | $487k |
| TSLAx | $502k | $505k |
| NVDAx | $509k | $524k |
| MSTRx | $373k | $357k |
| GOOGLx | $100k* | $231k |
| CRCLx | $703k | $514k |
| HOODx | $248k | $656k† |
| AAPLx | $250k* | $313k |

\* Overnight floor: the route ended between ladder steps and the old script
reported the last filled step. The true overnight figure lies between this and the
next step (GOOGLx < $250k, AAPLx < $500k), so the overnight total was between
13.3% and 14.4%.

† More than is pledged ($585k). Totals count each token at most at its pledged
amount.

**GOOGLx:** $231,250 sold at −4.40%; **no route at $240,625**. Against $2.78M
pledged.

## Exclusions and caveats

Same as the parent README: STRCx excluded (quotes return zero proceeds instead of
"no route" at size), dust tokens ignored, pledged is a stress bound rather than a
liquidation forecast, and instant DEX depth ignores refills over time.
