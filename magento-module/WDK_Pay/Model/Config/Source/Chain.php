<?php
/**
 * Admin <select> source: supported settlement chains.
 *
 * @package WDK\Pay
 */
declare(strict_types=1);

namespace WDK\Pay\Model\Config\Source;

use Magento\Framework\Data\OptionSourceInterface;
use WDK\Pay\Model\Chains;

class Chain implements OptionSourceInterface
{
    /**
     * @return array<int,array{value:string,label:string}>
     */
    public function toOptionArray(): array
    {
        $options = [];
        foreach (Chains::all() as $key => $chain) {
            $options[] = ['value' => $key, 'label' => $chain['name']];
        }
        return $options;
    }
}
