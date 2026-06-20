<div align="center">

<img src="./brand/wdk-checkout-mark-256.png" alt="WDK Checkout" width="120" onerror="this.style.display='none'" />

# WDK Pay — Self-Custodial USDt Checkout for WooCommerce

**Accept USDt payments in WooCommerce, paid directly from a self-custodial [WDK](https://docs.wallet.tether.io) wallet — no custodian, no payment processor, no middleman.**

Reference implementation for the Tether WDK **WDK in Ecommerce** bounty.

[![License: MIT](https://img.shields.io/badge/License-MIT-F4642F.svg)](./LICENSE)
[![WooCommerce](https://img.shields.io/badge/WooCommerce-gateway-96588a.svg)](#the-woocommerce-plugin)
[![Self-custodial](https://img.shields.io/badge/payments-self--custodial-3fb950.svg)](#how-it-works)

</div>

---

## Why this exists

Merchants who want to accept stablecoins face a fragmented mess: custodial processors that hold their funds, closed gateways, and tooling that demands deep blockchain expertise. There has been **no reference implementation** showing how WDK can power a real ecommerce checkout.

This is that reference. It turns any WooCommerce store into a **self-custodial USDt checkout**: the customer pays from their own WDK-powered wallet, the funds land **directly in the merchant's wallet**, and the plugin **verifies the payment on-chain** before completing the order. No one ever custodies the money but the two parties to the trade.

## What's in the box

| Component | What it is |
|---|---|
| **`woocommerce-plugin/wdk-pay/`** | A complete WooCommerce **payment gateway plugin** (PHP): admin settings, the "Pay with USDt" gateway, REST endpoints, and on-chain payment verification. |
| **`packages/wdk-checkout/`** | A headless **checkout widget / SDK** (TypeScript): the customer-facing payment UI — connect a wallet and pay, or pay manually and confirm by transaction hash. Builds to a single asset the plugin loads. |
| **`docs/`** | Platform-selection rationale & architecture (the M1 deliverable), merchant setup, security model, and the demo script. |

## How it works

```
 Customer (self-custodial WDK wallet)            WooCommerce store
 ───────────────────────────────────             ─────────────────
        │  1. checkout → "Pay with USDt"                │
        │ ◄─────────────────────────────────────────────┤ 2. order created (pending)
        │                                                │    + payment intent
        │  3. wdk-checkout widget:                       │
        │     connect wallet · USDt.transfer(merchant)   │
        │ ───────── on-chain USDt transfer ──────────►   │  (funds go straight to merchant)
        │                                                │
        │  4. POST tx hash ─────────────────────────────►│ 5. verify on-chain (JSON-RPC):
        │                                                │    Transfer(to=merchant, value≥due)?
        │ ◄────────── 6. order complete ✓ ───────────────┤    confirmations ok?
```

The payment is a **direct, peer-to-peer ERC-20 transfer**. The plugin never touches the funds — it only *observes* the chain to confirm the order. That is what "self-custodial checkout" means.

### Optional: gasless payments (EIP-3009)

For customers with no native gas token, the checkout can use **EIP-3009 `transferWithAuthorization`**: the customer *signs* a transfer (free), and the merchant's relayer submits it and pays gas. That path is implemented by the companion module **[`wdk-protocol-eip3009`](https://github.com/plinkdev1/wdk-protocol-eip3009)** — see [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md#gasless).

## Supported networks & asset

USDt on **Ethereum**, **Polygon**, and **Arbitrum** out of the box (default token addresses bundled). Adding a chain is one entry in `WDK_Pay_Chains`.

## The WooCommerce plugin

```
woocommerce-plugin/wdk-pay/
├── wdk-pay.php                     # plugin bootstrap
├── includes/
│   ├── class-wdk-pay-gateway.php   # WC_Payment_Gateway: settings, process_payment, order-pay page
│   ├── class-wdk-pay-rest.php      # REST: POST /confirm, GET /status
│   ├── class-wdk-pay-verifier.php  # on-chain verification via JSON-RPC
│   ├── class-wdk-pay-chains.php    # chains + default USDt addresses
│   └── class-wdk-pay-intent.php    # builds the payment intent
└── assets/js/wdk-checkout.js       # the built checkout widget
```

Install it like any WooCommerce plugin and configure your receiving address, chain, and RPC URL. Full steps: [`docs/MERCHANT_SETUP.md`](./docs/MERCHANT_SETUP.md).

## The checkout widget

```bash
cd packages/wdk-checkout
npm install
npm run build          # builds dist/ (the SDK) and the plugin's wdk-checkout.js asset
```

The widget is framework-free, self-contained, and exposes a small SDK (`mountCheckout`, `payIntent`, …) so it can be embedded in any storefront, not just WooCommerce.

## Quickstart (local)

1. A WordPress + WooCommerce store (e.g. via `wp-env` or a local stack).
2. Copy `woocommerce-plugin/wdk-pay/` into `wp-content/plugins/` and activate it.
3. **WooCommerce → Settings → Payments → WDK Pay**: set receiving address, chain, and RPC URL.
4. Place a test order, choose **Pay with USDt**, and pay from a WDK wallet on a testnet.

## Documentation

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — **M1**: platform selection, architecture, integration plan.
- [`docs/MERCHANT_SETUP.md`](./docs/MERCHANT_SETUP.md) — install & configure, end to end.
- [`docs/SECURITY.md`](./docs/SECURITY.md) — the self-custodial trust & verification model.
- [`docs/DEMO.md`](./docs/DEMO.md) — demo-video walkthrough.

## License

[MIT](./LICENSE). Built with [Tether WDK](https://docs.wallet.tether.io). A community reference implementation submitted to the Tether WDK bounty program; not an official Tether product.
