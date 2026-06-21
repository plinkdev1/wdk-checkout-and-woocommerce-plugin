# PRD scope notes

The M1 proposal enumerated several capabilities. Most shipped; a few were
**deliberately scoped** for good engineering reasons rather than omitted by
accident. This page is the honest record of those decisions for reviewers.

## Shipped (highlights)

- WooCommerce **WDK Pay** gateway: admin settings (incl. merchant color theming),
  REST confirm/status, on-chain verification.
- Headless, themeable **`wdk-checkout`** widget (extension + injected wallets).
- **`wdk-payment-verifier`** — the standalone server-side verifier the PRD asked
  for (Node/headless counterpart to the PHP verifier): `verify(intent, txHash)` /
  `watch(intent)` with N confirmations, pluggable RPC.
- Multi-asset (USDt/XAUt) + multi-chain (Ethereum/Polygon/Arbitrum), gasless
  EIP-3009, the **x402** facilitator + Cloudflare/Express examples, and the four
  ecommerce-rail modules (pricing/swap/subscriptions/lightning).

## Deliberately scoped

### Embedded wallet mode → not shipped as in-checkout seed entry (by design)

The PRD listed an "embedded" mode where the customer enters a mnemonic/password
**on the merchant's checkout page**. We deliberately do **not** ship that: typing
a recovery phrase into a third-party (merchant) origin is a security anti-pattern
for a *reference standard* — it trains users to do the exact thing phishing
relies on, and puts the seed inside the merchant's DOM/XSS surface.

Instead the widget connects to wallets the customer already controls — the **WDK
browser extension** (recommended) or any injected EIP-1193 wallet — so keys never
touch the merchant page. Advanced integrators who want an in-page worklet wallet
can compose one directly from `@wdk-starter/wdk-web-core` (the same engine the
template uses); we don't make it the default checkout path. This is a
security-credibility decision, not a capability gap.

### Solana SPL USDt → v1.1

The self-custodial verification path and the gasless path (EIP-3009
`transferWithAuthorization`) are **EVM** mechanisms. Solana USDt is an SPL
transfer with a different confirmation/signature model and no EIP-3009 analogue,
so it's a separate integration (it also depends on the engine's SPL-balance work,
tracked as backlog **B-1**). The M1 proposal scoped Solana as optional; it remains
a clean v1.1 addition (a Solana branch in the verifier + a Solana payment path in
the widget), not a blocker for the EVM-first deliverable.

### Headless Next.js demo store → pattern, not a bundled app

The PRD mentioned a headless Next.js demo. The **integration pattern** is
demonstrated by [`examples/checkout-demo.html`](../examples/checkout-demo.html),
which mounts the *real* widget against a sample intent, and the pieces a headless
store composes now all exist: the `wdk-checkout` widget (frontend) +
`wdk-payment-verifier` (backend confirmation) + the REST contract. Because the
widget and verifier are framework-free, the same pattern drops into Next.js,
Commerce.js, Saleor, or Medusa unchanged — so a full bundled Next.js storefront
is optional scaffolding rather than a distinct capability. See
[`docs/ECOMMERCE_RAILS.md`](./ECOMMERCE_RAILS.md) for wiring.
