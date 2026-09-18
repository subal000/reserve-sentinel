#!/usr/bin/env python3
"""Update the stable "latest snapshot" pointer file after a run.

Usage: update_latest.py <snapshot_dir>
Writes research/2026-09-16-cross-lender-exit/latest.json (relative to cwd),
a small, stable file other things can read without knowing the timestamped
folder name — e.g. a future site build step, or a status check.
"""
import json
import sys
from pathlib import Path

snap_dir = Path(sys.argv[1])
sellable = json.loads((snap_dir / "sellable.json").read_text())
rows = sellable["rows"]

priced = {m: r for m, r in rows.items() if r["symbol"] != "STRCx" and r["pledged_usd"] >= 1000}
pledged = sum(r["pledged_usd"] for r in priced.values())
sellable5 = sum(min(r["sellable"]["5pct"], r["pledged_usd"]) for r in priced.values())

out = {
    "snapshot_dir": str(snap_dir),
    "fetched_at": sellable["fetched_at"],
    "totals": {
        "pledged": round(pledged),
        "sellable5": round(sellable5),
        "coverage": round(sellable5 / pledged, 4) if pledged else 0,
    },
}
Path("latest.json").write_text(json.dumps(out, indent=2) + "\n")
print(f"wrote latest.json -> {out['totals']}")
