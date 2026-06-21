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
3. **Lightning (Spark) checkout** (`@tetherto/wdk-wallet-spark`) — instant,
   low-fee BTC payments are a natural fit for retail; invoice + settle flow.
4. **Bitcoin on-chain** — accept BTC via the engine's BIP-84 support.

5. ✅ **x402 — charge bots/agents/crawlers** — an HTTP 402 facilitator
   (`wdk-checkout/x402`) verifies EIP-3009 "exact"-scheme payments off-chain
   (no keys/RPC, edge-friendly), plus ready-to-deploy **Cloudflare Worker** and
   **Express** middleware that let humans + verified search engines through and
   paywall AI scrapers. Pairs with the WDK wallet's x402 payer client and
   `@tetherto/wdk-protocol-eip3009` for settlement.

## ⏳ Phase 3 — Merchant economics

5. **Fiat pricing display** (`@tetherto/wdk-pricing-*`) — show prices/totals in the
   store's fiat currency, lock a quote for the checkout window.
6. **Swap-to-settle** (`@tetherto/wdk-protocol-swap-velora-evm`) — accept any token,
   settle to the merchant in USDt automatically.
7. **Refunds & partial captures**; **subscriptions** (recurring EIP-3009 auths).

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
