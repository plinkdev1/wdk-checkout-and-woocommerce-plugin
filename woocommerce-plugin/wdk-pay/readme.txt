=== WDK Pay — Self-Custodial USDt Checkout ===
Contributors: wdkpay
Tags: woocommerce, payment gateway, usdt, crypto, stablecoin, ethereum, polygon, arbitrum, web3, self-custodial
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 8.0
Stable tag: 1.0.0
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html
WC requires at least: 7.0
WC tested up to: 9.4

Accept self-custodial USDt payments at WooCommerce checkout, verified on-chain over JSON-RPC. Powered by Tether WDK.

== Description ==

WDK Pay adds a "Pay with USDt" gateway to WooCommerce. Customers pay USDt
directly to your own receiving address from a WDK-powered, self-custodial
wallet — funds never pass through a custodian or third-party processor.

After an order is placed, the customer is taken to the WooCommerce order-pay
page, which hosts a lightweight checkout widget. The widget initiates an on-chain
USDt transfer and submits the resulting transaction hash to the plugin's REST
API. The plugin then verifies the transfer on-chain (correct token, recipient,
amount, and confirmation depth) before marking the order as paid.

= Key features =

* Self-custodial: USDt is sent straight to the merchant's 0x address.
* On-chain verification via JSON-RPC (eth_getTransactionReceipt / eth_blockNumber).
* Multi-chain: Ethereum, Polygon, and Arbitrum One out of the box, with the
  canonical USDt contract baked in per chain (override-able).
* Configurable confirmation depth and payment window.
* Big-number-safe amount handling (bcmath with a pure-PHP fallback) — no float
  drift when converting order totals to USDt base units (6 decimals).
* Optional EIP-3009 gasless toggle surfaced to the checkout widget.
* HPOS (High-Performance Order Storage) compatible.

= Currency assumption =

This plugin assumes the order total maps 1:1 to USDt. A store total of 19.99 is
charged as 19.99 USDt (19,990,000 base units). Keep your store currency aligned
with USD/USDt so the on-chain amount matches the cart total. No FX conversion is
performed by the plugin.

== Installation ==

1. Upload the `wdk-pay` folder to `/wp-content/plugins/`, or install the plugin
   through the WordPress Plugins screen.
2. Activate the plugin. WooCommerce must be installed and active.
3. Go to WooCommerce → Settings → Payments → WDK Pay (USDt).
4. Enter your merchant receiving address (0x...), choose a settlement chain,
   and provide a JSON-RPC URL for on-chain verification.
5. Enable the gateway and save.

== Frequently Asked Questions ==

= Does the plugin hold my funds? =

No. USDt is transferred directly from the customer's wallet to your configured
receiving address. The plugin only observes the chain to confirm the payment.

= Which networks are supported? =

Ethereum (chain id 1), Polygon (137), and Arbitrum One (42161). The default USDt
contract for each chain is built in and can be overridden in settings.

= How are payments verified? =

The plugin fetches the transaction receipt over JSON-RPC, requires a successful
status, locates an ERC-20 Transfer log emitted by the configured USDt contract
to your receiving address for at least the order amount, and checks that enough
block confirmations have accrued.

= What happens if the customer pays manually or the page closes? =

The widget can poll GET /wdk-pay/v1/status/{orderKey}. As long as a valid
transaction hash is submitted to POST /wdk-pay/v1/confirm, the order will be
verified and completed.

== Changelog ==

= 1.0.0 =
* Initial release: USDt gateway, on-chain verifier, REST confirm/status
  endpoints, multi-chain support (Ethereum/Polygon/Arbitrum).

== Upgrade Notice ==

= 1.0.0 =
Initial release.
