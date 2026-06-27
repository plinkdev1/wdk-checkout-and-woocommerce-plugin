<?php
/**
 * WDK Pay payment-method identity.
 *
 * @package WDK\Pay
 */
declare(strict_types=1);

namespace WDK\Pay\Model;

/**
 * Holds the payment method code shared by the Adapter facade (di.xml), the
 * config provider, and the controllers.
 */
class PaymentMethod
{
    /** Payment method code. */
    public const CODE = 'wdk_pay';
}
