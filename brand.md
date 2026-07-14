# Brand — ReserveSentinel

_Status: active_

Chosen by the assistant (design delegated by the user). A **dark "risk monitor"**
aesthetic: precise, calm, serious — a sentinel watching markets. Financial-terminal
influence, but restrained and modern (not neon/cyberpunk).

## Palette (dark-only, HSL tokens in `app/app/globals.css`)

| Token | HSL | Use |
|---|---|---|
| `background` | `222 26% 7%` | page base (cool near-black slate) |
| `card` | `222 21% 10%` | cards / panels |
| `popover` | `222 21% 12%` | elevated surfaces |
| `muted` | `222 16% 16%` | chips, tracks, fills |
| `muted-foreground` | `214 15% 66%` | secondary text (AA on card) |
| `foreground` | `210 20% 93%` | primary text (soft off-white) |
| `border` | `222 16% 18%` | 1px hairlines |
| `primary` | `172 66% 46%` | brand teal — signal/monitoring accent |

**Risk scale** (the core semantic — maps to score bands & plain-English labels):

| Band | Label | Token | HSL |
|---|---|---|---|
| 80–100 | Looks safe | `risk-safe` | `152 58% 46%` (green) |
| 60–79 | Watch this one | `risk-watch` | `45 88% 55%` (amber) |
| 40–59 | Showing warning signs | `risk-warning` | `26 88% 56%` (orange) |
| 0–39 | High risk | `risk-high` | `0 74% 60%` (red) |

One accent (teal `primary`); risk colors are semantic only. Cool grays throughout.

## Typography

- **Sans:** Inter (`--font-sans`) — UI text.
- **Mono:** JetBrains Mono (`--font-mono`) — all numbers (scores, bps, USD,
  addresses) with `tabular-nums`. The mono-for-data choice is the terminal tell.

## Radius / surface

- `--radius: 0.75rem`. Cards `rounded-lg`, chips/buttons `rounded-md`.
- Flat-with-borders (1px hairlines), not heavy shadows. Subtle top radial glow on `body`.

## Voice

Concise, factual, protective. Plain English over jargon ("Watch this one", not
"elevated risk index"). Never alarmist; state the signal and let the color carry urgency.
