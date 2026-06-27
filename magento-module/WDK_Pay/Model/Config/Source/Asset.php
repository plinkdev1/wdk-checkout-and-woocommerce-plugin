<?php
/**
 * Admin <select> source: accepted Tether assets.
 *
 * @package WDK\Pay
 */
declare(strict_types=1);

namespace WDK\Pay\Model\Config\Source;

use Magento\Framework\Data\OptionSourceInterface;

class Asset implements OptionSourceInterface
{
    /**
     * @return array<int,array{value:string,label:string}>
     */
    public function toOptionArray(): array
    {
        return [
            ['value' => 'usdt', 'label' => 'USDt — Tether USD'],
            ['value' => 'xaut', 'label' => 'XAUt — Tether Gold'],
        ];
    }
}
