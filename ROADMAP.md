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
2. ✅ **Multi-chain auto-detect** — the shopper pays on whichever supported EVM
   chain their wallet is already on; the gateway verifies on **that** chain. The
   merchant lists extra chains as an **Additional chains** JSON map (`chainId →
   { rpcUrl, tokenAddress }`) in the gateway settings; the intent advertises them
   to the widget as `acceptedChains`. The widget's pure `resolvePayChain` stays on
   the wallet's current chain when it's accepted (no forced network switch),
   sending that chain's token and returning the `chainId` it settled on. The
   confirm POST carries that `chainId`, and the REST handler resolves the
   (rpcUrl, token, decimals) **strictly** from the configured set — the reported
   chainId is attacker-controlled, so an unconfigured chain is rejected outright
   (never verified against a default/unknown RPC). The settling chain is recorded
   on the order so refunds and webhooks target the right network. Verified by unit
   tests (`resolvePayChain`) and `php -l`.
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
4. ✅ **Bitcoin on-chain** — accept native BTC (BIP-84 / bech32), done end-to-end
   (rail **and** a live WooCommerce gateway).
   - ✅ **Rail** — the `wdk-checkout/bitcoin` module: build a BIP-21 request
     (address + sats + URI), then watch the address to settlement. Address
     derivation is pluggable via a `BitcoinAddressSource` (`staticAddressSource`,
     or `accountAddressSource` to derive a fresh BIP-84 address per order from a
     WDK `@tetherto/wdk-wallet-btc` account — the package imports no SDK); chain
     watching is pluggable via a `BitcoinWatcher`, with `createEsploraWatcher`
     wiring any Esplora/mempool.space REST API (injectable fetch, tolerant
     parsers). The pure `evaluateAddressTxs` picks the most-confirmed qualifying
     tx and `watchAddress` drives it to a paid/expired terminal state. Sats math
     is shared with the Lightning rail via `wdk-checkout/sats`. No node URL is
     hard-coded; nothing custodies funds. Unit-tested (BIP-21, evaluation, Esplora
     client, polling).
   - ✅ **WooCommerce gateway** — a `WDK_Pay_Bitcoin_Gateway` (id `wdk_pay_bitcoin`)
     the merchant selects at checkout. It prices the total in sats, resolves a
     receiving address (a fresh per-order BIP-84 address via the
     `wdk_pay_bitcoin_order_address` filter is recommended; a static address is the
     fallback), renders a BIP-21 QR + address, and polls
     `GET /wdk-pay/v1/bitcoin/status/{orderKey}`; the server verifies on-chain via
     an Esplora API (PHP mirror `class-wdk-pay-bitcoin-watcher.php` of the JS rail)
     and calls `payment_complete()` once a confirmed payment of ≥ the order amount
     lands. The customer pays from any Bitcoin wallet. `php -l` clean.
   - Follow-up: a live BTC price feed (the gateway uses a configured rate today),
     and HD-xpub address derivation inside the plugin (today via the filter seam).

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
7. ✅ **Refunds & partial captures** — the gateway declares `refunds` support and
   `process_refund` (full or partial) records the refund — the exact USD₮ transfer
   back to the original payer — adds an order note, and fires a `payment.refunded`
   webhook so the merchant's wallet/relayer settles it (self-custodial). A JS
   `wdk-checkout/refunds` module (`buildRefund` + `refundTransferCalldata`,
   unit-tested) produces the descriptor + ERC-20 calldata. Also: ✅ **subscriptions**
   (recurring EIP-3009 auths) —
   done. A new `wdk-checkout/subscriptions` module models a subscription as a
   schedule of per-period EIP-3009 authorizations: each charge has its own
   time-boxed `validAfter`..`validBefore` window and a unique deterministic nonce,
   so a period can only be claimed during that period and exactly once. The
   customer signs each charge's typed data; the merchant relayer settles the due
   charge through the **same** `transferWithAuthorization` path as x402
   (`settleExactPayment`). Self-custodial — nothing auto-charges without a
   customer signature. (Refunds/partial-captures still open.)

## ⏳ Phase 4 — Platform breadth

8. ✅ **Generic REST/webhook core** (so the same engine backs any storefront) —
   the `@wdk-starter/wdk-checkout` package is framework-free by design: intents,
   pricing, on-ramp, signed webhooks, refunds, Lightning, the `<wdk-pay>` Web
   Component + one-tag auto-mount. `examples/merchant-server.mjs` is a
   dependency-free Node server (GET `/intent`, POST `/webhook` with signature
   verification) proving a non-WooCommerce backend wires up the same way.
   - ✅ **Shopify app** (`shopify-app/`) — the core wired into Shopify's **Payments
     Apps** flow: a Node server takes a signed payment session, hosts the WDK Pay
     widget, verifies the transfer on-chain with the published
     `@wdk-starter/wdk-payment-verifier` (rejecting any unconfigured chainId),
     then `paymentSessionResolve` /
     `paymentSessionReject` through the Payments Apps API. Funds settle straight to
     the merchant; Shopify only learns the outcome. Tested (HMAC auth + the API
     client with a mocked fetch).
   - ✅ **Magento extension** (`magento-module/WDK_Pay/`) — a Magento 2 payment
     module on the same core: a checkout method that places the order, sends the
     buyer to a hosted pay page mounting the WDK Pay widget, and a `Confirm`
     controller that authenticates with the order's protect code, checks the
     reported `chainId` strictly against the configured chain, verifies the
     on-chain `Transfer` (`Model\Verifier`, rule-for-rule with the WooCommerce +
     `@wdk-starter/wdk-payment-verifier` verifiers), and invoices the order. Admin settings,
     chain registry, and base-unit math mirror the WooCommerce plugin. All PHP
     passes `php -l`; all XML is well-formed.
9. ✅ **Fiat on-ramp at checkout** (`@tetherto/wdk-protocol-fiat-moonpay`) — a
   pluggable `wdk-checkout/onramp` module (`buildOnrampUrl`, unit-tested) builds a
   buy-crypto URL (MoonPay default, any provider via `baseUrl`, server-signing seam
   via `signUrl`); the widget shows a **"Buy with card ↗"** link under the pay
   button, pre-filled with the order amount, when `WdkPayConfig.onramp` is set. The
   WooCommerce gateway exposes a MoonPay-key field that turns it on. So a shopper
   without crypto can fund and pay in one flow.
10. ✅ **Payment-status webhooks** — a signed POST fires to the merchant's webhook
    URL when an order is paid or fails (both on-chain **and** Lightning). The JS
    `wdk-checkout/webhooks` module (`buildWebhookEvent` / `signWebhook` /
    `verifyWebhook`, HMAC-SHA256 via Web Crypto, unit-tested) is the receiver/parity
    half; the plugin fires server-side (`class-wdk-pay-webhook.php`, `hash_hmac`,
    non-blocking) with an `X-WDK-Signature: sha256=…` header, configured by a
    webhook URL + secret in the admin. *(Follow-up: a hosted reconciliation dashboard.)*

## ⏳ Phase 5 — White-label widget & drop-in embed

WDK Pay already ships as a **framework-free, ~30 KB embeddable widget**
(`mountCheckout(root, config)`) — not only a WooCommerce plugin. The WooCommerce
gateway is one *consumer* of that widget; the same asset drops into any page, SPA,
or platform. Phase 5 makes the widget **fully white-label** (match any brand with
no code) and **truly drop-in** (one tag, any stack), bringing it to the same
theming standard we set on the WDK wallet template + extension.

### 5A — Full white-label customization (parity with the WDK wallets)

11. ✅ **Brand block — logo + top-center header slot.** The widget renders a
    `brand` header (logo + store name) above the "Amount due" card from
    `WdkPayConfig.brand` (`name` / `logoUrl` / `logoAlt`). The WooCommerce
    **Checkout appearance** admin now surfaces it: a **brand name** field and a
    **brand logo** media-picker (`wdk_media` field type → `wp.media` library with a
    live preview), mapped to `WDK_PAY.brand` — a merchant brands the checkout with
    zero code. *(Follow-up: optional subtitle / logo-height controls.)*
12. ✅ **Typography — real font control.** `CheckoutTheme.fontUrl` loads the brand
    web-font (a Google Fonts `css2` href or any `@font-face` CSS), injected as a
    scoped `<link rel="stylesheet">`, so `fontFamily` actually *renders* instead of
    only requesting an installed font. A separate `headingFontFamily` (brand name +
    amount) is also supported. *(Follow-up: a numeric weight/size scale token.)*
13. ✅ **Shape & edges — per-element radii + button styles.** `CheckoutTheme` gained
    `cardRadius` / `buttonRadius` / `inputRadius` (each falls back to the global
    `radius`, so button edges are independently square / rounded / pill) plus a
    `buttonStyle` token (`solid` / `outline` / `soft`). The widget emits them as
    `--wp-card-radius` / `--wp-button-radius` / `--wp-input-radius` +
    `--wp-button-{bg,fg,border}` and the card/inputs/buttons consume them (no more
    hard-coded corners). *(Follow-up: optional gradient accent.)*
14. ✅ **Theme presets + light/dark mode.** Four named presets — `wdk` (default),
    `dark` (warm dark), `cool-dark`, `institutional-light` — selectable by one key
    (`preset`), plus a `mode: 'light' | 'dark' | 'auto'` dimension where `auto`
    follows `prefers-color-scheme`. `resolveCheckoutTheme()` (exported, unit-tested)
    picks the base then layers the `theme` partial. The preset names are the
    **shared contract** with the wallet UI. *(Follow-up: surface the picker in the
    WooCommerce admin — see #16 live preview.)*
15. ✅ **Custom-CSS escape hatch + class hooks.** Every element carries a stable
    `data-wdk` hook (`root`, `brand`, `amount-card`, `tab-wallet`/`tab-manual`,
    `panel-wallet`/`panel-manual`, `pay-button`, `confirm-button`, `hash-input`,
    `status`, `countdown`, `footer`), and `WdkPayConfig.customCss` injects raw CSS
    as a `<style>` scoped under the root (torn down with the widget) — pixel control
    beyond the token set, e.g. `[data-wdk="pay-button"]{letter-spacing:.04em}`.
16. ✅ **Live preview in admin.** The gateway settings screen renders the real
    widget against a sample intent and **re-skins it live** as the merchant edits
    the appearance fields (accent / text / surface colors, corner style, brand name
    + logo) — debounced re-mount, no save needed to see it. The IIFE now exposes a
    `window.WdkCheckout` API (`mountCheckout`, `openCheckoutModal`,
    `resolveCheckoutTheme`, …) that the admin preview (and any embedder) drives.
17. ✅ **Localization (i18n).** Every user-facing widget string (tabs, pay/confirm
    buttons, manual-entry labels, status messages, countdown, footer) now routes
    through a `CheckoutStrings` contract. Pass `strings` (a partial or a full locale
    pack) on `WdkPayConfig`; `resolveCheckoutStrings()` (exported, unit-tested)
    layers it over the English defaults. No more hard-coded copy.
18. ✅ **Accessibility pass.** The inline widget is now ARIA-correct: a
    `tablist` / `tab` / `tabpanel` structure with `aria-selected` + `aria-hidden`
    toggled on switch, a `role="status"` `aria-live="polite"` status region (screen
    readers announce flow changes), an `aria-label` on the hash input, and explicit
    `type="button"` on every control (no accidental form submits). *(Focus trap +
    restore land with the launchable modal/overlay mode — #22.)*

### 5B — Drop-in embed (any stack, not only WooCommerce)

19. ✅ **One-tag auto-mount.** The IIFE build auto-mounts into **any** element
    flagged `data-wdk-pay`, reading config with no JS wiring: inline `data-config`
    JSON, a `data-config-var` named page global, or the default `window.WDK_PAY`
    (the WooCommerce path). Idempotent per element (`data-wdk-mounted`); the pure
    `resolveAutoConfig` precedence is unit-tested.
20. ✅ **Web Component `<wdk-pay>`.** `mountCheckout` wrapped as a custom element
    (`WdkPayElement` + `defineWdkPayElement`) that renders into a **Shadow root**, so
    host-page CSS can't collide with the widget (or vice versa), and it drops into
    React / Vue / Svelte / plain HTML identically. Config comes from a `config` JS
    property or the same `data-*` rules as the auto-mount; torn down on disconnect.
    The IIFE registers `<wdk-pay>` automatically.
21. ✅ **Publish + host the widget.** `@wdk-starter/wdk-checkout` is published on
    npm (currently `1.1.0`; ESM + IIFE builds) alongside
    `@wdk-starter/wdk-payment-verifier`, via a wired CI auto-publish pipeline — so
    non-WooCommerce merchants embed without a build step, and WooCommerce keeps
    bundling the same package. *(The new `./bitcoin` + `./sats` subpaths and the
    Shopify/Magento integrations ride the next version bump, which CI publishes on
    release; pinning a versioned CDN URL is the remaining hosting nicety.)*
22. ✅ **Presentation modes.** `openCheckoutModal(config, { layout })` launches the
    checkout as a centered **modal/overlay** or a mobile **bottom-sheet**, and
    `attachCheckoutModal(trigger, config)` wires a button → dialog. The overlay is a
    focus-trapped `role="dialog"` (Tab cycles within, Escape / backdrop / close
    button dismiss, focus restores to the launcher) — this also lands the focus-trap
    deferred from #18. The inline mount stays the default.
23. ✅ **Framework wrappers.** Idiomatic **React** embedding ships via the
    `@wdk-starter/wdk-checkout/react` subpath — `<WdkCheckout config>` +
    `useWdkPayment(config)` (typed props + headless state machine). **Vue / Svelte /
    plain HTML** embed idiomatically through the `<wdk-pay>` Web Component (#20), which
    those frameworks consume natively. *(Follow-up: publish standalone framework
    packages once #21 lands.)*

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
- ✅ **Imagery refreshed** — live captures of the widget rendering the **real Tether ₮**
  (`checkout-usdt.png`) and the **gold Tether Gold ₮** for **XAUt** (`checkout-xaut.png`),
  a faithful preview of the new **Bitcoin on-chain** checkout (`checkout-bitcoin.png`,
  BIP-21 QR), and the embedded **real token marks** (`token-marks.png`: USD₮ / Tether
  Gold / BTC / ETH) — all referenced from the README. *(Still to capture: the x402
  Worker flow — a code/sequence path rather than a widget screen.)*
