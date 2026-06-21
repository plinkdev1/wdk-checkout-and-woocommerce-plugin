# Demo Video Script (2–5 min)

Show a complete payment flow from cart to confirmation. Target ~3 minutes.

## Setup
- A WooCommerce store with the **WDK Pay** plugin installed and configured for a **testnet** (RPC + testnet USDt + your testnet receiving address).
- A WDK-powered (or any EVM) wallet with testnet USDt and a little gas.
- A product in the catalogue.

## Beats

**0:00 — Intro (20s)**
> "This is WDK Pay — a self-custodial USDt checkout for WooCommerce. The customer pays from their own wallet, the money goes straight to the merchant, and the store verifies it on-chain. No processor, no custodian."

**0:20 — Shop & checkout (30s)**
- Add a product to the cart → checkout.
- Choose **Pay with USDt (WDK Pay)** → Place order.
- Land on the payment page showing the amount in USDt, the chain, a countdown, and two tabs.

**0:50 — Pay with wallet (60s)**
- On **Pay with wallet**, click **Pay {amount} USDt**.
- The wallet pops up: show it switching to the right chain and the **USDt transfer** request. Approve it.
- The page moves through *submitted → verifying → confirmed ✓*.
- Say: *"That was a direct on-chain transfer to the merchant's address — I stayed in custody the whole time. The store is now reading the chain to verify it."*

**1:50 — Confirmation, both sides (40s)**
- The page redirects to **Order received**.
- Switch to **WooCommerce → Orders**: the order is **Processing/Complete**, with an **order note** showing the transaction hash and an explorer link.
- Click the explorer link → show the USDt `Transfer` to the merchant address on-chain.

**2:30 — Pay manually (20s)**
- Briefly show the **Pay manually** tab: the receiving address + QR, and the "paste your transaction hash" confirmation path (for mobile/any-wallet payments).

**2:50 — Multi-asset + agentic payments (25s)**
- In **WooCommerce → WDK Pay settings**, show the **Accepted asset** dropdown — **USDt or XAUt** (Tether Gold) — and the chain selector. *"Merchants settle in USDt or gold-backed XAUt; the widget verifies whichever asset on-chain."*
- One line on **x402**: *"The same on-chain verification powers an x402 facilitator and a Cloudflare Worker that charge AI bots and crawlers per request — humans and search engines pass for free, scrapers pay."* (Show `examples/cloudflare-x402-worker.js`.)

**3:15 — Architecture (15s)**
- Flash the diagram from the README.
- *"A WooCommerce gateway plus a headless, **themeable** WDK checkout widget, with on-chain verification. Gasless EIP-3009 payments via wdk-protocol-eip3009."*

**3:30 — Outro (10s)**
- *"Open source, MIT, documented for non-specialist merchants. Self-custodial commerce on WDK."* Show the GitHub URL.

## Verifying the new features

- **Multi-asset** — toggle USDt/XAUt in the gateway settings; the intent + verifier
  resolve the asset's token/decimals (all four PHP files pass `php -l`).
- **Themeable widget** — pass `theme` to `mountCheckout` (see README "Customization").
- **x402** — `cd packages/wdk-checkout && npm test` covers the facilitator
  (sign→verify + rejection paths); deploy `examples/cloudflare-x402-worker.js`
  with your `PAY_TO` + asset to charge bots live.

## Tips
- Use testnet throughout; never show a real seed.
- Pre-fund the wallet so the transfer confirms quickly on camera.
- Keep the WooCommerce admin in a second tab for the "merchant side" reveal.
