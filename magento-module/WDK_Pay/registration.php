<?php
/**
 * WDK Pay — Magento 2 module registration.
 *
 * @package WDK\Pay
 */

use Magento\Framework\Component\ComponentRegistrar;

ComponentRegistrar::register(
    ComponentRegistrar::MODULE,
    'WDK_Pay',
    __DIR__
);
