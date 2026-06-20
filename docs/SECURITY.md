# Security & Trust Model

A crypto checkout's job is to confirm "did the customer really pay me?" without trusting the customer's browser, and without ever holding the money. Here is exactly how this integration does that.

## The custody model: there is no custodian

Funds move **directly from the customer's wallet to the merchant's wallet** as an on-chain USDt transfer. The store, the plugin, and any server in between:

- **never hold a private key,**
- **never custody, escrow, or route the funds,**
- only **read** the chain to confirm a payment happened.

This eliminates the largest risk class of traditional crypto gateways (a custodian that can be hacked, frozen, or rugged). The worst case for the store is a *failed verification* (order not completed) — never lost customer funds.

## What is trusted, and what is verified

| Input | Trusted? | How it's protected |
|---|---|---|
| The order amount / receiving address | Server-authoritative | Built server-side into the payment intent from gateway settings; the client cannot change them. |
| The transaction hash the client reports | **Not trusted** | The server independently reads the chain and checks the transfer's token, recipient, amount, and confirmations. A lie fails verification. |
| The order identity | Capability-based | The WooCommerce `orderKey` is an unguessable per-order token; `/confirm` and `/status` resolve the order from it. |

## On-chain verification (`WDK_Pay_Verifier`)

A payment is only accepted when **all** of these hold, read live over JSON-RPC:

1. The transaction receipt exists and `status == 0x1` (it didn't revert).
2. The receipt contains an ERC-20 `Transfer` event **emitted by the configured USDt token contract** (not an arbitrary token).
3. That transfer's indexed **`to` equals the merchant receiving address**.
4. Its **value is ≥ the amount due** (big-number-safe comparison).
5. It has at least the **required confirmations**.

Anything less → `pending` (keep waiting) or `failed` (rejected). The client cannot shortcut this.

## Web / WordPress hardening

- **Inputs sanitized, outputs escaped.** All REST inputs are sanitized and validated (tx hash matches `0x[0-9a-fA-F]{64}`); all rendered values are escaped.
- **Nonce-protected REST.** Confirmation requests carry the WordPress REST nonce (`X-WP-Nonce`); the order key is required and validated.
- **Idempotent confirmation.** A completed order short-circuits; replays don't double-process.
- **No secrets in the client.** Only public data (amount, address, RPC URL, nonce) reaches the browser. The RPC URL is read-only.
- **Direct-access guards.** Every PHP file aborts if accessed outside WordPress (`ABSPATH`).

## Operational recommendations

- Use a **dedicated receiving address** you control (not an exchange deposit address, which may not credit arbitrary ERC-20 sends).
- Raise **required confirmations** for higher-value orders.
- Use a **reliable RPC** (a keyed provider) so verification isn't rate-limited.
- For amounts above your risk tolerance, reconcile against your wallet/explorer before fulfilling.

## Disclosure

This is reference software. Review and test on a testnet before taking real payments, and have it audited before high-volume production use. Report vulnerabilities privately to the repository owner rather than opening a public issue.
