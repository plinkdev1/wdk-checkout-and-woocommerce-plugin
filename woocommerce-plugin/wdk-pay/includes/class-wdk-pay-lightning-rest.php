<?php
/**
 * Lightning REST controller.
 *
 * @package WDK_Pay
 */

// Guard against direct access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * WDK_Pay_Lightning_REST
 *
 * One endpoint, polled by the order-pay page:
 *
 *   GET /wdk-pay/v1/lightning/status/{orderKey}
 *     — read the stored invoice's status from the merchant's Lightning backend
 *       (server-side; credentials never reach the browser) and, when it's paid,
 *       call payment_complete() exactly once.
 *
 * The order key is a high-entropy per-order secret WooCommerce already uses to
 * gate the order-pay page, so it authorises this read the same way the on-chain
 * `/status` endpoint does.
 *
 * @package WDK_Pay
 */
class WDK_Pay_Lightning_REST {

	const NAMESPACE = 'wdk-pay/v1';

	/** Order meta: provider invoice id / payment hash. */
	const META_INVOICE_ID = '_wdk_pay_ln_invoice_id';

	/** Order meta: BOLT11 payment request string. */
	const META_BOLT11 = '_wdk_pay_ln_bolt11';

	/** Order meta: invoice expiry (unix seconds). */
	const META_EXPIRES = '_wdk_pay_ln_expires';

	/** Order meta: last-known normalized status. */
	const META_STATUS = '_wdk_pay_ln_status';

	/** Order meta: invoice amount in satoshis. */
	const META_SATS = '_wdk_pay_ln_sats';

	/**
	 * Register REST routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			self::NAMESPACE,
			'/lightning/status/(?P<orderKey>[A-Za-z0-9_\-]+)',
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
	 * Handle GET /lightning/status/{orderKey}.
	 *
	 * @param WP_REST_Request $request Incoming request.
	 * @return WP_REST_Response Status payload ({ status: pending|paid|expired|unknown }).
	 */
	public function handle_status( WP_REST_Request $request ) {
		$order = $this->get_order_for_key( (string) $request->get_param( 'orderKey' ) );

		if ( ! $order ) {
			return $this->respond( 'unknown' );
		}

		// Authoritative WooCommerce paid state wins (idempotent).
		if ( $order->is_paid() ) {
			return $this->respond( 'paid' );
		}

		if ( 'wdk_pay_lightning' !== $order->get_payment_method() ) {
			return $this->respond( 'unknown' );
		}

		$invoice_id = (string) $order->get_meta( self::META_INVOICE_ID );
		if ( '' === $invoice_id ) {
			return $this->respond( WDK_Pay_Lightning_Client::STATUS_PENDING );
		}

		$gateway = $this->get_gateway();
		$client  = $gateway ? $gateway->get_client() : null;
		if ( ! $client ) {
			return $this->respond( WDK_Pay_Lightning_Client::STATUS_PENDING );
		}

		$status = $client->get_invoice_status( $invoice_id );

		// Tolerate a transient backend error: report the last-known state so the
		// page keeps polling rather than declaring the invoice dead.
		if ( is_wp_error( $status ) ) {
			$last = (string) $order->get_meta( self::META_STATUS );
			return $this->respond( '' !== $last ? $last : WDK_Pay_Lightning_Client::STATUS_PENDING );
		}

		if ( WDK_Pay_Lightning_Client::STATUS_PAID === $status ) {
			$order->update_meta_data( self::META_STATUS, WDK_Pay_Lightning_Client::STATUS_PAID );
			$order->add_order_note(
				sprintf(
					/* translators: %s: Lightning invoice id. */
					__( 'Lightning invoice paid. Invoice: %s', 'wdk-pay' ),
					$invoice_id
				)
			);
			// Transitions to processing/completed and saves.
			$order->payment_complete( $invoice_id );
			return $this->respond( WDK_Pay_Lightning_Client::STATUS_PAID );
		}

		$order->update_meta_data( self::META_STATUS, $status );
		$order->save();

		return $this->respond( $status );
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
	 * Fetch the configured Lightning gateway instance.
	 *
	 * @return WDK_Pay_Lightning_Gateway|null
	 */
	private function get_gateway() {
		if ( ! function_exists( 'WC' ) || ! WC()->payment_gateways() ) {
			return null;
		}
		$gateways = WC()->payment_gateways()->payment_gateways();
		if ( isset( $gateways['wdk_pay_lightning'] ) && $gateways['wdk_pay_lightning'] instanceof WDK_Pay_Lightning_Gateway ) {
			return $gateways['wdk_pay_lightning'];
		}
		return null;
	}

	/**
	 * Build a status response (always HTTP 200; outcome is in the body).
	 *
	 * @param string $status Normalized status string.
	 * @return WP_REST_Response
	 */
	private function respond( $status ) {
		return new WP_REST_Response( array( 'status' => (string) $status ), 200 );
	}
}
