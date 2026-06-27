<?php
/**
 * Bitcoin REST controller.
 *
 * @package WDK_Pay
 */

// Guard against direct access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * WDK_Pay_Bitcoin_REST
 *
 * One endpoint, polled by the order-pay page:
 *
 *   GET /wdk-pay/v1/bitcoin/status/{orderKey}
 *     — read the watched address's status from the merchant's Esplora backend
 *       (server-side) and, when a confirmed payment of at least the order amount
 *       lands, call payment_complete() exactly once.
 *
 * The order key is a high-entropy per-order secret WooCommerce already uses to
 * gate the order-pay page, so it authorises this read the same way the on-chain
 * USDt `/status` and Lightning `/lightning/status` endpoints do.
 *
 * @package WDK_Pay
 */
class WDK_Pay_Bitcoin_REST {

	const NAMESPACE = 'wdk-pay/v1';

	/** Order meta: the receiving address watched for this order. */
	const META_ADDRESS = '_wdk_pay_btc_address';

	/** Order meta: quoted amount in satoshis. */
	const META_SATS = '_wdk_pay_btc_sats';

	/** Order meta: last-known normalized status. */
	const META_STATUS = '_wdk_pay_btc_status';

	/** Order meta: confirmed funding transaction id. */
	const META_TXID = '_wdk_pay_btc_txid';

	/**
	 * Register REST routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			self::NAMESPACE,
			'/bitcoin/status/(?P<orderKey>[A-Za-z0-9_\-]+)',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'handle_status' ),
				'permission_callback' => '__return_true',
				'args'                => array(
					'orderKey' => array(
						'required'          => true,
						'type'              => 'string',
						'sanitize_callback' => 'sanitize_text_field',
					),
				),
			)
		);
	}

	/**
	 * Handle GET /bitcoin/status/{orderKey}.
	 *
	 * @param WP_REST_Request $request Incoming request.
	 * @return WP_REST_Response Status payload ({ status, seen, confirmations }).
	 */
	public function handle_status( WP_REST_Request $request ) {
		$order = $this->get_order_for_key( (string) $request->get_param( 'orderKey' ) );

		if ( ! $order ) {
			return $this->respond( 'unknown' );
		}

		// Authoritative WooCommerce paid state wins (idempotent).
		if ( $order->is_paid() ) {
			return $this->respond( WDK_Pay_Bitcoin_Watcher::STATUS_PAID );
		}

		if ( 'wdk_pay_bitcoin' !== $order->get_payment_method() ) {
			return $this->respond( 'unknown' );
		}

		$address = (string) $order->get_meta( self::META_ADDRESS );
		$sats    = (int) $order->get_meta( self::META_SATS );
		if ( '' === $address || $sats <= 0 ) {
			return $this->respond( WDK_Pay_Bitcoin_Watcher::STATUS_PENDING );
		}

		$gateway = $this->get_gateway();
		$watcher = $gateway ? $gateway->get_watcher() : null;
		if ( ! $gateway || ! $watcher ) {
			return $this->respond( WDK_Pay_Bitcoin_Watcher::STATUS_PENDING );
		}

		$settings = $gateway->get_resolved_settings();
		$result   = $watcher->get_address_status( $address, $sats, (int) $settings['confirmations'] );

		// Tolerate a transient backend error: report the last-known state so the
		// page keeps polling rather than declaring the request dead.
		if ( is_wp_error( $result ) ) {
			$last = (string) $order->get_meta( self::META_STATUS );
			return $this->respond( '' !== $last ? $last : WDK_Pay_Bitcoin_Watcher::STATUS_PENDING );
		}

		if ( WDK_Pay_Bitcoin_Watcher::STATUS_PAID === $result['status'] ) {
			return $this->complete_order( $order, $address, $sats, $result );
		}

		// Not yet paid: persist last-known status and surface whether a payment has
		// been seen (in the mempool / below the confirmation threshold).
		$order->update_meta_data( self::META_STATUS, $result['status'] );
		if ( '' !== $result['txid'] ) {
			$order->update_meta_data( self::META_TXID, $result['txid'] );
		}
		$order->save();

		return $this->respond(
			$result['status'],
			array(
				'seen'          => $result['received_sats'] >= $sats,
				'confirmations' => (int) $result['confirmations'],
			)
		);
	}

	/**
	 * Complete an order after a confirmed on-chain BTC payment.
	 *
	 * @param WC_Order            $order   The order.
	 * @param string              $address Receiving address.
	 * @param int                 $sats    Quoted amount in sats.
	 * @param array<string,mixed> $result  Watcher result (txid, confirmations…).
	 * @return WP_REST_Response
	 */
	private function complete_order( $order, $address, $sats, array $result ) {
		$txid = (string) $result['txid'];

		$order->update_meta_data( self::META_STATUS, WDK_Pay_Bitcoin_Watcher::STATUS_PAID );
		if ( '' !== $txid ) {
			$order->update_meta_data( self::META_TXID, $txid );
		}

		$explorer = '' !== $txid ? 'https://mempool.space/tx/' . rawurlencode( $txid ) : '';
		$order->add_order_note(
			sprintf(
				/* translators: 1: amount in sats, 2: address, 3: explorer URL or txid. */
				__( 'Bitcoin payment confirmed on-chain: %1$s to %2$s (%3$s).', 'wdk-pay' ),
				WDK_Pay_Bitcoin_Watcher::format_sats( (int) $sats ),
				$address,
				'' !== $explorer ? $explorer : ( '' !== $txid ? $txid : __( 'no txid', 'wdk-pay' ) )
			)
		);

		// Transitions to processing/completed and saves.
		$order->payment_complete( '' !== $txid ? $txid : $address );

		WDK_Pay_Webhook::fire(
			$order,
			'payment.confirmed',
			array(
				'status' => WDK_Pay_Bitcoin_Watcher::STATUS_PAID,
				'rail'   => 'bitcoin',
				'txHash' => $txid,
				'to'     => $address,
			)
		);

		return $this->respond( WDK_Pay_Bitcoin_Watcher::STATUS_PAID, array( 'confirmations' => (int) $result['confirmations'] ) );
	}

	/**
	 * Resolve an order from an order key.
	 *
	 * @param string $order_key WooCommerce order key.
	 * @return WC_Order|null
	 */
	private function get_order_for_key( $order_key ) {
		$order_key = sanitize_text_field( $order_key );
		if ( '' === $order_key ) {
			return null;
		}
		$order_id = wc_get_order_id_by_order_key( $order_key );
		if ( ! $order_id ) {
			return null;
		}
		$order = wc_get_order( $order_id );
		return $order instanceof WC_Order ? $order : null;
	}

	/**
	 * Fetch the configured Bitcoin gateway instance.
	 *
	 * @return WDK_Pay_Bitcoin_Gateway|null
	 */
	private function get_gateway() {
		if ( ! function_exists( 'WC' ) || ! WC()->payment_gateways() ) {
			return null;
		}
		$gateways = WC()->payment_gateways()->payment_gateways();
		if ( isset( $gateways['wdk_pay_bitcoin'] ) && $gateways['wdk_pay_bitcoin'] instanceof WDK_Pay_Bitcoin_Gateway ) {
			return $gateways['wdk_pay_bitcoin'];
		}
		return null;
	}

	/**
	 * Build a status response (always HTTP 200; outcome is in the body).
	 *
	 * @param string              $status Normalized status string.
	 * @param array<string,mixed> $extra  Optional extra fields (seen, confirmations).
	 * @return WP_REST_Response
	 */
	private function respond( $status, array $extra = array() ) {
		return new WP_REST_Response( array_merge( array( 'status' => (string) $status ), $extra ), 200 );
	}
}
