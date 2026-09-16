# Unwind intro video

A 16.5-second text-only intro, rendered from HTML so the numbers in it are the
measured ones and every cut can be re-rendered when they change.

```
./render.sh                # 1920x1080 -> unwind-intro-1920x1080.mp4
./render.sh 1080 1080      # square cut for feeds
./render.sh 1080 1920      # vertical
```

Open `intro.html` in a browser to watch it loop while editing; add `?f=200` to
freeze a single frame (30 fps, so that's t=6.67s).

## Beats

| Time | On screen |
|---|---|
| 0.0–3.6s | `$39,270,433` counts up — pledged for loans on Solana |
| 3.6–7.6s | the same figure falls to `$5,242,433`, the part that can actually be sold, then a bar fills to 13% |
| 7.6–11.0s | `GOOGLx` — no buyer above $250,000, against $2.77M behind loans |
| 11.0–13.6s | what Unwind does |
| 13.6–16.5s | the mark draws itself, wordmark, slogan, @unwindfi |

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
`SELLABLE`) and come from `research/2026-09-16-cross-lender-exit`. The site
reads the same study through `app/lib/research.ts`; keep them in step.
