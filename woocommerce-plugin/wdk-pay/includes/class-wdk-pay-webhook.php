<?php
/**
 * Payment-status webhooks (Phase 4 item 10).
 *
 * @package WDK_Pay
 */

// Guard against direct access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * WDK_Pay_Webhook
 *
 * Fires a signed POST to the merchant's configured webhook URL when an order's
 * payment state changes (confirmed / failed). The body is signed with
 * HMAC-SHA256 over the exact bytes sent; the receiver verifies the raw body
 * against the `X-WDK-Signature: sha256=<hex>` header (parity with the JS
 * `verifyWebhook` in `@wdk-starter/wdk-checkout`). Store-wide config lives on the
 * USDt gateway settings, so both the on-chain and Lightning paths share it.
 *
 * Non-blocking — a slow/failing endpoint never holds up order completion.
 *
 * @package WDK_Pay
 */
class WDK_Pay_Webhook {

	/** Header carrying the signature (matches the JS WEBHOOK_SIGNATURE_HEADER). */
	const SIGNATURE_HEADER = 'X-WDK-Signature';

	/**
	 * Fire a payment webhook for an order.
	 *
	 * @param WC_Order            $order The order.
	 * @param string              $type  Event type ('payment.confirmed' | 'payment.failed' | 'payment.pending').
	 * @param array<string,mixed> $extra Extra event fields (txHash, chainId, …).
	 * @return void
	 */
	public static function fire( $order, $type, array $extra = array() ) {
		if ( ! $order instanceof WC_Order ) {
			return;
		}
		$cfg = self::config();
		if ( '' === $cfg['url'] || '' === $cfg['secret'] ) {
			return;
		}

		$event = array_merge(
			array(
				'type'      => (string) $type,
				'orderId'   => (int) $order->get_id(),
				'orderKey'  => (string) $order->get_order_key(),
				'status'    => (string) ( isset( $extra['status'] ) ? $extra['status'] : $type ),
				'amount'    => (string) $order->get_total(),
				'currency'  => (string) $order->get_currency(),
				'timestamp' => time(),
			),
			$extra
		);
		// Drop empty optional fields for a tidy body.
		$event = array_filter(
			$event,
			static function ( $v ) {
				return null !== $v && '' !== $v;
			}
		);

		$body      = wp_json_encode( $event );
		$signature = 'sha256=' . hash_hmac( 'sha256', $body, $cfg['secret'] );

		wp_remote_post(
			$cfg['url'],
			array(
				'method'   => 'POST',
				'headers'  => array(
					'Content-Type'         => 'application/json',
					self::SIGNATURE_HEADER => $signature,
				),
				'body'     => $body,
				'timeout'  => 10,
				'blocking' => false,
			)
		);
	}

	/**
	 * Read the store-wide webhook config from the USDt gateway settings.
	 *
	 * @return array{url:string,secret:string}
	 */
	private static function config() {
		$settings = get_option( 'woocommerce_wdk_pay_settings', array() );
		if ( ! is_array( $settings ) ) {
			$settings = array();
		}
		return array(
			'url'    => esc_url_raw( trim( (string) ( isset( $settings['webhook_url'] ) ? $settings['webhook_url'] : '' ) ) ),
			'secret' => (string) ( isset( $settings['webhook_secret'] ) ? $settings['webhook_secret'] : '' ),
		);
	}
}
