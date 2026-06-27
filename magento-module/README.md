# WDK Pay — Magento 2 module

Accept **self-custodial USDt** on Magento 2, verified on-chain — the same
architecture as the [WooCommerce gateway](../woocommerce-plugin), powered by the
framework-free [`@wdk-starter/wdk-checkout`](../packages/wdk-checkout) widget.
Funds settle straight to your receiving address; the store never custodies them.

## Flow

1. The buyer selects **Pay with USDt** at checkout and places the order
   (`pending_payment`).
2. The method renderer sends them to the module's hosted **pay page**
   (`wdkpay/pay/index`), which mounts the real WDK Pay widget for the order's
   intent.
3. The buyer pays USDt from their own EVM wallet (or pays manually + confirms by
   tx hash). The widget POSTs the hash to `wdkpay/pay/confirm`.
4. `Confirm` authenticates with the order's protect code, checks the reported
   `chainId` **strictly** against the configured chain (an unconfigured chain is
   rejected — never verified against an unknown RPC), verifies the on-chain
   `Transfer` (`Model\Verifier`, same rules as the WooCommerce and JS verifiers),
   and **invoices** the order on success.

## Install

```bash
# Copy into the Magento app tree:
cp -r magento-module/WDK_Pay <magento-root>/app/code/WDK/Pay

cd <magento-root>
bin/magento module:enable WDK_Pay
bin/magento setup:upgrade
bin/magento setup:di:compile
bin/magento setup:static-content:deploy
bin/magento cache:flush
```

The checkout widget bundle ships at
`view/frontend/web/js/wdk-checkout.js` (built by
`pnpm --filter @wdk-starter/wdk-checkout build`).

## Configure

**Stores → Configuration → Sales → Payment Methods → WDK Pay (USDt)**:

- **Enabled**, **Title**
- **Merchant receiving address** — your `0x…` address (required)
- **Settlement chain** — Ethereum / Polygon / Arbitrum
- **Accepted asset** — USDt or XAUt (Tether Gold)
- **Token address (override)** — optional
- **RPC URL** — JSON-RPC endpoint for on-chain verification (required)
- **Required confirmations**, **Payment window (minutes)**

## Layout

```
WDK_Pay/
  registration.php  composer.json
  etc/            module.xml, config.xml, payment.xml, di.xml,
                  adminhtml/system.xml, frontend/{routes,di}.xml
  Model/          PaymentMethod, Chains, Settings, Intent, Verifier,
                  Config/Source/{Chain,Asset}, Ui/ConfigProvider
  Block/          Pay (builds the widget config)
  Controller/Pay/ Index (pay page), Confirm (verify + invoice), Status
  view/frontend/  layout + the method renderer, template, and widget bundle
```

All PHP passes `php -l`; the on-chain verifier mirrors the WooCommerce plugin and
the `@wdk-starter/wdk-payment-verifier` JS module rule-for-rule.
