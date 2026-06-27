# WDK Pay — Roadmap

> WDK Pay lets merchants accept **USDt paid directly from a self-custodial WDK
> wallet**, with on-chain verification and no custodian. This roadmap shows what
> ships today and how it grows into a complete, multi-rail crypto-commerce
> standard. Later phases are scoped against real, published `@tetherto/*`
> packages and our own [`wdk-protocol-eip3009`](https://github.com/plinkdev1/wdk-protocol-eip3009)
> module.

## ✅ Phase 1 — Self-custodial USDt checkout (SHIPPED)

- **WooCommerce gateway** (`WC_Payment_Gateway`) — admin settings, `process_payment`,
  order-pay rendering, REST endpoints (`/confirm`, `/status`), and **on-chain
  verification** via JSON-RPC (Transfer log: correct token, recipient, amount,
  confirmations) on Ethereum / Polygon / Arbitrum. All files pass `php -l`;
  base-unit math is big-number-safe.
- **Framework-free checkout widget** (`packages/wdk-checkout`, TypeScript) —
  "pay with wallet" (EIP-1193 + `USDt.transfer`) or "pay manually + confirm by tx
  hash"; QR, countdown, live status; builds to a single ~30 KB asset.
- **Gasless option** via the companion `wdk-protocol-eip3009` module.
- Zero-setup demo (`examples/checkout-demo.html`), `docs/ARCHITECTURE.md` (M1),
  merchant setup, security model, media.

## 🚧 Phase 2 — More assets & rails at checkout

1. ✅ **Multi-asset (USDt + XAUt)** — the gateway now offers an **Accepted asset**
   setting (USDt — Tether USD / XAUt — Tether Gold). The chain registry carries a
   per-chain asset map (token + decimals); the intent and on-chain verifier resolve
   the chosen asset, falling back to USDt on chains where it isn't deployed. The
   checkout widget is already asset-agnostic. Next: USDC + per-product currency.
2. **Multi-chain auto-detect** — let the shopper pay on any supported EVM chain;
   the gateway verifies on whichever chain the tx landed.
3. ✅ **Lightning (Spark) checkout** (`@tetherto/wdk-wallet-spark`) — done
   end-to-end (rail **and** a live WooCommerce gateway).
   - ✅ **Rail** — the `wdk-checkout/lightning` module: mint a BOLT11 invoice,
     poll to settlement. Backends are pluggable via a `LightningProvider`;
     `createLightningClient` wires a generic REST endpoint (injectable fetch,
     tolerant parsers for Spark/LNbits/LND-REST) and `pollInvoice` drives it to a
     paid/expired terminal state. Sats helpers (`satsForFiat`, `btcToSats`,
     `formatSats`) price the order. `createSparkLightningProvider` adapts a WDK
     Spark account so a merchant can receive **into their own Spark wallet** (no
     third-party LN service; the package imports no SDK). No node URL/key is
     hard-coded.
   - ✅ **WooCommerce gateway** — a `WDK_Pay_Lightning_Gateway` (id
     `wdk_pay_lightning`) the merchant selects at checkout. Admin settings point
     it at a Lightning backend (Spark service / LNbits / LND-REST). The order-pay
     page converts the total to sats, mints a BOLT11 invoice **server-side**
     (credentials never reach the browser), renders it as a QR + copyable string,
     and polls `GET /wdk-pay/v1/lightning/status/{orderKey}`; on paid it calls
     `payment_complete()`. PHP mirror of the JS rail (`class-wdk-pay-lightning-*`).
     The customer pays from any Lightning wallet (incl. a WDK Spark wallet).
   - Follow-up: a live BTC price feed (the gateway uses a configured rate today).
4. **Bitcoin on-chain** — accept BTC via the engine's BIP-84 support.

5. ✅ **x402 — charge bots/agents/crawlers** — an HTTP 402 facilitator
   (`wdk-checkout/x402`) verifies EIP-3009 "exact"-scheme payments off-chain
   (no keys/RPC, edge-friendly), plus ready-to-deploy **Cloudflare Worker** and
   **Express** middleware that let humans + verified search engines through and
   paywall AI scrapers. Pairs with the WDK wallet's x402 payer client and
   `@tetherto/wdk-protocol-eip3009` for settlement.

## ⏳ Phase 3 — Merchant economics

5. ✅ **Fiat pricing display** — done (display + conversion). The widget now shows
   the familiar store-currency price (e.g. "$19.99") above the on-chain token
   amount, driven by `displayTotal` + `currency` on the intent. A new
   dependency-free `wdk-checkout/pricing` module provides exact base-unit
   conversion/formatting and a **pluggable** `RateSource` (`staticRate` for the
   1:1 case, `endpointRate` to wire CoinGecko/Chainlink/your feed) so a store
   priced in any currency can quote into the settlement token. No price source is
   hard-coded. (`@tetherto/wdk-pricing-*` is not yet published; swap a RateSource
   adapter in when it is.)
6. ✅ **Swap-to-settle** (`@tetherto/wdk-protocol-swap-velora-evm`) — done (plan +
   seams). A new `wdk-checkout/swap` module models it as an **exact-output** swap:
   the merchant receives exactly the order amount of USDt while the customer pays
   a variable amount of their chosen token, capped by slippage. It owns the exact
   (BigInt) plan math — `maxPayAmountBase` (input cap), pinned output, deadline —
   behind a pluggable `SwapQuoteProvider` (wire Velora/0x/1inch; the WDK wallet
   bundles the Velora protocol for execution). After the swap the merchant still
   gets a plain USDt `Transfer`, so the existing on-chain verifier is unchanged.
7. **Refunds & partial captures**; ✅ **subscriptions** (recurring EIP-3009 auths) —
   done. A new `wdk-checkout/subscriptions` module models a subscription as a
   schedule of per-period EIP-3009 authorizations: each charge has its own
   time-boxed `validAfter`..`validBefore` window and a unique deterministic nonce,
   so a period can only be claimed during that period and exactly once. The
   customer signs each charge's typed data; the merchant relayer settles the due
   charge through the **same** `transferWithAuthorization` path as x402
   (`settleExactPayment`). Self-custodial — nothing auto-charges without a
   customer signature. (Refunds/partial-captures still open.)

## ⏳ Phase 4 — Platform breadth

8. **More platforms** — Shopify app, Magento, and a generic REST/webhook core so
   the same verification engine backs any storefront.
9. **Fiat on-ramp at checkout** (`@tetherto/wdk-protocol-fiat-moonpay`) — let
   shoppers without crypto buy and pay in one flow.
10. Hosted **payment-status webhooks** + reconciliation dashboard.

## ⏳ Phase 5 — White-label widget & drop-in embed

WDK Pay already ships as a **framework-free, ~30 KB embeddable widget**
(`mountCheckout(root, config)`) — not only a WooCommerce plugin. The WooCommerce
gateway is one *consumer* of that widget; the same asset drops into any page, SPA,
or platform. Phase 5 makes the widget **fully white-label** (match any brand with
no code) and **truly drop-in** (one tag, any stack), bringing it to the same
theming standard we set on the WDK wallet template + extension.

### 5A — Full white-label customization (parity with the WDK wallets)

11. **Brand block — logo + top-center header slot.** Add a `brand` section to the
    config: merchant `logoSrc` (+ `logoAlt`, `logoHeight`), optional
    `title`/`subtitle`, and a **top-center header area** rendered above the
    "Amount due" card — the natural home for a store logo. Today the widget has no
    logo (the only mark is the "Secured by WDK" footer). Surface the same controls
    in the WooCommerce **Checkout appearance** admin (logo media-picker + header
    text) so a merchant brands the modal with zero code — exactly how the wallet
    products expose `brand.markSrc` / `wordmarkSrc`.
12. **Typography — real font control.** `CheckoutTheme.fontFamily` is a CSS stack
    only (it can't load anything). Add optional web-font loading (`fontUrl` /
    Google-Fonts name / `@font-face`), a separate heading font, and a weight/size
    scale, so the checkout actually *renders* the storefront's brand font instead
    of only requesting it if already installed.
13. **Shape & edges — per-element radii + button styles.** One global `radius`
    drives every corner today. Split into `cardRadius`, `buttonRadius`,
    `inputRadius` (so **button edges** are independently roundable → square /
    rounded / pill), add a button **style** token (solid / outline / soft) and an
    optional gradient accent. Mirrors the wallets' per-surface edge tokens.
14. **Theme presets + light/dark mode.** Ship named presets — the palettes we
    standardized on the wallets (warm dark + orange, cool dark, institutional
    light) — selectable by **one key**, plus a `mode: 'light' | 'dark'` dimension
    and `prefers-color-scheme` auto-detect. A merchant picks
    `theme: 'institutional-light'` instead of hand-tuning 13 colors. Define a
    **shared theme contract** so the same preset names mean the same thing across
    WDK Pay and the wallet UI (`@wdk-starter/wdk-ui`).
15. **Custom-CSS escape hatch + class hooks.** Stable `data-wdk-*` / className
    hooks on every element plus an optional `customCss` string, for merchants who
    want pixel control beyond the token set.
16. **Live preview in admin.** Render the themed widget live in the WooCommerce
    settings page as the merchant edits colors / logo / fonts (today they save,
    then check the order-pay screen).
17. **Localization (i18n).** Widget strings ("Pay with wallet", "Amount due",
    status messages, countdown) are hard-coded English. Add a `strings` override
    map + ship locale packs so the checkout speaks the storefront's language.
18. **Accessibility pass.** Dialog ARIA roles, focus trap + restore, keyboard
    navigation, and contrast-checked default palettes — so the drop-in is
    WCAG-friendly out of the box.

### 5B — Drop-in embed (any stack, not only WooCommerce)

19. **One-tag auto-mount.** A CDN/`<script>` build that auto-mounts from
    `data-wdk-pay-*` attributes (`<div data-wdk-pay data-intent="…">`) with no JS
    wiring — the lowest-friction embed for static sites and page builders.
20. **Web Component `<wdk-pay>`.** Wrap `mountCheckout` as a custom element with
    Shadow-DOM style isolation, so the widget can't collide with host-page CSS and
    drops into React / Vue / Svelte / plain HTML identically.
21. **Publish + host the widget.** Publish `@wdk/checkout` to npm (ESM + IIFE
    builds) and pin a versioned CDN URL, so non-WooCommerce merchants embed
    without a build step. (WooCommerce keeps bundling the same package.)
22. **Presentation modes.** Optional launchable **modal/overlay** mode (button →
    dialog) and a mobile **bottom-sheet** layout, in addition to the current inline
    mount.
23. **Framework wrappers.** Thin `@wdk/checkout-react` (and Vue) wrappers around
    the Web Component for idiomatic embedding + typed props.

---

Part of the WDK reference suite — see the
[Browser Extension](https://github.com/plinkdev1/wdk-wallet-extension/blob/main/ROADMAP.md),
[Template Wallet](https://github.com/plinkdev1/wdk-wallet-template/blob/main/ROADMAP.md),
and [EIP-3009 module](https://github.com/plinkdev1/wdk-protocol-eip3009/blob/main/ROADMAP.md)
roadmaps.


## Customization & presentation follow-ups

> The first real customization seam (merchant colors in admin → `CheckoutTheme`)
> shipped here; the **full** white-label + drop-in direction (logo/header slot,
> web fonts, per-element edges, theme presets + light/dark, Web Component, CDN
> embed) is scoped as **[Phase 5](#-phase-5--white-label-widget--drop-in-embed)** above.

- ✅ **Merchant color settings in the WooCommerce admin** — done. The gateway admin
  now has a **Checkout appearance** section (native color pickers for accent /
  accent-text / surface / surface-text + a corner-style select). It resolves to a
  `CheckoutTheme` partial passed to the widget as `WDK_PAY.theme`, so merchants
  re-skin the checkout with no code. See `docs/MERCHANT_SETUP.md` / README
  "Customization".
- **Capture screenshots** of XAUt checkout + the x402 Worker flow, add to `media/screenshots/` + README.
