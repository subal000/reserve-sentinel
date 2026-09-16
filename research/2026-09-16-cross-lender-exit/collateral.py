"""Collect tokenized-stock collateral across Kamino, Jupiter Lend and Loopscale."""
import json, sys, time, urllib.request

UA = {"User-Agent": "unwind-research"}
OUT = "/private/tmp/claude-501/-Users-subal-ReserveSentinel/e99c45c8-24e9-44fd-bcd8-25987c50077b/scratchpad"


def get(url, tries=3):
    for i in range(tries):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30))
        except Exception as e:
            if i == tries - 1:
                raise
            time.sleep(2 * (i + 1))


def is_stock(mints):
    """Jupiter price v3 carries stockData only for tokenized equities."""
    out = {}
    for i in range(0, len(mints), 40):
        chunk = mints[i:i + 40]
        d = get("https://lite-api.jup.ag/price/v3?ids=" + ",".join(chunk))
        for m, e in (d or {}).items():
            if e and e.get("stockData"):
                out[m] = {"issuer": e["stockData"].get("id"), "usdPrice": e.get("usdPrice"),
                          "share": e["stockData"].get("price"), "decimals": e.get("decimals")}
        time.sleep(1)
    return out


# ---- Kamino -----------------------------------------------------------------
kamino = {}
markets = get("https://api.kamino.finance/v2/kamino-market")
market_addrs = [m["lendingMarket"] if isinstance(m, dict) and "lendingMarket" in m else m for m in
                (markets if isinstance(markets, list) else markets.get("markets", []))]
print(f"kamino markets: {len(market_addrs)}", file=sys.stderr)
for addr in market_addrs:
    try:
        res = get(f"https://api.kamino.finance/kamino-market/{addr}/reserves/metrics?env=mainnet-beta")
    except Exception as e:
        print(f"  skip {addr}: {e}", file=sys.stderr)
        continue
    for r in (res if isinstance(res, list) else res.get("reserves", [])):
        mint = r.get("liquidityTokenMint")
        supply = float(r.get("totalSupplyUsd") or r.get("totalSupply") or 0)
        if not mint or supply <= 0:
            continue
        e = kamino.setdefault(mint, {"usd": 0.0, "symbol": r.get("liquidityToken"), "markets": []})
        e["usd"] += supply
        e["markets"].append({"market": addr, "usd": supply, "maxLtv": r.get("maxLtv")})
    time.sleep(0.3)

# ---- Jupiter Lend -----------------------------------------------------------
jup = {}
for v in get("https://lite-api.jup.ag/lend/v1/borrow/vaults"):
    tok = v.get("supplyToken") or {}
    mint, dec = tok.get("address"), tok.get("decimals")
    if not mint or dec is None:
        continue
    price = float(tok.get("price") or 0)
    usd = float(v.get("totalSupply") or 0) / 10 ** dec * price
    if usd <= 0:
        continue
    e = jup.setdefault(mint, {"usd": 0.0, "symbol": tok.get("symbol"), "vaults": []})
    e["usd"] += usd
    e["vaults"].append({"vault": v.get("address"), "usd": usd,
                        "collateralFactor": v.get("collateralFactor"),
                        "liquidationThreshold": v.get("liquidationThreshold"),
                        "borrowSymbol": (v.get("borrowToken") or {}).get("symbol")})

# ---- Loopscale (via DefiLlama; its own API host does not resolve) -----------
llama = get("https://api.llama.fi/protocol/loopscale")
loop_tokens = llama["tokensInUsd"][-1]

candidates = sorted(set(list(kamino) + list(jup)))
print(f"candidate mints: {len(candidates)}", file=sys.stderr)
stocks = is_stock(candidates)
print(f"tokenized stocks: {len(stocks)}", file=sys.stderr)

result = {
    "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "stocks": stocks,
    "kamino": {m: v for m, v in kamino.items() if m in stocks},
    "jupiter_lend": {m: v for m, v in jup.items() if m in stocks},
    "loopscale_llama": {"date": loop_tokens["date"], "tokens": loop_tokens["tokens"]},
    "kamino_all_total_usd": sum(v["usd"] for v in kamino.values()),
    "jupiter_all_total_usd": sum(v["usd"] for v in jup.values()),
}
json.dump(result, open(f"{OUT}/collateral.json", "w"), indent=1)

print("\n=== tokenized-stock collateral ===")
rows = []
for m, s in stocks.items():
    k = kamino.get(m, {}).get("usd", 0.0)
    j = jup.get(m, {}).get("usd", 0.0)
    sym = (kamino.get(m, {}).get("symbol") or jup.get(m, {}).get("symbol") or m[:6])
    rows.append((k + j, sym, s.get("issuer"), k, j, m))
for tot, sym, issuer, k, j, m in sorted(rows, reverse=True):
    print(f"{sym:<10} {issuer or '?':<10} kamino ${k:>12,.0f}  jupLend ${j:>12,.0f}  total ${tot:>12,.0f}  {m}")
print(f"\nTOTAL stock collateral: kamino ${sum(r[3] for r in rows):,.0f}  jupiterLend ${sum(r[4] for r in rows):,.0f}")
