<?php
/**
 * Pay page block — builds the window.WDK_PAY config for the checkout widget.
 *
 * @package WDK\Pay
 */
declare(strict_types=1);

namespace WDK\Pay\Block;

use Magento\Framework\View\Element\Template;
use Magento\Framework\View\Element\Template\Context;
use Magento\Checkout\Model\Session as CheckoutSession;
use Magento\Framework\Serialize\Serializer\Json;
use WDK\Pay\Model\Settings;
use WDK\Pay\Model\Intent;

class Pay extends Template
{
    private CheckoutSession $checkoutSession;
    private Settings $settings;
    private Intent $intent;
    private Json $json;

    public function __construct(
        Context $context,
        CheckoutSession $checkoutSession,
        Settings $settings,
        Intent $intent,
        Json $json,
        array $data = []
    ) {
        parent::__construct($context, $data);
        $this->checkoutSession = $checkoutSession;
        $this->settings = $settings;
        $this->intent = $intent;
        $this->json = $json;
    }

    /**
     * Build the widget config for the last placed order, or null when there is
     * no payable WDK Pay order in session.
     *
     * @return array<string,mixed>|null
     */
    public function getWidgetConfig(): ?array
    {
        $order = $this->checkoutSession->getLastRealOrder();
        if (!$order || !$order->getId() || $order->getPayment() === null) {
            return null;
        }
        if ($order->getPayment()->getMethod() !== \WDK\Pay\Model\PaymentMethod::CODE) {
            return null;
        }

        $resolved = $this->settings->resolved();
        if ($resolved['receiving_address'] === '' || $resolved['rpc_url'] === '') {
            return null;
        }

        return [
            'intent' => $this->intent->build($order, $resolved),
            'endpoints' => [
                'confirm' => $this->getUrl('wdkpay/pay/confirm'),
                'status' => $this->getUrl('wdkpay/pay/status', ['order' => $order->getIncrementId()]),
            ],
            'nonce' => (string) $order->getProtectCode(),
            'returnUrl' => $this->getUrl('checkout/onepage/success'),
            'options' => ['pollInterval' => 5000],
        ];
    }

    /** JSON for the inline <script> that hydrates the widget. */
    public function getWidgetConfigJson(): string
    {
        $config = $this->getWidgetConfig();
        return $config ? (string) $this->json->serialize($config) : '';
    }

    /** URL of the built widget bundle (served as module static or a CDN pin). */
    public function getWidgetBundleUrl(): string
    {
        return $this->getViewFileUrl('WDK_Pay::js/wdk-checkout.js');
    }
}
