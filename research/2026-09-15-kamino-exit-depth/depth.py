import json,time,urllib.request,urllib.parse,sys
USDC="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
H={"User-Agent":"unwind-research/0.1","Accept":"application/json"}
def get(url):
    for attempt in range(4):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url,headers=H),timeout=25))
        except urllib.error.HTTPError as e:
            if e.code==429: time.sleep(4+attempt*4); continue
            if e.code in (400,404): return None
            raise
        except Exception: time.sleep(2)
    return None
coll=json.load(open("kamino_collateral.json"))
assets={m:a for m,a in coll.items() if a["supply"]>=100_000}
ids=",".join(assets)
px=get(f"https://lite-api.jup.ag/price/v3?ids={ids}") or {}
def quote_usd(mint,dec,usd,price):
    amt=int(usd/price*10**dec)
    if amt<=0: return None
    q=get(f"https://lite-api.jup.ag/swap/v1/quote?inputMint={mint}&outputMint={USDC}&amount={amt}&slippageBps=5000")
    time.sleep(1.1)
    if not q or "outAmount" not in q: return None
    return int(q["outAmount"])/1e6
res={}
for mint,a in sorted(assets.items(),key=lambda x:-x[1]["supply"]):
    p=px.get(mint) or {}
    price=p.get("usdPrice"); dec=p.get("decimals")
    if not price or dec is None:
        print(f"{a['sym']:8} no Jupiter price — skipped"); continue
    # sell-size ladder; loss = 1 - received/notional
    ladder=[10_000,50_000,100_000,250_000,500_000,1_000_000,2_500_000,5_000_000,10_000_000,20_000_000]
    ladder=[x for x in ladder if x<=max(a["supply"]*1.05,10_000)]
    if a["supply"] not in ladder: ladder.append(round(a["supply"]))
    pts=[]
    for usd in sorted(set(ladder)):
        got=quote_usd(mint,dec,usd,price)
        loss=None if got is None else max(0.0,1-got/usd)
        pts.append((usd,got,loss))
        if got is None or loss>0.5: break
    res[mint]={"sym":a["sym"],"supply":a["supply"],"price":price,"liquidity":p.get("liquidity"),"points":pts}
    line=" ".join(f"${u/1e6:.2g}M→{'NR' if l is None else f'{l*100:.1f}%'}" if u>=1e6 else f"${u/1e3:.0f}k→{'NR' if l is None else f'{l*100:.1f}%'}" for u,g,l in pts)
    print(f"{a['sym']:8} supplied ${a['supply']:>11,.0f} | {line}", flush=True)
json.dump(res,open("depth_results.json","w"),indent=1)
