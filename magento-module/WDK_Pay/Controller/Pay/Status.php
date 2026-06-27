<?php
/**
 * Status controller — report the order's payment status (polled by the widget).
 *
 * @package WDK\Pay
 */
declare(strict_types=1);

namespace WDK\Pay\Controller\Pay;

use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\App\RequestInterface;
use Magento\Framework\Controller\Result\JsonFactory;
use Magento\Framework\Controller\Result\Json;
use Magento\Sales\Model\OrderFactory;
use WDK\Pay\Model\Verifier;

class Status implements HttpGetActionInterface
{
    private RequestInterface $request;
    private JsonFactory $jsonFactory;
    private OrderFactory $orderFactory;

    public function __construct(
        RequestInterface $request,
        JsonFactory $jsonFactory,
        OrderFactory $orderFactory
    ) {
        $this->request = $request;
        $this->jsonFactory = $jsonFactory;
        $this->orderFactory = $orderFactory;
    }

    public function execute(): Json
    {
        $result = $this->jsonFactory->create();
        $orderKey = (string) $this->request->getParam('order');
        $order = $this->orderFactory->create()->loadByIncrementId($orderKey);

        if (!$order->getId()) {
            return $result->setData(['status' => 'unknown']);
        }
        $status = $order->hasInvoices() ? Verifier::CONFIRMED : Verifier::PENDING;
        return $result->setData(['status' => $status]);
    }
}
