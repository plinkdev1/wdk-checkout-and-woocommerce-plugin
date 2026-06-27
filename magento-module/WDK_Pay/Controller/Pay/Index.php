<?php
/**
 * Pay page controller — renders the WDK Pay widget for the placed order.
 *
 * @package WDK\Pay
 */
declare(strict_types=1);

namespace WDK\Pay\Controller\Pay;

use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\View\Result\PageFactory;
use Magento\Framework\View\Result\Page;

class Index implements HttpGetActionInterface
{
    private PageFactory $pageFactory;

    public function __construct(PageFactory $pageFactory)
    {
        $this->pageFactory = $pageFactory;
    }

    public function execute(): Page
    {
        $page = $this->pageFactory->create();
        $page->getConfig()->getTitle()->set(__('Pay with USDt'));
        return $page;
    }
}
