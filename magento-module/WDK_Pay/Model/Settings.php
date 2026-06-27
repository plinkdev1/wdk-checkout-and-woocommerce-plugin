<?php
/**
 * Resolved gateway settings (reads admin config; centralises defaulting).
 *
 * @package WDK\Pay
 */
declare(strict_types=1);

namespace WDK\Pay\Model;

use Magento\Framework\App\Config\ScopeConfigInterface;
use Magento\Store\Model\ScopeInterface;

/**
 * Reads the WDK Pay admin settings and resolves the effective token / decimals,
 * mirroring the WooCommerce plugin's get_resolved_settings() so the intent and
 * verifier agree.
 */
class Settings
{
    private ScopeConfigInterface $config;

    public function __construct(ScopeConfigInterface $config)
    {
        $this->config = $config;
    }

    private function get(string $field, ?string $default = null): string
    {
        $value = $this->config->getValue(
            'payment/' . PaymentMethod::CODE . '/' . $field,
            ScopeInterface::SCOPE_STORE
        );
        return $value === null ? (string) $default : trim((string) $value);
    }

    /**
     * @return array{receiving_address:string,chain:string,asset:string,token_address:string,rpc_url:string,confirmations:int,payment_window:int,decimals:int,token_symbol:string}
     */
    public function resolved(): array
    {
        $chain = $this->get('chain', 'ethereum');
        if (!Chains::isSupported($chain)) {
            $chain = 'ethereum';
        }
        $assetKey = $this->get('asset', 'usdt') ?: 'usdt';
        $asset = Chains::asset($chain, $assetKey);
        $decimals = ($asset && isset($asset['decimals'])) ? (int) $asset['decimals'] : 6;
        $symbol = ($asset && isset($asset['symbol'])) ? (string) $asset['symbol'] : 'USDt';

        $override = $this->get('token_address', '');
        if ($override !== '') {
            $token = $override;
        } elseif ($asset && !empty($asset['token'])) {
            $token = (string) $asset['token'];
        } else {
            $token = Chains::tokenFor($chain);
        }

        return [
            'receiving_address' => $this->get('receiving_address', ''),
            'chain' => $chain,
            'asset' => $assetKey,
            'token_address' => $token,
            'rpc_url' => $this->get('rpc_url', ''),
            'confirmations' => max(1, (int) $this->get('confirmations', '1')),
            'payment_window' => max(1, (int) $this->get('payment_window', '30')),
            'decimals' => $decimals,
            'token_symbol' => $symbol,
        ];
    }
}
