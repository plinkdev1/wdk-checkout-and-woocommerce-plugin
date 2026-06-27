<?php
/**
 * Checkout config provider — exposes the WDK Pay method to the JS checkout.
 *
 * @package WDK\Pay
 */
declare(strict_types=1);

namespace WDK\Pay\Model\Ui;

use Magento\Checkout\Model\ConfigProviderInterface;
use Magento\Framework\App\Config\ScopeConfigInterface;
use Magento\Framework\UrlInterface;
use Magento\Store\Model\ScopeInterface;
use WDK\Pay\Model\PaymentMethod;

class ConfigProvider implements ConfigProviderInterface
{
    private ScopeConfigInterface $scopeConfig;
    private UrlInterface $url;

    public function __construct(ScopeConfigInterface $scopeConfig, UrlInterface $url)
    {
        $this->scopeConfig = $scopeConfig;
        $this->url = $url;
    }

    /**
     * @return array<string,mixed>
     */
    public function getConfig(): array
    {
        $title = $this->scopeConfig->getValue(
            'payment/' . PaymentMethod::CODE . '/title',
            ScopeInterface::SCOPE_STORE
        );

        return [
            'payment' => [
                PaymentMethod::CODE => [
                    'title' => $title ?: 'Pay with USDt',
                    // After placing the order the buyer is sent to the hosted pay
                    // page that mounts the WDK Pay widget.
                    'redirectUrl' => $this->url->getUrl('wdkpay/pay/index'),
                ],
            ],
        ];
    }
}
