<?php
/**
 * On-chain payment verifier (JSON-RPC over HTTP).
 *
 * @package WDK\Pay
 */
declare(strict_types=1);

namespace WDK\Pay\Model;

use Magento\Framework\HTTP\Client\Curl;

/**
 * Verifies an ERC-20 (USDt) transfer on-chain — the Magento mirror of the
 * WooCommerce plugin's verifier and the `@wdk-starter/wdk-payment-verifier` JS module:
 *   1. eth_getTransactionReceipt status == 0x1.
 *   2. A Transfer log whose emitter is the token, indexed `to` is the merchant,
 *      and value >= the required base amount.
 *   3. Confirmations (head - receipt.block + 1) meet the threshold.
 */
class Verifier
{
    public const CONFIRMED = 'confirmed';
    public const PENDING = 'pending';
    public const FAILED = 'failed';

    /** keccak256("Transfer(address,address,uint256)"). */
    public const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

    private Curl $curl;

    public function __construct(Curl $curl)
    {
        $this->curl = $curl;
    }

    /**
     * @return array{status:string,message:string,confirmations?:int,valueBase?:string}
     */
    public function verify(string $rpcUrl, string $txHash, string $token, string $to, string $minAmountBase, int $requiredConfirms): array
    {
        if (!self::isTxHash($txHash)) {
            return ['status' => self::FAILED, 'message' => 'Malformed transaction hash.'];
        }
        if ($rpcUrl === '') {
            return ['status' => self::FAILED, 'message' => 'No RPC endpoint configured.'];
        }
        $requiredConfirms = max(1, $requiredConfirms);

        try {
            $receipt = $this->rpc($rpcUrl, 'eth_getTransactionReceipt', [$txHash]);
        } catch (\Throwable $e) {
            return ['status' => self::PENDING, 'message' => 'Unable to reach RPC node; will retry.'];
        }

        if (!is_array($receipt)) {
            return ['status' => self::PENDING, 'message' => 'Transaction not yet mined.'];
        }
        $status = isset($receipt['status']) ? strtolower((string) $receipt['status']) : '';
        if ($status !== '0x1') {
            return ['status' => self::FAILED, 'message' => 'Transaction reverted on-chain.'];
        }

        $logs = (isset($receipt['logs']) && is_array($receipt['logs'])) ? $receipt['logs'] : [];
        $transfer = $this->findMatchingTransfer($logs, $token, $to, $minAmountBase);
        if ($transfer === null) {
            return ['status' => self::FAILED, 'message' => 'No matching USDt transfer to the receiving address for the required amount.'];
        }

        if (!isset($receipt['blockNumber'])) {
            return ['status' => self::PENDING, 'message' => 'Receipt has no block number yet.'];
        }
        $receiptBlock = self::hexToInt((string) $receipt['blockNumber']);

        try {
            $head = self::hexToInt((string) $this->rpc($rpcUrl, 'eth_blockNumber', []));
        } catch (\Throwable $e) {
            return ['status' => self::PENDING, 'message' => 'Unable to read chain head; will retry.'];
        }

        $confirmations = ($head - $receiptBlock) + 1;
        if ($confirmations < $requiredConfirms) {
            return ['status' => self::PENDING, 'message' => 'Awaiting additional confirmations.', 'confirmations' => max(0, $confirmations), 'valueBase' => $transfer['value']];
        }
        return ['status' => self::CONFIRMED, 'message' => 'Payment confirmed on-chain.', 'confirmations' => $confirmations, 'valueBase' => $transfer['value']];
    }

    /**
     * @param array<int,mixed> $logs
     * @return array{value:string}|null
     */
    private function findMatchingTransfer(array $logs, string $token, string $to, string $minAmountBase): ?array
    {
        $tokenNorm = self::normalizeAddress($token);
        $toNorm = self::normalizeAddress($to);
        if ($tokenNorm === '' || $toNorm === '') {
            return null;
        }

        foreach ($logs as $log) {
            if (!is_array($log)) {
                continue;
            }
            $topics = (isset($log['topics']) && is_array($log['topics'])) ? $log['topics'] : [];
            if (count($topics) < 3) {
                continue;
            }
            if (strtolower((string) $topics[0]) !== self::TRANSFER_TOPIC) {
                continue;
            }
            $emitter = self::normalizeAddress(isset($log['address']) ? (string) $log['address'] : '');
            if ($emitter === '' || $emitter !== $tokenNorm) {
                continue;
            }
            $logTo = self::topicToAddress((string) $topics[2]);
            if ($logTo === '' || $logTo !== $toNorm) {
                continue;
            }
            $value = self::hexToDecimalString(isset($log['data']) ? (string) $log['data'] : '0x0');
            if (self::compareAmounts($value, $minAmountBase) >= 0) {
                return ['value' => $value];
            }
        }
        return null;
    }

    /**
     * @param array<int,mixed> $params
     * @return mixed
     * @throws \RuntimeException
     */
    private function rpc(string $rpcUrl, string $method, array $params)
    {
        $body = json_encode(['jsonrpc' => '2.0', 'id' => 1, 'method' => $method, 'params' => $params]);
        $this->curl->addHeader('Content-Type', 'application/json');
        $this->curl->setTimeout(20);
        $this->curl->post($rpcUrl, (string) $body);

        $code = (int) $this->curl->getStatus();
        if ($code < 200 || $code >= 300) {
            throw new \RuntimeException('RPC HTTP ' . $code);
        }
        $decoded = json_decode((string) $this->curl->getBody(), true);
        if (!is_array($decoded)) {
            throw new \RuntimeException('Malformed JSON-RPC response.');
        }
        if (isset($decoded['error'])) {
            throw new \RuntimeException('JSON-RPC error.');
        }
        return $decoded['result'] ?? null;
    }

    /* ----------------------------- pure helpers ----------------------------- */

    public static function isTxHash(string $hash): bool
    {
        return (bool) preg_match('/^0x[0-9a-fA-F]{64}$/', $hash);
    }

    public static function normalizeAddress(string $address): string
    {
        $address = trim($address);
        if (!preg_match('/^0x[0-9a-fA-F]{40}$/', $address)) {
            return '';
        }
        return strtolower($address);
    }

    public static function topicToAddress(string $topic): string
    {
        $topic = strtolower(trim($topic));
        if (str_starts_with($topic, '0x')) {
            $topic = substr($topic, 2);
        }
        if (strlen($topic) < 40 || !ctype_xdigit($topic)) {
            return '';
        }
        return '0x' . substr($topic, -40);
    }

    public static function hexToInt(string $hex): int
    {
        $hex = trim($hex);
        if (str_starts_with($hex, '0x')) {
            $hex = substr($hex, 2);
        }
        if ($hex === '' || !ctype_xdigit($hex)) {
            return 0;
        }
        return (int) hexdec($hex);
    }

    public static function hexToDecimalString(string $hex): string
    {
        $hex = strtolower(trim($hex));
        if (str_starts_with($hex, '0x')) {
            $hex = substr($hex, 2);
        }
        $hex = ltrim($hex, '0');
        if ($hex === '' || !ctype_xdigit($hex)) {
            return '0';
        }
        if (function_exists('bcadd')) {
            $dec = '0';
            $len = strlen($hex);
            for ($i = 0; $i < $len; $i++) {
                $dec = bcadd(bcmul($dec, '16'), (string) hexdec($hex[$i]));
            }
            return $dec;
        }
        // Native fallback (sufficient for amounts within PHP int range).
        return (string) hexdec($hex);
    }

    public static function compareAmounts(string $a, string $b): int
    {
        $a = ltrim(preg_replace('/[^0-9]/', '', $a) ?? '', '0');
        $b = ltrim(preg_replace('/[^0-9]/', '', $b) ?? '', '0');
        $a = $a === '' ? '0' : $a;
        $b = $b === '' ? '0' : $b;
        if (function_exists('bccomp')) {
            return (int) bccomp($a, $b, 0);
        }
        if (strlen($a) !== strlen($b)) {
            return strlen($a) < strlen($b) ? -1 : 1;
        }
        return $a <=> $b;
    }
}
