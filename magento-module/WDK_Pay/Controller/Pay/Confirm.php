<?php
/**
 * Confirm controller — verify a submitted tx hash on-chain and invoice the order.
 *
 * @package WDK\Pay
 */
declare(strict_types=1);

namespace WDK\Pay\Controller\Pay;

use Magento\Framework\App\Action\HttpPostActionInterface;
use Magento\Framework\App\CsrfAwareActionInterface;
use Magento\Framework\App\Request\InvalidRequestException;
use Magento\Framework\App\RequestInterface;
use Magento\Framework\Controller\Result\JsonFactory;
use Magento\Framework\Controller\Result\Json;
use Magento\Sales\Model\OrderFactory;
use Magento\Sales\Model\Order;
use Magento\Sales\Model\Order\Invoice;
use Magento\Sales\Model\Service\InvoiceService;
use Magento\Framework\DB\TransactionFactory;
use WDK\Pay\Model\Settings;
use WDK\Pay\Model\Verifier;
use WDK\Pay\Model\Intent;
use WDK\Pay\Model\Chains;
use WDK\Pay\Model\PaymentMethod;

/**
 * Mirrors the WooCommerce REST confirm handler: capability auth (the order's
 * protect code), a STRICT chain check (the reported chainId must match the
 * configured chain — never verify on an unconfigured chain), on-chain verify,
 * then invoice on success.
 */
class Confirm implements HttpPostActionInterface, CsrfAwareActionInterface
{
    private RequestInterface $request;
    private JsonFactory $jsonFactory;
    private OrderFactory $orderFactory;
    private Settings $settings;
    private Verifier $verifier;
    private Intent $intentBuilder;
    private InvoiceService $invoiceService;
    private TransactionFactory $transactionFactory;

    public function __construct(
        RequestInterface $request,
        JsonFactory $jsonFactory,
        OrderFactory $orderFactory,
        Settings $settings,
        Verifier $verifier,
        Intent $intentBuilder,
        InvoiceService $invoiceService,
        TransactionFactory $transactionFactory
    ) {
        $this->request = $request;
        $this->jsonFactory = $jsonFactory;
        $this->orderFactory = $orderFactory;
        $this->settings = $settings;
        $this->verifier = $verifier;
        $this->intentBuilder = $intentBuilder;
        $this->invoiceService = $invoiceService;
        $this->transactionFactory = $transactionFactory;
    }

    public function createCsrfValidationException(RequestInterface $request): ?InvalidRequestException
    {
        return null;
    }

    public function validateForCsrf(RequestInterface $request): ?bool
    {
        // Auth is the per-order protect code (a bearer capability), not the form key.
        return true;
    }

    private function fail(Json $result, string $message): Json
    {
        return $result->setData(['status' => Verifier::FAILED, 'message' => $message]);
    }

    public function execute(): Json
    {
        $result = $this->jsonFactory->create();

        $raw = (string) $this->request->getContent();
        $payload = json_decode($raw, true);
        if (!is_array($payload)) {
            return $this->fail($result, 'Invalid request.');
        }

        $orderKey = isset($payload['orderKey']) ? (string) $payload['orderKey'] : '';
        $txHash = isset($payload['txHash']) ? strtolower(trim((string) $payload['txHash'])) : '';
        $reportedChainId = isset($payload['chainId']) ? (int) $payload['chainId'] : 0;

        if (!Verifier::isTxHash($txHash)) {
            return $this->fail($result, 'Invalid transaction hash.');
        }

        $order = $this->orderFactory->create()->loadByIncrementId($orderKey);
        if (!$order->getId()) {
            return $this->fail($result, 'Order not found.');
        }

        // Capability: the per-order protect code (sent as the widget nonce header).
        $nonce = (string) $this->request->getHeader('X-WP-Nonce');
        if ($nonce === '' || !hash_equals((string) $order->getProtectCode(), $nonce)) {
            return $this->fail($result, 'Not authorized for this order.');
        }

        if ($order->getPayment() === null || $order->getPayment()->getMethod() !== PaymentMethod::CODE) {
            return $this->fail($result, 'Order is not a WDK Pay order.');
        }
        if ($order->hasInvoices()) {
            return $result->setData(['status' => Verifier::CONFIRMED, 'orderId' => (int) $order->getId(), 'txHash' => $txHash]);
        }

        $settings = $this->settings->resolved();

        // STRICT chain check: the reported chainId must be the configured chain.
        $primaryChainId = Chains::chainIdFor($settings['chain']);
        if ($reportedChainId !== 0 && $reportedChainId !== $primaryChainId) {
            return $this->fail($result, 'This payment chain is not accepted by the store.');
        }

        $minAmountBase = Intent::toBaseUnits((string) $order->getGrandTotal(), (int) $settings['decimals']);

        $verdict = $this->verifier->verify(
            $settings['rpc_url'],
            $txHash,
            (string) $settings['token_address'],
            (string) $settings['receiving_address'],
            $minAmountBase,
            (int) $settings['confirmations']
        );

        if ($verdict['status'] === Verifier::CONFIRMED) {
            $this->invoiceOrder($order, $txHash, $settings);
            return $result->setData(['status' => Verifier::CONFIRMED, 'orderId' => (int) $order->getId(), 'txHash' => $txHash]);
        }

        if ($verdict['status'] === Verifier::PENDING) {
            $data = ['status' => Verifier::PENDING, 'orderId' => (int) $order->getId(), 'message' => $verdict['message']];
            if (isset($verdict['confirmations'])) {
                $data['confirmations'] = (int) $verdict['confirmations'];
            }
            return $result->setData($data);
        }

        $order->addCommentToStatusHistory(__('WDK Pay verification failed: %1', $verdict['message']));
        $order->save();
        return $this->fail($result, $verdict['message']);
    }

    /**
     * @param array<string,mixed> $settings
     */
    private function invoiceOrder(Order $order, string $txHash, array $settings): void
    {
        if (!$order->canInvoice()) {
            return;
        }
        $invoice = $this->invoiceService->prepareInvoice($order);
        $invoice->setRequestedCaptureCase(Invoice::CAPTURE_OFFLINE);
        $invoice->setTransactionId($txHash);
        $invoice->register();

        $explorer = Chains::explorerTx((string) $settings['chain'], $txHash);
        $order->addCommentToStatusHistory(
            __('USDt payment confirmed on-chain. Tx: %1 (%2)', $txHash, $explorer !== '' ? $explorer : __('no explorer'))
        );
        $order->setState(Order::STATE_PROCESSING)->setStatus(Order::STATE_PROCESSING);

        $transaction = $this->transactionFactory->create();
        $transaction->addObject($invoice)->addObject($order);
        $transaction->save();
    }
}
