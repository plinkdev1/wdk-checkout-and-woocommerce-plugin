# WDK Pay — brand assets

WDK Pay is part of the **WDK** ecosystem, so its mark **is** the ecosystem mark:
the Bold **W** master badge, paired with a **"WDK Pay"** wordmark. This makes it a
direct sibling of **WDK Wallet** — same badge, same colours, same typographic
family — exactly the Apple Pay / Google Pay model (reuse the brand mark, change
the word).

> The badge is the **unmodified** WDK master mark (the `wdk-master-mark-*.png`
> files are byte-identical to the ones shipped with the wallet repos). No mark was
> redrawn or AI-generated — only the "WDK Pay" wordmark was set in type.

## Colours

| Token | Hex |
|---|---|
| WDK Orange | `#FB451E` |
| WDK Warm Dark | `#15010C` |
| WDK Cream (wordmark on dark) | `#F7EEE8` |

## Files

| File | Use |
|---|---|
| `wdk-pay-lockup.svg` | **Primary** — self-contained vector lockup (dark panel + badge + wordmark). Scales to any size. |
| `wdk-pay-lockup-dark.png` / `-dark-1024.png` | Raster hero on a rounded dark panel. Safe on **any** background (README, social). |
| `wdk-pay-lockup-ondark.png` | Transparent lockup, **cream** wordmark — for dark surfaces. |
| `wdk-pay-lockup-onlight.png` | Transparent lockup, **dark** wordmark — for light surfaces. |
| `wdk-pay-wordmark-{cream,dark}.svg`, `-{512,1024}.png` | "WDK Pay" wordmark only. |
| `wdk-pay-icon-{16…512}.png` | Square app/gateway icon (the Bold W badge). |
| `favicon.ico` | Multi-size favicon (the badge). |
| `wdk-master-mark-{32…1024}.png` | The Bold W master badge, on its own. |

## Typography

The wordmark is set in **[Zilla Slab](https://github.com/google/fonts/tree/main/ofl/zillaslab)**
Bold (the closest open match to the "WDK Wallet" display slab). The shipped assets
are **outlined** (text converted to vector paths / rasterised), so no font file is
required at runtime. Zilla Slab is licensed under the SIL Open Font License v1.1 —
see [`ZillaSlab-OFL.txt`](./ZillaSlab-OFL.txt).
