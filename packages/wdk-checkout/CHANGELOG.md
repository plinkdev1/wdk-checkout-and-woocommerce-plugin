# Changelog

All notable changes to `@wdk-starter/wdk-checkout` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Package is now published under the `@wdk-starter` scope as
  `@wdk-starter/wdk-checkout` (all subpaths follow: `@wdk-starter/wdk-checkout/x402`,
  `/pricing`, `/swap`, `/subscriptions`, `/lightning`).

### Fixed

- Widget hardening:
  - **Expiry lockout** — once the payment window passes `expiresAt`, the
    countdown stops and the pay/confirm buttons are disabled, but only while the
    widget is `idle` or `failed`; a payment already in flight or confirmed is
    never interrupted.
  - **Redirect-timer cleanup** — the post-confirmation redirect timer is tracked
    and cleared by the `mountCheckout` teardown function, so unmounting the
    widget can no longer trigger a stray navigation.

## [1.0.0] - 2026-06-22

Initial release of the headless, framework-free WDK checkout SDK —
self-custodial USDt payments for ecommerce. Powers the WooCommerce **WDK Pay**
gateway and works standalone in any storefront. The customer pays directly from
their own wallet to the merchant; the SDK never custodies funds.

### Added

- **`mountCheckout(root, config)`** — headless checkout widget that renders the
  full payment flow into any element and returns a teardown function. Two ways
  to pay:
  - **Pay with wallet** — connect an injected EVM wallet and send the USDt
    `transfer` directly (`payIntent`).
  - **Pay manually** — show the receiving address as a QR + copyable string,
    then confirm by pasting the transaction hash; the widget polls the
    merchant's `confirm`/`status` endpoints until the payment is confirmed or
    failed.
- **Themeable `CheckoutTheme`** — the full palette (surface, accent, text,
  borders, status colors, radius, font) is injected as CSS variables, so a
  merchant can re-skin the entire widget by passing a partial `theme`.
  `DEFAULT_CHECKOUT_THEME` is the WDK default (warm dark surface + orange
  accent).
- **Core SDK exports** — `payIntent`, `connectWallet`, `ensureChain`,
  `ERC20_ABI`, `qrDataUrl`, `getEthers`, `getInjectedProvider`, `toHexChainId`,
  and the `PaymentIntent` / `WdkPayConfig` / `EthereumProvider` /
  `PaymentStatus` / `CheckoutTheme` types.
- **Pre-built widget asset** — `build.mjs` bundles the auto-mount entry to a
  single IIFE (`woocommerce-plugin/wdk-pay/assets/js/wdk-checkout.js`) that the
  WooCommerce plugin loads; `ethers` is resolved from the page global, never
  bundled.

#### Ecommerce-rail subpath modules

Optional, config-driven modules that import on demand (they do not bloat the
widget bundle). All money math is exact (BigInt / string base units).

- **`@wdk-starter/wdk-checkout/x402`** — x402 facilitator for HTTP "402 Payment
  Required". `buildPaymentRequirements` / `buildPaymentRequiredResponse` (the
  402 challenge), `decodePaymentHeader`, `verifyExactPayment` (recovers the
  EIP-3009 signer off-chain — no keys, no RPC, edge-safe), and
  `settleExactPayment` (submits `transferWithAuthorization` on-chain via a
  relayer so the payer pays gaslessly).
- **`@wdk-starter/wdk-checkout/pricing`** — fiat display + exact base-unit
  conversion. `formatFiat`, `formatTokenAmount`, `fiatToTokenBase`,
  `quoteTokenBase`, `fiatDisplayLine`, and a pluggable `RateSource`
  (`staticRate` for 1:1 stores, `endpointRate` to wire any JSON rate feed).
- **`@wdk-starter/wdk-checkout/swap`** — swap-to-settle plan math. Exact-output
  swap so the merchant receives the exact order amount in USDt;
  `quoteAndPlanSwapToSettle` / `planSwapToSettle` compute the slippage-capped
  input, min-receive, and deadline from a pluggable `SwapQuoteProvider`.
- **`@wdk-starter/wdk-checkout/subscriptions`** — recurring payments as a
  schedule of per-period EIP-3009 authorizations. `buildSubscriptionSchedule`,
  `subscriptionDomain`, `chargeTypedData`, `verifyChargeSignature`,
  `chargeDueAt`, `isChargeClaimable` — each period is a time-boxed,
  single-use charge that settles through the same path as x402.
- **`@wdk-starter/wdk-checkout/lightning`** — BOLT11 invoice + poll-to-settlement
  over a pluggable `LightningProvider`. `createLightningClient` (generic REST:
  Spark / LNbits / LND-REST), `satsForFiat`, `btcToSats`, `formatSats`, and
  `pollInvoice`.

### Security

- Self-custodial by design: funds always move directly from the customer to the
  merchant; the SDK never holds keys or custodies funds.
- Untrusted strings are HTML-escaped before entering the widget's `innerHTML`
  (XSS guard).
- Manual confirmation validates the transaction-hash format (`0x` + 64 hex)
  before posting.

[Unreleased]: https://github.com/plinkdev1/wdk-checkout-and-woocommerce-plugin/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/plinkdev1/wdk-checkout-and-woocommerce-plugin/releases/tag/v1.0.0
