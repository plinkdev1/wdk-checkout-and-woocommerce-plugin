# WDK Pay — Shopify app

Accept **self-custodial USDt** on Shopify, powered by the same framework-free
[`@wdk-starter/wdk-checkout`](../packages/wdk-checkout) core that backs the
WooCommerce gateway. Funds settle straight to your receiving address; Shopify
only learns the payment outcome.

## How it works

Shopify's **Payments Apps** model lets an app provide a payment method. The flow:

1. At checkout the buyer picks **Pay with USDt**. Shopify POSTs a **payment
   session** to this app (`POST /payment_sessions`, HMAC-signed).
2. The app mints a payment **intent** and returns a redirect to its hosted
   checkout page (`GET /checkout?session=ID`).
3. The page mounts the real **WDK Pay widget** (`mountCheckout`) — the buyer pays
   USDt from their own EVM wallet (or pays manually + confirms by tx hash).
4. The widget POSTs the tx hash to `POST /confirm`; the app **verifies the
   transfer on-chain** with the published
   [`@wdk-starter/wdk-payment-verifier`](../packages/wdk-payment-verifier)
   (`PaymentVerifier.verify` — the headless counterpart to the WooCommerce PHP
   verifier) and calls `paymentSessionResolve` (or `paymentSessionReject`) through
   the Payments Apps API.
5. The buyer returns to Shopify's order-status page.

The reported `chainId` is checked against the configured chain — the app never
verifies against an unconfigured RPC (the chainId is attacker-controlled).

## Configure

Set these in the environment (nothing secret is hard-coded):

| Variable | Purpose |
|---|---|
| `SHOPIFY_SHOP` | `my-store.myshopify.com` |
| `SHOPIFY_API_SECRET` | App secret — verifies the HMAC on Shopify's POSTs |
| `SHOPIFY_ACCESS_TOKEN` | Payments Apps API token (resolve/reject sessions) |
| `APP_URL` | Public base URL of this app |
| `WDK_RPC_URL` | JSON-RPC endpoint used for on-chain verification |
| `WDK_RECEIVING` | Your `0x…` receiving address |
| `WDK_TOKEN` | Token contract (default USDt on Ethereum) |
| `WDK_CHAIN_ID` / `WDK_CHAIN_NAME` / `WDK_CHAIN_KEY` | Chain (default Ethereum) |
| `WDK_CONFIRMATIONS` | Confirmations required (default 1) |

## Run

```bash
pnpm install            # links the workspace @wdk-starter/wdk-checkout
pnpm --filter wdk-pay-shopify-app start
# or, from this folder:
node server.mjs
```

Then register this app's `/payment_sessions` URL as the payment session URL of
your Shopify Payments App (Partner dashboard). The widget bundle is served from
`/wdk-checkout.js` (built by `pnpm --filter @wdk-starter/wdk-checkout build`).

> Reference implementation: session state is in-memory for clarity — back it with
> a database in production, and host behind HTTPS.
