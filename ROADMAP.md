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
   (invoice + settle rail). A new `wdk-checkout/lightning` module handles the
   merchant side: mint a BOLT11 invoice for the order, then poll to settlement.
   Backends are pluggable via a `LightningProvider`; `createLightningClient`
   wires a generic REST endpoint (injectable fetch, tolerant parsers for
   Spark/LNbits/LND-REST) and `pollInvoice` drives it to a paid/expired terminal
   state. Sats helpers (`satsForFiat`, `btcToSats`, `formatSats`) price the
   order. The customer pays from any Lightning wallet (incl. a WDK Spark wallet);
   no node URL/key is hard-coded.
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

---

Part of the WDK reference suite — see the
[Browser Extension](https://github.com/plinkdev1/wdk-wallet-extension/blob/main/ROADMAP.md),
[Template Wallet](https://github.com/plinkdev1/wdk-wallet-template/blob/main/ROADMAP.md),
and [EIP-3009 module](https://github.com/plinkdev1/wdk-protocol-eip3009/blob/main/ROADMAP.md)
roadmaps.


## Customization & presentation follow-ups

- ✅ **Merchant color settings in the WooCommerce admin** — done. The gateway admin
  now has a **Checkout appearance** section (native color pickers for accent /
  accent-text / surface / surface-text + a corner-style select). It resolves to a
  `CheckoutTheme` partial passed to the widget as `WDK_PAY.theme`, so merchants
  re-skin the checkout with no code. See `docs/MERCHANT_SETUP.md` / README
  "Customization".
- **Capture screenshots** of XAUt checkout + the x402 Worker flow, add to `media/screenshots/` + README.
