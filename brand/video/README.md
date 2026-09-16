# Unwind intro video

A 20.5-second text-led intro, rendered from HTML so every figure in it is the
measured one (research/2026-09-16-cross-lender-exit, taken 16 Sept 2026 at
05:42 UTC) and every cut can be re-rendered when the numbers change.

```
./render.sh                # 1920x1080 -> unwind-intro-1920x1080.mp4
./render.sh 1080 1080      # square cut for feeds
./render.sh 1080 1920      # vertical
```

Open `intro.html` in a browser to watch it loop while editing; add `?f=300` to
freeze a single frame (30 fps, so that's t=10s).

## Beats

| Time | On screen |
|---|---|
| 0.0–2.3s | `can you actually sell it?` types out |
| 2.3–6.2s | nine token bars stack in (SPYx, QQQx, TSLAx…) and sum to `$39,270,433` pledged across Kamino and Jupiter Lend |
| 6.2–10.4s | one slab of that total: 87% turns red and drains away, the counter falls to `$5,242,433`, then **13%** slams in |
| 10.4–15.2s | a GOOGLx sell ladder fills: $10k, $25k, $50k, $100k… then `$250,000 → NO ROUTE`, with a red hit and shake |
| 15.2–17.4s | "Every lender sees its own book. / Nobody sees the shared exit." |
| 17.4–20.5s | the mark draws itself, wordmark, slogan, measurement date, @unwindfi |

A broadcast-style strip stays on screen through the evidence (2.3–17.4s):
`DATA 16 SEP 2026 · 05:42 UTC`, the sources, and a running timecode. The end
card repeats the date and notes that US markets were closed at the time.

## How it renders

`render.sh` inlines the two brand fonts (cached in `fonts/`), then `render.js`
drives one headless Chrome over the DevTools protocol, calling the page's
`draw(t)` once per frame and screenshotting. ffmpeg encodes the frames to H.264.

The page is deliberately free of CSS transitions and timers: every value is a
function of `t`, so frame N always looks the same. That's what makes the render
reproducible and the timeline editable — change a number in the `draw()`
timeline and re-run.

One capture session is used because launching Chrome per frame costs ~2.5s each,
and parallel launches deadlock on the shared browser profile.

Needs Google Chrome, node and ffmpeg (`brew install ffmpeg`). `puppeteer-core`
is installed on first run.

## Updating the numbers

The figures live at the top of the script block in `intro.html` (`PLEDGED`,
`SELLABLE`, `TOKENS`, `LADDER`) and come from
`research/2026-09-16-cross-lender-exit`. If the study is re-run, update those,
the date in the chrome strip (`#tr`) and the end-card stamp (`#stamp`). The site
reads the same study through `app/lib/research.ts`; keep them in step.
