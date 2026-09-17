#!/usr/bin/env bash
# Render a static tweet graphic from an HTML file at 1600x900 (X's landscape card size).
#
#   ./render-graphic.sh graphic-market-hours.html
#
# Reuses the same font cache as render.sh.
set -euo pipefail
SRC=${1:?usage: render-graphic.sh <file.html>}
cd "$(dirname "$0")"

python3 - "$SRC" <<'PY'
import base64, pathlib, re, sys, urllib.request
src = pathlib.Path(sys.argv[1])
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"}
cache = pathlib.Path("fonts")
cache.mkdir(exist_ok=True)
subs = {}
for fam, placeholder, name in [
    ("Instrument+Sans", "__INST_FONT__", "instrument-sans-600.woff2"),
    ("JetBrains+Mono", "__MONO_FONT__", "jetbrains-mono-600.woff2"),
]:
    dest = cache / name
    if not dest.exists():
        css = urllib.request.urlopen(urllib.request.Request(
            f"https://fonts.googleapis.com/css2?family={fam}:wght@600&display=swap", headers=UA)).read().decode()
        url = None
        for block in css.split("@font-face"):
            if "U+0000-00FF" in block:
                url = re.search(r"url\((https://[^)]+\.woff2)\)", block).group(1)
        dest.write_bytes(urllib.request.urlopen(urllib.request.Request(url, headers=UA)).read())
    subs[placeholder] = "data:font/woff2;base64," + base64.b64encode(dest.read_bytes()).decode()

html = src.read_text()
for k, v in subs.items():
    html = html.replace(k, v)
out = src.with_suffix(".rendered.html")
out.write_text(html)
print(out)
PY

RENDERED="${SRC%.html}.rendered.html"
OUT="${SRC%.html}.png"
CHROME=${CHROME_PATH:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=1600,900 --virtual-time-budget=1500 \
  --screenshot="$OUT" "file://$(pwd)/$RENDERED" >/dev/null 2>&1
rm -f "$RENDERED"
echo "wrote $OUT"
