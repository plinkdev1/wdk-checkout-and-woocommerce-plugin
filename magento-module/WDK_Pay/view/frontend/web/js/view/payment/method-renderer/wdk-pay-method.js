/**
 * WDK Pay — checkout payment method renderer.
 *
 * Places the order with the WDK Pay method, then sends the buyer to the hosted
 * pay page (wdkpay/pay/index) where the WDK Pay widget collects the USDt payment
 * and the server verifies it on-chain.
 */
define([
    'Magento_Checkout/js/view/payment/default'
], function (Component) {
    'use strict';

    return Component.extend({
        defaults: {
            template: 'WDK_Pay/payment/wdk-pay'
        },

        /** @return {String} */
        getCode: function () {
            return 'wdk_pay';
        },

        /** @return {Boolean} */
        isActive: function () {
            return true;
        },

        /** Redirect to the hosted pay page once the order is placed. */
        afterPlaceOrder: function () {
            var cfg = (window.checkoutConfig && window.checkoutConfig.payment && window.checkoutConfig.payment.wdk_pay) || {};
            window.location.replace(cfg.redirectUrl || '/wdkpay/pay/index');
        }
    });
});
