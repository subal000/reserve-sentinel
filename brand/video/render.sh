#!/usr/bin/env bash
# Render brand/video/intro.html to MP4.
#
#   ./render.sh                 # 1920x1080 -> unwind-intro-1920x1080.mp4
#   ./render.sh 1080 1080       # square cut for feeds
#
# Needs Google Chrome, ffmpeg and node. Fonts are fetched once into fonts/ and
# inlined, so the scene renders identically every run with no network.
set -euo pipefail

W=${1:-1920}
H=${2:-1080}
FPS=30
DURATION=16.5

cd "$(dirname "$0")"
CHROME=${CHROME_PATH:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
[ -x "$CHROME" ] || { echo "Google Chrome not found (set CHROME_PATH)"; exit 1; }
command -v ffmpeg >/dev/null || { echo "ffmpeg not installed (brew install ffmpeg)"; exit 1; }
command -v node >/dev/null || { echo "node not installed"; exit 1; }

# render.js drives one long-lived browser over the DevTools protocol. Launching
# Chrome once per frame costs ~2.5s each, and running several at once deadlocks
# on the shared profile (--user-data-dir hangs too), so a single session is
# both far faster and the only reliable option here.
[ -d node_modules/puppeteer-core ] || {
  echo "installing puppeteer-core…"
  npm install --no-save --no-audit --no-fund --silent puppeteer-core
}

OUT="unwind-intro-${W}x${H}.mp4"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

python3 - "$WORK" <<'PY'
import base64, pathlib, re, sys, urllib.request
work = pathlib.Path(sys.argv[1])
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
            if "U+0000-00FF" in block:   # latin subset: digits and punctuation
                url = re.search(r"url\((https://[^)]+\.woff2)\)", block).group(1)
        dest.write_bytes(urllib.request.urlopen(urllib.request.Request(url, headers=UA)).read())
    subs[placeholder] = "data:font/woff2;base64," + base64.b64encode(dest.read_bytes()).decode()

html = pathlib.Path("intro.html").read_text()
for k, v in subs.items():
    html = html.replace(k, v)
(work / "scene.html").write_text(html)
PY

echo "rendering $(python3 -c "print(int($DURATION*$FPS))") frames at ${W}x${H}…"
node render.js "$WORK/scene.html" "$WORK/frames" "$W" "$H" "$FPS" "$DURATION"

ffmpeg -y -loglevel error -framerate "$FPS" -i "$WORK/frames/f%04d.png" \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart "$OUT"

echo "wrote $OUT ($(du -h "$OUT" | cut -f1), ${DURATION}s)"
