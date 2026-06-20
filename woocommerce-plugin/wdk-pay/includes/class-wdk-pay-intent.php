<?php
/**
 * Payment intent builder.
 *
 * @package WDK_Pay
 */

// Guard against direct access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * WDK_Pay_Intent
 *
 * Builds the payment intent for a WooCommerce order: the structured data the
 * checkout widget needs to request and validate an on-chain USDt transfer.
 *
 * Currency assumption
 * -------------------
 * USDt has 6 decimals. This plugin assumes the order total (in the store
 * currency) maps 1:1 to USDt — i.e. a store priced in USD with a total of
 * 19.99 expects 19.99 USDt. Merchants who price directly in USDt should keep
 * their store currency aligned so the 1:1 mapping holds. No FX conversion is
 * performed here.
 *
 * Base-unit conversion
 * --------------------
 * The human amount is converted to integer base units (amount * 10^6) using
 * string math (bcmath when available, otherwise a decimal-shifting fallback)
 * so that no binary floating-point drift can corrupt the on-chain amount.
 *
 * @package WDK_Pay
 */
class WDK_Pay_Intent {

	/**
	 * Number of decimals for USDt.
	 *
	 * @var int
	 */
	const DECIMALS = 6;

	/**
	 * Token symbol used in the intent.
	 *
	 * @var string
	 */
	const TOKEN_SYMBOL = 'USDt';

	/**
	 * The WooCommerce order this intent describes.
	 *
	 * @var WC_Order
	 */
	private $order;

	/**
	 * Gateway settings relevant to intent construction.
	 *
	 * @var array<string,mixed>
	 */
	private $settings;

	/**
	 * Constructor.
	 *
	 * @param WC_Order            $order    The order being paid.
	 * @param array<string,mixed> $settings Resolved gateway settings. Expected keys:
	 *                                       chain, token_address, receiving_address,
	 *                                       payment_window.
	 */
	public function __construct( $order, array $settings ) {
		$this->order    = $order;
		$this->settings = $settings;
	}

	/**
	 * Build the intent array.
	 *
	 * @return array<string,mixed> The intent payload (see plugin docs for shape).
	 */
	public function to_array() {
		$chain_key = isset( $this->settings['chain'] ) ? (string) $this->settings['chain'] : 'ethereum';
		$chain     = WDK_Pay_Chains::get( $chain_key );

		if ( null === $chain ) {
			// Fall back to Ethereum if a stale/invalid chain is configured.
			$chain_key = 'ethereum';
			$chain     = WDK_Pay_Chains::get( $chain_key );
		}

		// Token address: explicit override wins, otherwise the chain default.
		$token_address = '';
		if ( ! empty( $this->settings['token_address'] ) ) {
			$token_address = (string) $this->settings['token_address'];
		} else {
			$token_address = $chain['token'];
		}

		$amount_human = $this->format_amount( (string) $this->order->get_total() );
		$amount_base  = self::to_base_units( (string) $this->order->get_total(), self::DECIMALS );

		$window_minutes = isset( $this->settings['payment_window'] ) ? (int) $this->settings['payment_window'] : 30;
		if ( $window_minutes <= 0 ) {
			$window_minutes = 30;
		}

		$status = $this->order->is_paid() ? 'confirmed' : 'pending';

		return array(
			'orderId'          => (int) $this->order->get_id(),
			'orderKey'         => (string) $this->order->get_order_key(),
			'amount'           => $amount_human,
			'amountBase'       => $amount_base,
			'decimals'         => self::DECIMALS,
			'tokenAddress'     => $token_address,
			'tokenSymbol'      => self::TOKEN_SYMBOL,
			'chainId'          => (int) $chain['chainId'],
			'chainName'        => (string) $chain['name'],
			'chainKey'         => (string) $chain['key'],
			'receivingAddress' => isset( $this->settings['receiving_address'] ) ? (string) $this->settings['receiving_address'] : '',
			'reference'        => self::reference_for( $this->order ),
			'status'           => $status,
			'expiresAt'        => $this->expires_at( $window_minutes ),
		);
	}

	/**
	 * Compute the intent expiry as a unix timestamp.
	 *
	 * Anchors on the order's creation time so that the widget and the merchant
	 * agree on a fixed window regardless of when the page is rendered.
	 *
	 * @param int $window_minutes Payment window length in minutes.
	 * @return int Unix seconds.
	 */
	private function expires_at( $window_minutes ) {
		$created = $this->order->get_date_created();
		$base_ts = $created ? $created->getTimestamp() : time();

		return (int) ( $base_ts + ( $window_minutes * MINUTE_IN_SECONDS ) );
	}

	/**
	 * Format a human-readable amount with the token's decimals, no thousands sep.
	 *
	 * @param string $amount Decimal amount string.
	 * @return string Normalised decimal string (e.g. "19.99").
	 */
	private function format_amount( $amount ) {
		$amount = self::sanitize_decimal( $amount );

		// number_format gives a stable, locale-independent representation.
		return number_format( (float) $amount, self::DECIMALS, '.', '' );
	}

	/**
	 * Build a deterministic bytes32 payment reference for an order.
	 *
	 * The reference is keccak-256-style unique per order key. We do not have a
	 * native keccak256 in PHP core, so we derive a stable 32-byte hex value from
	 * the order key via SHA-256. This is used only as an opaque correlation id;
	 * it is NOT used as a cryptographic on-chain commitment, so SHA-256 is a
	 * perfectly good unique reference here.
	 *
	 * @param WC_Order $order The order.
	 * @return string 0x-prefixed 32-byte hex string.
	 */
	public static function reference_for( $order ) {
		$key  = (string) $order->get_order_key();
		$hash = hash( 'sha256', 'wdk-pay:' . $key );

		return '0x' . $hash;
	}

	/**
	 * Sanitize a decimal string: keep digits, a single dot, and a leading sign.
	 *
	 * @param string $value Raw value.
	 * @return string Cleaned decimal string (defaults to "0").
	 */
	public static function sanitize_decimal( $value ) {
		$value = is_string( $value ) ? trim( $value ) : (string) $value;

		// Remove anything that is not a digit, dot, or leading minus.
		$value = preg_replace( '/[^0-9.\-]/', '', $value );

		if ( '' === $value || '.' === $value || '-' === $value ) {
			return '0';
		}

		// Collapse multiple dots — keep only the first.
		$parts = explode( '.', $value );
		if ( count( $parts ) > 2 ) {
			$value = $parts[0] . '.' . implode( '', array_slice( $parts, 1 ) );
		}

		return $value;
	}

	/**
	 * Convert a human decimal amount to integer base units as a string.
	 *
	 * Example: "19.99" with 6 decimals => "19990000".
	 *
	 * Uses bcmath when available for exactness. The fallback shifts the decimal
	 * point by string manipulation (right-pads / truncates the fractional part),
	 * which is exact for any precision and avoids float drift entirely.
	 *
	 * @param string $amount   Human decimal amount (e.g. "19.99").
	 * @param int    $decimals Token decimals (e.g. 6).
	 * @return string Integer base-unit amount as a decimal string (no sign, no leading zeros).
	 */
	public static function to_base_units( $amount, $decimals ) {
		$decimals = max( 0, (int) $decimals );
		$amount   = self::sanitize_decimal( $amount );

		// Negative amounts are meaningless for a charge; clamp to absolute value.
		$amount = ltrim( $amount, '-' );
		if ( '' === $amount ) {
			$amount = '0';
		}

		if ( function_exists( 'bcmul' ) ) {
			$factor = bcpow( '10', (string) $decimals, 0 );
			// Multiply at full precision then truncate to an integer (scale 0).
			$scaled = bcmul( $amount, $factor, $decimals + 1 );
			$result = self::bc_trim_to_int( $scaled );

			return self::strip_leading_zeros( $result );
		}

		return self::strip_leading_zeros( self::shift_decimal_string( $amount, $decimals ) );
	}

	/**
	 * bcmath fallback helper: truncate a bc decimal string to its integer part.
	 *
	 * @param string $value bc decimal string.
	 * @return string Integer portion (may be "0").
	 */
	private static function bc_trim_to_int( $value ) {
		$dot = strpos( $value, '.' );

		if ( false === $dot ) {
			return '' === $value ? '0' : $value;
		}

		$int = substr( $value, 0, $dot );

		return '' === $int ? '0' : $int;
	}

	/**
	 * Pure-string decimal shift (no bcmath): multiply a decimal by 10^decimals.
	 *
	 * Truncates any fractional digits beyond the requested precision (USDt does
	 * not support sub-unit dust). This is exact and integer-clean.
	 *
	 * @param string $amount   Sanitised decimal string (non-negative).
	 * @param int    $decimals Number of decimal places to shift.
	 * @return string Integer base-unit string.
	 */
	private static function shift_decimal_string( $amount, $decimals ) {
		$dot_pos = strpos( $amount, '.' );

		if ( false === $dot_pos ) {
			$int_part  = $amount;
			$frac_part = '';
		} else {
			$int_part  = substr( $amount, 0, $dot_pos );
			$frac_part = substr( $amount, $dot_pos + 1 );
		}

		if ( '' === $int_part ) {
			$int_part = '0';
		}

		// Right-pad or truncate the fractional part to exactly $decimals digits.
		if ( strlen( $frac_part ) < $decimals ) {
			$frac_part = str_pad( $frac_part, $decimals, '0', STR_PAD_RIGHT );
		} else {
			$frac_part = substr( $frac_part, 0, $decimals );
		}

		// Concatenate integer and (now exact-length) fractional digits.
		$combined = ( '0' === $int_part ? '' : $int_part ) . $frac_part;

		return '' === $combined ? '0' : $combined;
	}

	/**
	 * Strip leading zeros from an integer string while keeping at least one digit.
	 *
	 * @param string $value Integer string.
	 * @return string Normalised integer string.
	 */
	private static function strip_leading_zeros( $value ) {
		$value = ltrim( (string) $value, '0' );

		return '' === $value ? '0' : $value;
	}
}
