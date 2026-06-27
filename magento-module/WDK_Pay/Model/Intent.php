<?php
/**
 * Payment intent builder — the structured data the checkout widget consumes.
 *
 * @package WDK\Pay
 */
declare(strict_types=1);

namespace WDK\Pay\Model;

use Magento\Sales\Api\Data\OrderInterface;

/**
 * Builds the widget's payment intent for a Magento order, with exact base-unit
 * conversion (bcmath when available; a decimal-shift fallback otherwise), so the
 * on-chain amount never drifts. USDt is assumed 1:1 with the order total.
 */
class Intent
{
    /**
     * @param array<string,mixed> $settings Resolved gateway settings.
     * @return array<string,mixed>
     */
    public function build(OrderInterface $order, array $settings): array
    {
        $chainKey = (string) ($settings['chain'] ?? 'ethereum');
        $chain = Chains::get($chainKey) ?? Chains::get('ethereum');
        $decimals = (int) ($settings['decimals'] ?? 6);
        $symbol = (string) ($settings['token_symbol'] ?? 'USDt');

        $total = (string) $order->getGrandTotal();
        $amountHuman = number_format((float) $total, $decimals, '.', '');
        $amountBase = self::toBaseUnits($total, $decimals);
        $windowMinutes = (int) ($settings['payment_window'] ?? 30) ?: 30;

        $orderKey = (string) $order->getIncrementId();

        return [
            'orderId' => (int) $order->getEntityId(),
            'orderKey' => $orderKey,
            'amount' => $amountHuman,
            'amountBase' => $amountBase,
            'decimals' => $decimals,
            'tokenAddress' => (string) ($settings['token_address'] ?? $chain['token']),
            'tokenSymbol' => $symbol,
            'chainId' => (int) $chain['chainId'],
            'chainName' => (string) $chain['name'],
            'chainKey' => (string) $chain['key'],
            'receivingAddress' => (string) ($settings['receiving_address'] ?? ''),
            'reference' => '0x' . hash('sha256', 'wdk-pay:' . $orderKey),
            'status' => 'pending',
            'expiresAt' => time() + ($windowMinutes * 60),
            'displayTotal' => number_format((float) $total, 2, '.', ''),
            'currency' => (string) $order->getOrderCurrencyCode(),
        ];
    }

    /**
     * Convert a human decimal amount to integer base units as a string.
     */
    public static function toBaseUnits(string $amount, int $decimals): string
    {
        $decimals = max(0, $decimals);
        $amount = preg_replace('/[^0-9.]/', '', $amount) ?? '0';
        if ($amount === '' || $amount === '.') {
            $amount = '0';
        }
        if (function_exists('bcmul')) {
            $scaled = bcmul($amount, bcpow('10', (string) $decimals, 0), $decimals + 1);
            $dot = strpos($scaled, '.');
            $int = $dot === false ? $scaled : substr($scaled, 0, $dot);
            $int = ltrim($int, '0');
            return $int === '' ? '0' : $int;
        }
        // bcmath-free fallback: shift the decimal point by string manipulation.
        $parts = explode('.', $amount);
        $intPart = $parts[0] === '' ? '0' : $parts[0];
        $fracPart = $parts[1] ?? '';
        $fracPart = strlen($fracPart) < $decimals
            ? str_pad($fracPart, $decimals, '0')
            : substr($fracPart, 0, $decimals);
        $combined = ltrim(($intPart === '0' ? '' : $intPart) . $fracPart, '0');
        return $combined === '' ? '0' : $combined;
    }
}
