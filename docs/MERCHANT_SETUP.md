# Merchant Setup

A step-by-step guide for a non-blockchain-specialist merchant. ~10 minutes.

## 1. Requirements

- A WordPress site with **WooCommerce** active.
- A wallet **address you control** to receive payments (your "receiving address"). USDt sent by customers goes here directly.
- An **RPC URL** for the chain you accept (free tiers from Alchemy, Infura, or a public endpoint work). This is how the plugin reads the chain to verify payments.

## 2. Install the plugin

**Option A — copy:** copy the `woocommerce-plugin/wdk-pay/` folder into your site's `wp-content/plugins/` directory.

**Option B — zip:** zip the `wdk-pay` folder and upload it via **Plugins → Add New → Upload Plugin**.

Then **activate** "WDK Pay — Self-Custodial USDt Checkout".

> The plugin already includes the built checkout widget (`assets/js/wdk-checkout.js`). To rebuild it from source: `cd packages/wdk-checkout && npm install && npm run build`.

## 3. Configure

Go to **WooCommerce → Settings → Payments → WDK Pay → Manage**:

| Setting | What to enter |
|---|---|
| **Enable** | On |
| **Title / Description** | What customers see at checkout (e.g. "Pay with USDt") |
| **Receiving address** | Your `0x…` wallet address — payments arrive here |
| **Chain** | Ethereum / Polygon / Arbitrum |
| **USDt token address** | Leave blank to use the chain's default USDt, or override |
| **RPC URL** | Your chain RPC endpoint (used to verify payments) |
| **Required confirmations** | `1` for fast chains; raise for higher-value orders |
| **Payment window (min)** | How long a customer has to pay (default 30) |

Save. WDK Pay now appears as a checkout option.

## 4. Pricing in USDt

By default the plugin treats the order total as the USDt amount **1:1** (i.e. price your products in a USDt-pegged currency, or set your store currency so totals equal the USDt you expect). For stores priced in another currency, convert to USDt before this gateway (a currency-switcher or fixed USDt pricing).

## 5. Test it (testnet first)

1. Set the **Chain** to a testnet RPC and a testnet USDt address.
2. Place a test order → choose **Pay with USDt**.
3. On the payment page, **Pay with wallet** (connect a WDK wallet / any EVM wallet on the testnet) or **Pay manually** and paste the tx hash.
4. The page shows *verifying → confirmed*, the order moves to **Processing/Complete**, and an order note records the transaction hash + explorer link.

## 6. Going live

- Switch the RPC + token to mainnet and set your real receiving address.
- Consider raising **Required confirmations** for large orders.
- Use a dedicated receiving address (not an exchange deposit address — those don't credit arbitrary ERC-20 sends reliably).

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| WDK Pay not shown at checkout | Ensure it's enabled and the receiving address + RPC are set (`is_available()` requires them). |
| "Could not verify transaction" | Check the RPC URL works, the customer paid the **right token** to the **right address** for the **full amount**, and enough confirmations have passed. |
| Order stuck pending | The customer hasn't paid yet, or confirmations are still accruing — the widget keeps polling. |
| Widget shows "ethers must load" | Ensure outbound access to the ethers CDN, or self-host it; the plugin enqueues it as a dependency. |
