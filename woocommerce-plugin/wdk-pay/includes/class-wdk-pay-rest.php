<?php
/**
 * REST API controller.
 *
 * @package WDK_Pay
 */

// Guard against direct access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * WDK_Pay_REST
 *
 * Registers and handles the plugin's REST endpoints under the `wdk-pay/v1`
 * namespace:
 *
 *   POST /wdk-pay/v1/confirm          — submit a tx hash for verification.
 *   GET  /wdk-pay/v1/status/{orderKey} — poll the stored payment status.
 *
 * Authorisation model: the order key is treated as a bearer capability (it is a
 * high-entropy, per-order secret WooCommerce already uses to authorise the
 * order-pay and order-received pages). A valid `wp_rest` nonce is accepted as an
 * additional/alternative proof. Either is sufficient; both are validated
 * defensively.
 *
 * @package WDK_Pay
 */
class WDK_Pay_REST {

	/**
	 * REST namespace.
	 *
	 * @var string
	 */
	const NAMESPACE = 'wdk-pay/v1';

	/**
	 * Order meta key for the recorded transaction hash.
	 *
	 * @var string
	 */
	const META_TX_HASH = '_wdk_pay_tx_hash';

	/**
	 * Order meta key for the recorded payment status.
	 *
	 * @var string
	 */
	const META_STATUS = '_wdk_pay_status';

	/**
	 * Order meta key for the paying (from) address.
	 *
	 * @var string
	 */
	const META_FROM = '_wdk_pay_from';

	/**
	 * Order meta key for the numeric chain id a payment settled on (multi-chain).
	 *
	 * @var string
	 */
	const META_CHAIN_ID = '_wdk_pay_chain_id';

	/**
	 * Register REST routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			self::NAMESPACE,
			'/confirm',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'handle_confirm' ),
				'permission_callback' => array( $this, 'permission_confirm' ),
				'args'                => array(
					'orderKey' => array(
						'required'          => true,
						'type'              => 'string',
						'sanitize_callback' => 'sanitize_text_field',
					),
					'txHash'   => array(
						'required'          => true,
						'type'              => 'string',
						'sanitize_callback' => 'sanitize_text_field',
					),
					'from'     => array(
						'required'          => false,
						'type'              => 'string',
						'sanitize_callback' => 'sanitize_text_field',
					),
					'chainId'  => array(
						'required'          => false,
						'type'              => 'integer',
						'sanitize_callback' => 'absint',
					),
				),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/status/(?P<orderKey>[A-Za-z0-9_\-]+)',
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
	 * Permission callback for the confirm endpoint.
	 *
	 * Accepts the request when EITHER a valid wp_rest nonce is present OR the
	 * supplied order key resolves to a real order. The order key acts as a
	 * capability, mirroring how WooCommerce gates the order-pay page.
	 *
	 * @param WP_REST_Request $request Incoming request.
	 * @return bool|WP_Error True when permitted, WP_Error otherwise.
	 */
	public function permission_confirm( WP_REST_Request $request ) {
		// 1) A valid REST nonce is sufficient.
		$nonce = $request->get_header( 'X-WP-Nonce' );
		if ( $nonce && wp_verify_nonce( $nonce, 'wp_rest' ) ) {
			return true;
		}

		// 2) Otherwise, the order key must resolve to an order (bearer capability).
		$order_key = (string) $request->get_param( 'orderKey' );
		$order_id  = $order_key ? wc_get_order_id_by_order_key( $order_key ) : 0;

		if ( $order_id ) {
			return true;
		}

		return new WP_Error(
			'wdk_pay_forbidden',
			__( 'A valid order key or REST nonce is required.', 'wdk-pay' ),
			array( 'status' => 403 )
		);
	}

	/**
	 * Handle POST /confirm.
	 *
	 * @param WP_REST_Request $request Incoming request.
	 * @return WP_REST_Response Always HTTP 200 with a `status` field describing the outcome.
	 */
	public function handle_confirm( WP_REST_Request $request ) {
		$order_key = (string) $request->get_param( 'orderKey' );
		$tx_hash   = strtolower( trim( (string) $request->get_param( 'txHash' ) ) );
		$from      = (string) $request->get_param( 'from' );

		// Validate the transaction hash shape strictly.
		if ( ! WDK_Pay_Verifier::is_tx_hash( $tx_hash ) ) {
			return $this->respond(
				array(
					'status'  => WDK_Pay_Verifier::FAILED,
					'message' => __( 'Invalid transaction hash.', 'wdk-pay' ),
				)
			);
		}

		$order = $this->get_order_for_key( $order_key );
		if ( ! $order ) {
			return $this->respond(
				array(
					'status'  => WDK_Pay_Verifier::FAILED,
					'message' => __( 'Order not found.', 'wdk-pay' ),
				)
			);
		}

		// Idempotency: if already paid, report confirmed without re-verifying.
		if ( $order->is_paid() ) {
			return $this->respond(
				array(
					'status'  => WDK_Pay_Verifier::CONFIRMED,
					'orderId' => (int) $order->get_id(),
					'txHash'  => (string) $order->get_meta( self::META_TX_HASH ),
				)
			);
		}

		// Only our own gateway's orders may be confirmed here.
		if ( 'wdk_pay' !== $order->get_payment_method() ) {
			return $this->respond(
				array(
					'status'  => WDK_Pay_Verifier::FAILED,
					'message' => __( 'Order is not a WDK Pay order.', 'wdk-pay' ),
				)
			);
		}

		$gateway = $this->get_gateway();
		if ( ! $gateway ) {
			return $this->respond(
				array(
					'status'  => WDK_Pay_Verifier::FAILED,
					'message' => __( 'Payment gateway is unavailable.', 'wdk-pay' ),
				)
			);
		}

		$settings      = $gateway->get_resolved_settings();
		$to_address    = $settings['receiving_address'];
		$confirmations = (int) $settings['confirmations'];

		// Multi-chain: resolve the chain the customer paid on STRICTLY from the
		// merchant's configured set (the primary chain plus any "additional chains").
		// The reported chainId is attacker-controlled, so an unconfigured chain is
		// rejected outright — we never verify against an unknown RPC or token. The
		// resolved chain dictates the RPC endpoint, token contract, and decimals.
		$reported_chain_id = (int) $request->get_param( 'chainId' );
		$chain             = $gateway->resolve_chain( $reported_chain_id );
		if ( null === $chain ) {
			return $this->respond(
				array(
					'status'  => WDK_Pay_Verifier::FAILED,
					'message' => __( 'This payment chain is not accepted by the store.', 'wdk-pay' ),
				)
			);
		}

		$token_address = (string) $chain['token_address'];
		$decimals      = (int) $chain['decimals'];

		// Required amount in base units from the order total, in the asset's decimals.
		$min_amount_base = WDK_Pay_Intent::to_base_units( (string) $order->get_total(), $decimals );

		// Record the submitted hash early so /status reflects an in-flight attempt.
		$this->store_pending_attempt( $order, $tx_hash, $from );

		$verifier = new WDK_Pay_Verifier( $chain['rpc_url'] );
		$result   = $verifier->verify( $tx_hash, $token_address, $to_address, $min_amount_base, $confirmations );

		switch ( $result['status'] ) {
			case WDK_Pay_Verifier::CONFIRMED:
				return $this->respond( $this->complete_order( $order, $tx_hash, $settings, $chain ) );

			case WDK_Pay_Verifier::PENDING:
				$order->update_meta_data( self::META_STATUS, WDK_Pay_Verifier::PENDING );
				$order->save();

				$payload = array(
					'status'  => WDK_Pay_Verifier::PENDING,
					'orderId' => (int) $order->get_id(),
					'message' => $result['message'],
				);
				if ( isset( $result['confirmations'] ) ) {
					$payload['confirmations'] = (int) $result['confirmations'];
				}
				return $this->respond( $payload );

			case WDK_Pay_Verifier::FAILED:
			default:
				$order->update_meta_data( self::META_STATUS, WDK_Pay_Verifier::FAILED );
				$order->add_order_note(
					sprintf(
						/* translators: %s: failure reason. */
						__( 'WDK Pay verification failed: %s', 'wdk-pay' ),
						$result['message']
					)
				);
				$order->save();

				WDK_Pay_Webhook::fire(
					$order,
					'payment.failed',
					array(
						'status' => WDK_Pay_Verifier::FAILED,
						'txHash' => $tx_hash,
					)
				);

				return $this->respond(
					array(
						'status'  => WDK_Pay_Verifier::FAILED,
						'orderId' => (int) $order->get_id(),
						'message' => $result['message'],
					)
				);
		}
	}

	/**
	 * Handle GET /status/{orderKey}.
	 *
	 * @param WP_REST_Request $request Incoming request.
	 * @return WP_REST_Response Status payload.
	 */
	public function handle_status( WP_REST_Request $request ) {
		$order_key = (string) $request->get_param( 'orderKey' );
		$order     = $this->get_order_for_key( $order_key );

		if ( ! $order ) {
			return $this->respond(
				array(
					'status' => 'unknown',
					'txHash' => '',
				)
			);
		}

		// Prefer the authoritative WooCommerce paid state.
		if ( $order->is_paid() ) {
			$status = WDK_Pay_Verifier::CONFIRMED;
		} else {
			$status = (string) $order->get_meta( self::META_STATUS );
			if ( '' === $status ) {
				$status = WDK_Pay_Verifier::PENDING;
			}
		}

		return $this->respond(
			array(
				'status' => $status,
				'txHash' => (string) $order->get_meta( self::META_TX_HASH ),
			)
		);
	}

	/* --------------------------------------------------------------------- *
	 * Internal helpers.
	 * --------------------------------------------------------------------- */

	/**
	 * Complete the order after a confirmed on-chain payment.
	 *
	 * @param WC_Order            $order    The order.
	 * @param string              $tx_hash  Confirmed transaction hash.
	 * @param array<string,mixed> $settings Resolved gateway settings.
	 * @param array<string,mixed> $chain    Resolved chain the payment settled on
	 *                                       (chain_id, chain_key, token_address, …).
	 * @return array{status:string,orderId:int,txHash:string} Response payload.
	 */
	private function complete_order( $order, $tx_hash, array $settings, array $chain ) {
		$order->update_meta_data( self::META_TX_HASH, $tx_hash );
		$order->update_meta_data( self::META_STATUS, WDK_Pay_Verifier::CONFIRMED );
		$order->update_meta_data( self::META_CHAIN_ID, (int) $chain['chain_id'] );

		// Explorer link only when the settling chain is in the built-in registry
		// (an "additional chain" may have no known explorer — degrade gracefully).
		$explorer = '' !== $chain['chain_key'] ? WDK_Pay_Chains::explorer_tx( (string) $chain['chain_key'], $tx_hash ) : '';
		$note     = sprintf(
			/* translators: 1: transaction hash, 2: explorer URL. */
			__( 'USDt payment confirmed on-chain. Tx: %1$s (%2$s)', 'wdk-pay' ),
			$tx_hash,
			$explorer ? $explorer : __( 'no explorer configured', 'wdk-pay' )
		);
		$order->add_order_note( $note );

		// payment_complete() transitions to processing/completed and saves.
		$order->payment_complete( $tx_hash );

		WDK_Pay_Webhook::fire(
			$order,
			'payment.confirmed',
			array(
				'status'  => WDK_Pay_Verifier::CONFIRMED,
				'txHash'  => $tx_hash,
				'chainId' => (int) $chain['chain_id'],
				'token'   => (string) $chain['token_address'],
			)
		);

		return array(
			'status'  => WDK_Pay_Verifier::CONFIRMED,
			'orderId' => (int) $order->get_id(),
			'txHash'  => $tx_hash,
		);
	}

	/**
	 * Persist an in-flight payment attempt to order meta.
	 *
	 * @param WC_Order $order   The order.
	 * @param string   $tx_hash Submitted transaction hash.
	 * @param string   $from    Optional paying address.
	 * @return void
	 */
	private function store_pending_attempt( $order, $tx_hash, $from ) {
		$order->update_meta_data( self::META_TX_HASH, $tx_hash );
		$order->update_meta_data( self::META_STATUS, WDK_Pay_Verifier::PENDING );

		$from_norm = WDK_Pay_Verifier::normalize_address( $from );
		if ( '' !== $from_norm ) {
			$order->update_meta_data( self::META_FROM, $from_norm );
		}

		$order->save();
	}

	/**
	 * Resolve an order from an order key, with strict key validation.
	 *
	 * @param string $order_key WooCommerce order key.
	 * @return WC_Order|null The order, or null when not found.
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
	 * Fetch the configured WDK Pay gateway instance.
	 *
	 * @return WDK_Pay_Gateway|null The gateway, or null when unavailable.
	 */
	private function get_gateway() {
		if ( ! function_exists( 'WC' ) || ! WC()->payment_gateways() ) {
			return null;
		}

		$gateways = WC()->payment_gateways()->payment_gateways();

		if ( isset( $gateways['wdk_pay'] ) && $gateways['wdk_pay'] instanceof WDK_Pay_Gateway ) {
			return $gateways['wdk_pay'];
		}

		return null;
	}

	/**
	 * Build a WP_REST_Response (always HTTP 200; outcome is in the body).
	 *
	 * @param array<string,mixed> $data Response data.
	 * @return WP_REST_Response
	 */
	private function respond( array $data ) {
		return new WP_REST_Response( $data, 200 );
	}
}
