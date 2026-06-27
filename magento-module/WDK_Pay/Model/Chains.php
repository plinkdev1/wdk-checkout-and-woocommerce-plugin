<?php
/**
 * Supported chains registry (canonical Tether deployments per chain).
 *
 * @package WDK\Pay
 */
declare(strict_types=1);

namespace WDK\Pay\Model;

/**
 * Static registry of the EVM chains supported for USDt settlement — the Magento
 * mirror of the WooCommerce plugin's chain registry, so both platforms resolve
 * the same token/decimals/explorer per chain.
 */
class Chains
{
    /**
     * @return array<string,array{key:string,name:string,chainId:int,token:string,explorer:string,assets:array<string,array{symbol:string,decimals:int,token:string}>}>
     */
    public static function all(): array
    {
        return [
            'ethereum' => [
                'key' => 'ethereum',
                'name' => 'Ethereum',
                'chainId' => 1,
                'token' => '0xdAC17F958D2ee523a2206206994597C13D831ec7',
                'explorer' => 'https://etherscan.io',
                'assets' => [
                    'usdt' => ['symbol' => 'USDt', 'decimals' => 6, 'token' => '0xdAC17F958D2ee523a2206206994597C13D831ec7'],
                    'xaut' => ['symbol' => 'XAUt', 'decimals' => 6, 'token' => '0x68749665FF8D2d112Fa859AA293F07A622782F38'],
                ],
            ],
            'polygon' => [
                'key' => 'polygon',
                'name' => 'Polygon',
                'chainId' => 137,
                'token' => '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
                'explorer' => 'https://polygonscan.com',
                'assets' => [
                    'usdt' => ['symbol' => 'USDt', 'decimals' => 6, 'token' => '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'],
                ],
            ],
            'arbitrum' => [
                'key' => 'arbitrum',
                'name' => 'Arbitrum One',
                'chainId' => 42161,
                'token' => '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
                'explorer' => 'https://arbiscan.io',
                'assets' => [
                    'usdt' => ['symbol' => 'USDt', 'decimals' => 6, 'token' => '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9'],
                ],
            ],
        ];
    }

    /**
     * @param string $key Chain key.
     * @return array<string,mixed>|null
     */
    public static function get(string $key): ?array
    {
        $all = self::all();
        $key = strtolower(trim($key));
        return $all[$key] ?? null;
    }

    /**
     * Resolve an asset on a chain, falling back to the chain's USDt.
     *
     * @return array{symbol:string,decimals:int,token:string}|null
     */
    public static function asset(string $chainKey, string $assetKey): ?array
    {
        $chain = self::get($chainKey);
        if ($chain === null) {
            return null;
        }
        $assetKey = strtolower(trim($assetKey)) ?: 'usdt';
        $assets = $chain['assets'] ?? [];
        if (isset($assets[$assetKey])) {
            return $assets[$assetKey];
        }
        return $assets['usdt'] ?? null;
    }

    public static function chainIdFor(string $key): int
    {
        $chain = self::get($key);
        return $chain ? (int) $chain['chainId'] : 0;
    }

    public static function tokenFor(string $key): string
    {
        $chain = self::get($key);
        return $chain ? (string) $chain['token'] : '';
    }

    public static function explorerTx(string $key, string $hash): string
    {
        $chain = self::get($key);
        if (!$chain || $hash === '') {
            return '';
        }
        return rtrim((string) $chain['explorer'], '/') . '/tx/' . $hash;
    }

    public static function isSupported(string $key): bool
    {
        return self::get($key) !== null;
    }
}
