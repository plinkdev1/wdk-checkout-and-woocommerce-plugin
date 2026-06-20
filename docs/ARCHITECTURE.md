# Architecture & Proposal (M1)

The **M1 deliverable**: platform-selection analysis, the architecture, and the integration plan for a self-custodial WDK checkout.

## 1. Platform selection: why WooCommerce

| Candidate | Verdict |
|---|---|
| **WooCommerce** | ✅ **Chosen.** Open-source, self-hostable, powers a very large share of independent online stores. First-class **payment-gateway plugin API** (`WC_Payment_Gateway`), REST framework, and order lifecycle. A merchant can install a `.zip` and configure it — no app-store gatekeeper. Maximum reach for a reference implementation. |
| Shopify | Closed platform; payments are constrained by Shopify Payments and an app-review process. Crypto checkouts are second-class. Higher friction to ship a true self-custodial flow. |
| Magento / Adobe Commerce | Powerful but heavyweight; small/medium merchants rarely run it. Lower leverage for a reference. |
| Custom headless | Maximum flexibility but no shared baseline — every merchant rebuilds. Our checkout SDK (`packages/wdk-checkout`) already serves this case for headless stores. |

**WooCommerce** gives the best ratio of reach, openness, and a clean extension model — and the headless **checkout SDK** we ship alongside covers custom/headless storefronts too.

## 2. The core principle: self-custodial

The defining requirement is *self-custodial*: **no intermediary ever holds the funds.**

```
 customer wallet  ──── direct ERC-20 USDt transfer ────►  merchant wallet
        (keys: customer)                                   (keys: merchant)
                              ▲
                              │  the store only OBSERVES this transfer
                       WooCommerce plugin
                  (verifies on-chain, confirms order)
```

- The payment is a plain on-chain USDt transfer from the customer's wallet to the **merchant's own address**. Funds are never escrowed, pooled, or routed through a processor.
- The store's only role after creating the order is to **watch the chain** and confirm the order once the transfer is verified. It holds no keys and no money.
- This is strictly stronger than a custodial gateway: there is no counterparty risk, no withdrawal step, and no third party that can freeze funds.

## 3. Components

### 3.1 WooCommerce gateway plugin (PHP) — `woocommerce-plugin/wdk-pay`

- **Gateway** (`WC_Payment_Gateway`): adds "Pay with USDt", admin settings (receiving address, chain, token address, RPC URL, confirmations, payment window). `process_payment` creates a pending order and redirects to the order-pay page.
- **Order-pay page**: renders `<div id="wdk-pay-root">` and loads the checkout widget, passing a **payment intent** via `wp_localize_script('…','WDK_PAY', …)`.
- **REST API** (`wdk-pay/v1`):
  - `POST /confirm { orderKey, txHash }` → verify on-chain → `payment_complete` → `{ status }`.
  - `GET /status/{orderKey}` → `{ status, txHash }` for polling.
- **Verifier**: validates the payment over JSON-RPC (see §5).

### 3.2 Checkout widget / SDK (TypeScript) — `packages/wdk-checkout`

- Framework-free, ~30 KB. Reads `window.WDK_PAY` and mounts into `#wdk-pay-root`.
- **Pay with wallet**: connects an EIP-1193 wallet (a WDK browser-extension wallet, or any EVM wallet), switches to the right chain, calls `USDt.transfer(merchant, amount)`, then reports the hash to `/confirm`.
- **Pay manually**: shows the address + QR, and accepts a pasted transaction hash to confirm — works for payments from any wallet, including mobile.
- Exposes a small SDK (`mountCheckout`, `payIntent`, `connectWallet`, …) for headless storefronts.

## 4. The payment intent

The contract between back-end and widget (`window.WDK_PAY`):

```jsonc
{
  "intent": {
    "orderId": 123, "orderKey": "wc_order_…",
    "amount": "19.99", "amountBase": "19990000", "decimals": 6,
    "tokenAddress": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    "tokenSymbol": "USDt",
    "chainId": 1, "chainName": "Ethereum", "chainKey": "ethereum",
    "receivingAddress": "0xMerchant…", "reference": "0x…32bytes",
    "status": "pending", "expiresAt": 1781990000
  },
  "endpoints": { "confirm": "…/wdk-pay/v1/confirm", "status": "…/status/wc_order_…" },
  "nonce": "…", "returnUrl": "…/order-received/…"
}
```

## 5. On-chain verification (the trust anchor)

The plugin confirms a payment by reading the chain over JSON-RPC — never by trusting the client:

1. `eth_getTransactionReceipt(txHash)` exists and `status == 0x1` (not reverted).
2. The receipt contains an ERC-20 **`Transfer`** log (`topic0 = 0xddf252ad…`) emitted by the **configured USDt token**, with indexed `to == merchant receiving address` and `value ≥ amount due`.
3. `eth_blockNumber − receipt.blockNumber + 1 ≥ required confirmations`.

Only then is the order completed. A forged/insufficient/wrong-recipient transaction fails verification. Amounts are compared with big-number-safe math (USDt values exceed 32-bit ints).

## 6. <a name="gasless"></a>Gasless payments (EIP-3009) — enhancement

For customers holding USDt but no native gas, the checkout can use **EIP-3009 `transferWithAuthorization`**:

1. The customer **signs** an authorization (off-chain, free) with their WDK wallet.
2. The store's relayer **submits** it on-chain and pays the gas, then verifies as in §5.

This path is implemented by the companion module **[`wdk-protocol-eip3009`](https://github.com/plinkdev1/wdk-protocol-eip3009)** (`signTransferAuthorization` on the client, `submitTransferAuthorization` / `buildTransferTransaction` on the relayer). It ties this bounty to the WDK Module bounty: one EIP-3009 module powers gasless commerce.

## 7. Milestones

- **M1 (this doc + scaffolding):** platform selection, architecture, integration plan, repo structure.
- **M2:** working checkout — gateway, order-pay widget, `transfer` signing, `/confirm` verification, order completion.
- **M3:** polish, merchant docs, demo video, PR.

## 8. Out of scope

Per the bounty: fiat on/off-ramps, custodial processing or escrow, advanced DeFi, a full merchant analytics backend, and compliance tooling. This is a self-custodial, observe-and-confirm checkout.
