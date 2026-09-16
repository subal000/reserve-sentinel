"""For each pledged tokenized stock, measure how much can actually be sold.

Loss is measured against a $1,000 sale of the same token (the price a retail
seller gets), not against an oracle, so it isolates market impact.
Sizes account for Token-2022 scaled UI multipliers.
"""
import json, sys, time, urllib.request

OUT = "/private/tmp/claude-501/-Users-subal-ReserveSentinel/e99c45c8-24e9-44fd-bcd8-25987c50077b/scratchpad"
USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
UA = {"User-Agent": "unwind-research", "Content-Type": "application/json"}
LADDER = [1_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000,
          2_000_000, 4_000_000, 8_000_000, 16_000_000]
THRESHOLDS = [0.01, 0.05, 0.10]

col = json.load(open(f"{OUT}/collateral.json"))


def get(url, tries=4):
    for i in range(tries):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30)), None
        except urllib.error.HTTPError as e:
            body = e.read().decode()[:200]
            if e.code == 400:
                return None, body
            if i == tries - 1:
                return None, f"HTTP {e.code} {body}"
            time.sleep(4 * (i + 1))
        except Exception as e:
            if i == tries - 1:
                return None, str(e)
            time.sleep(4 * (i + 1))


def multiplier(mint):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "getAccountInfo",
                       "params": [mint, {"encoding": "jsonParsed"}]}).encode()
    r = json.load(urllib.request.urlopen(urllib.request.Request(
        "https://api.mainnet-beta.solana.com", data=body, headers=UA), timeout=30))
    info = r["result"]["value"]["data"]["parsed"]["info"]
    for e in info.get("extensions", []):
        if e["extension"] == "scaledUiAmountConfig":
            s = e["state"]
            ts = s.get("newMultiplierEffectiveTimestamp") or 0
            return (float(s["newMultiplier"]) if ts and time.time() >= ts else float(s["multiplier"])), int(info["decimals"])
    return 1.0, int(info["decimals"])


rows = {}
targets = sorted(
    [(m, (col["kamino"].get(m, {}).get("usd", 0) + col["jupiter_lend"].get(m, {}).get("usd", 0)),
      col["kamino"].get(m, {}).get("symbol") or col["jupiter_lend"].get(m, {}).get("symbol") or m[:6])
     for m in col["stocks"]],
    key=lambda x: -x[1])
targets = [t for t in targets if t[1] >= 1000]

for mint, pledged, sym in targets:
    mult, dec = multiplier(mint)
    px = col["stocks"][mint]["usdPrice"]  # per UI token
    pts, base_unit = [], None
    for usd in LADDER:
        if usd > max(pledged * 4, 2_000_000):
            break
        raw = int(usd / px / mult * 10 ** dec)
        q, err = get(f"https://lite-api.jup.ag/swap/v1/quote?inputMint={mint}&outputMint={USDC}&amount={raw}&slippageBps=5000")
        time.sleep(1.1)
        if q is None:
            pts.append({"usd_in": usd, "no_route": True, "detail": err})
            break
        out = int(q["outAmount"]) / 1e6
        unit = out / usd
        if base_unit is None:
            base_unit = unit
        pts.append({"usd_in": usd, "usd_out": out, "loss": 1 - unit / base_unit})
        print(f"  {sym:<8} ${usd:>10,} -> ${out:>12,.0f}  loss {(1-unit/base_unit)*100:6.2f}%", file=sys.stderr, flush=True)

    sellable = {}
    for th in THRESHOLDS:
        best = 0.0
        for i, p in enumerate(pts):
            if p.get("no_route"):
                break
            if p["loss"] <= th:
                best = p["usd_in"]
            else:  # interpolate between the last good point and this one
                prev = pts[i - 1] if i else None
                if prev and not prev.get("no_route") and p["loss"] > prev["loss"]:
                    frac = (th - prev["loss"]) / (p["loss"] - prev["loss"])
                    best = prev["usd_in"] + frac * (p["usd_in"] - prev["usd_in"])
                break
        sellable[f"{int(th*100)}pct"] = best
    rows[mint] = {"symbol": sym, "pledged_usd": pledged, "multiplier": mult,
                  "kamino_usd": col["kamino"].get(mint, {}).get("usd", 0),
                  "jup_usd": col["jupiter_lend"].get(mint, {}).get("usd", 0),
                  "points": pts, "sellable": sellable}

json.dump({"fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "rows": rows},
          open(f"{OUT}/sellable.json", "w"), indent=1)

print(f"\n{'sym':<8} {'pledged':>12} {'sell@1%':>11} {'sell@5%':>11} {'sell@10%':>11}  cover@5%")
tp = ts5 = 0
for m, r in sorted(rows.items(), key=lambda x: -x[1]["pledged_usd"]):
    s = r["sellable"]
    tp += r["pledged_usd"]; ts5 += s["5pct"]
    cov = s["5pct"] / r["pledged_usd"] if r["pledged_usd"] else 0
    print(f"{r['symbol']:<8} ${r['pledged_usd']:>11,.0f} ${s['1pct']:>10,.0f} ${s['5pct']:>10,.0f} ${s['10pct']:>10,.0f}  {cov*100:6.1f}%")
print(f"\nTOTAL    ${tp:>11,.0f} {'':>11} ${ts5:>10,.0f} {'':>11}  {ts5/tp*100:6.1f}%")
