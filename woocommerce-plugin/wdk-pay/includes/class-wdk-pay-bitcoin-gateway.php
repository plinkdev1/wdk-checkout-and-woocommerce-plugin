<?php
/**
 * WooCommerce on-chain Bitcoin payment gateway.
 *
 * @package WDK_Pay
 */

// Guard against direct access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * WDK_Pay_Bitcoin_Gateway
 *
 * Accept native BTC (on-chain, BIP-84 / bech32) at WooCommerce checkout. The
 * merchant receives into their own Bitcoin address and the gateway watches an
 * Esplora-compatible API (mempool.space / Blockstream / self-hosted) for the
 * payment — the PHP consumer of the JS `@wdk-starter/wdk-checkout/bitcoin` rail.
 *
 * Flow:
 *   1. Customer selects "Pay with Bitcoin".
 *   2. process_payment() marks the order pending and redirects to the order-pay page.
 *   3. receipt_page() converts the total to sats, resolves the receiving address
 *      (a per-order address via the `wdk_pay_bitcoin_order_address` filter is
 *      recommended for privacy + attribution), and renders a BIP-21 QR + address
 *      with a status poller.
 *   4. The poller hits /wdk-pay/v1/bitcoin/status/{key}; once a confirmed payment
 *      of at least the order amount lands, the order is completed.
 *
 * Self-custodial: funds settle straight to the merchant's address; nothing here
 * custodies them.
 *
 * @package WDK_Pay
 */
class WDK_Pay_Bitcoin_Gateway extends WC_Payment_Gateway {

	/**
	 * Constructor: wire up settings, properties, and hooks.
	 */
	public function __construct() {
		$this->id                 = 'wdk_pay_bitcoin';
		$this->method_title       = __( 'WDK Pay (Bitcoin)', 'wdk-pay' );
		$this->method_description = __( 'Accept native on-chain BTC into your own Bitcoin address. The order total is priced in sats and the payment is verified on-chain via an Esplora-compatible API (mempool.space, Blockstream, or self-hosted). The customer pays from any Bitcoin wallet.', 'wdk-pay' );
		$this->has_fields         = false;
		$this->supports           = array( 'products' );

		$this->icon = apply_filters( 'wdk_pay_bitcoin_gateway_icon', WDK_PAY_PLUGIN_URL . 'assets/img/wdk-pay-bitcoin-icon.png' );

		$this->init_form_fields();
		$this->init_settings();

		$this->title       = $this->get_option( 'title' );
		$this->description = $this->get_option( 'description' );

		add_action(
			'woocommerce_update_options_payment_gateways_' . $this->id,
			array( $this, 'process_admin_options' )
		);

		add_action( 'woocommerce_receipt_' . $this->id, array( $this, 'receipt_page' ) );
	}

	/**
	 * Render the gateway icon at a tidy, constrained size next to the method title.
	 *
	 * @return string Icon HTML.
	 */
	public function get_icon() {
		if ( empty( $this->icon ) ) {
			return apply_filters( 'woocommerce_gateway_icon', '', $this->id );
		}
		$icon_html = sprintf(
			'<img src="%s" alt="%s" style="max-height:24px;width:auto;margin-left:6px;vertical-align:middle" />',
			esc_url( $this->icon ),
			esc_attr( $this->get_title() )
		);
		return apply_filters( 'woocommerce_gateway_icon', $icon_html, $this->id );
	}

	/**
	 * Define the admin settings fields.
	 *
	 * @return void
	 */
	public function init_form_fields() {
		$this->form_fields = array(
			'enabled'        => array(
				'title'   => __( 'Enable/Disable', 'wdk-pay' ),
				'type'    => 'checkbox',
				'label'   => __( 'Enable WDK Pay (Bitcoin)', 'wdk-pay' ),
				'default' => 'no',
			),
			'title'          => array(
				'title'       => __( 'Title', 'wdk-pay' ),
				'type'        => 'text',
				'description' => __( 'Payment method title shown to customers at checkout.', 'wdk-pay' ),
				'default'     => __( 'Pay with Bitcoin', 'wdk-pay' ),
				'desc_tip'    => true,
			),
			'description'    => array(
				'title'       => __( 'Description', 'wdk-pay' ),
				'type'        => 'textarea',
				'description' => __( 'Payment method description shown to customers at checkout.', 'wdk-pay' ),
				'default'     => __( 'Pay on-chain with Bitcoin. Scan the QR from any Bitcoin wallet; your order completes once the payment confirms.', 'wdk-pay' ),
				'desc_tip'    => true,
			),
			'receive_title'  => array(
				'title'       => __( 'Receiving address', 'wdk-pay' ),
				'type'        => 'title',
				'description' => __( 'BTC settles directly into the address below. For privacy and clean attribution across orders, derive a fresh BIP-84 address per order from your WDK BTC wallet via the <code>wdk_pay_bitcoin_order_address</code> filter — the static address is the fallback.', 'wdk-pay' ),
			),
			'btc_address'    => array(
				'title'       => __( 'Bitcoin address', 'wdk-pay' ),
				'type'        => 'text',
				'description' => __( 'Your receiving address (bech32 bc1… recommended). Required unless a per-order address filter is wired.', 'wdk-pay' ),
				'default'     => '',
				'placeholder' => 'bc1q…',
				'desc_tip'    => true,
			),
			'watch_title'    => array(
				'title'       => __( 'On-chain verification', 'wdk-pay' ),
				'type'        => 'title',
				'description' => __( 'The gateway watches your address via an Esplora-compatible REST API. mempool.space and Blockstream are public defaults; point this at a self-hosted Esplora for privacy.', 'wdk-pay' ),
			),
			'esplora_url'    => array(
				'title'       => __( 'Esplora API base URL', 'wdk-pay' ),
				'type'        => 'text',
				'description' => __( 'e.g. https://mempool.space/api or https://blockstream.info/api. Required.', 'wdk-pay' ),
				'default'     => 'https://mempool.space/api',
				'placeholder' => 'https://mempool.space/api',
				'desc_tip'    => true,
			),
			'confirmations'  => array(
				'title'             => __( 'Required confirmations', 'wdk-pay' ),
				'type'              => 'number',
				'description'       => __( 'Block confirmations required before the order is marked paid. 1 is typical for small amounts.', 'wdk-pay' ),
				'default'           => '1',
				'desc_tip'          => true,
				'custom_attributes' => array(
					'min'  => '1',
					'step' => '1',
				),
			),
			'pricing_title'  => array(
				'title'       => __( 'Pricing', 'wdk-pay' ),
				'type'        => 'title',
				'description' => __( 'The order total is converted to satoshis using the BTC price below. Set your current rate, or wire a live feed (see ROADMAP).', 'wdk-pay' ),
			),
			'btc_price'      => array(
				'title'             => __( 'BTC price (store currency per 1 BTC)', 'wdk-pay' ),
				'type'              => 'number',
				'description'       => __( 'e.g. 65000 means 1 BTC = 65,000 of your store currency. Required.', 'wdk-pay' ),
				'default'           => '',
				'placeholder'       => '65000',
				'desc_tip'          => true,
				'custom_attributes' => array(
					'min'  => '0',
					'step' => 'any',
				),
			),
			'payment_window' => array(
				'title'             => __( 'Payment window (minutes)', 'wdk-pay' ),
				'type'              => 'number',
				'description'       => __( 'How long the quoted price/address stays valid before the request expires.', 'wdk-pay' ),
				'default'           => '60',
				'desc_tip'          => true,
				'custom_attributes' => array(
					'min'  => '1',
					'step' => '1',
				),
			),
			'accent'         => array(
				'title'       => __( 'Accent color', 'wdk-pay' ),
				'type'        => 'text',
				'description' => __( 'Primary button color on the payment page. 6-digit hex (e.g. #F7931A). Leave blank for the default.', 'wdk-pay' ),
				'default'     => '#f7931a',
				'placeholder' => '#f7931a',
				'desc_tip'    => true,
			),
		);
	}

	/**
	 * Validate the Bitcoin address field on save (basic shape check, or blank).
	 *
	 * @param string $key   Field key.
	 * @param string $value Submitted value.
	 * @return string Sanitised value.
	 */
	public function validate_btc_address_field( $key, $value ) {
		$value = trim( sanitize_text_field( (string) $value ) );
		if ( '' !== $value && ! self::looks_like_btc_address( $value ) ) {
			WC_Admin_Settings::add_error(
				__( 'WDK Pay (Bitcoin): that does not look like a valid Bitcoin address (expected bc1…, 1…, or 3…).', 'wdk-pay' )
			);
			return (string) $this->get_option( $key );
		}
		return $value;
	}

	/**
	 * Validate the Esplora base URL field on save.
	 *
	 * @param string $key   Field key.
	 * @param string $value Submitted value.
	 * @return string Sanitised URL.
	 */
	public function validate_esplora_url_field( $key, $value ) {
		$value = esc_url_raw( trim( (string) $value ) );
		if ( '' !== $value && ! wp_http_validate_url( $value ) ) {
			WC_Admin_Settings::add_error(
				__( 'WDK Pay (Bitcoin): the Esplora API base URL must be a valid http(s) URL.', 'wdk-pay' )
			);
		}
		return $value;
	}

	/**
	 * Validate the BTC price field on save (must be a positive number).
	 *
	 * @param string $key   Field key.
	 * @param string $value Submitted value.
	 * @return string Sanitised value.
	 */
	public function validate_btc_price_field( $key, $value ) {
		$value = trim( sanitize_text_field( (string) $value ) );
		if ( '' !== $value && ( ! is_numeric( $value ) || (float) $value <= 0 ) ) {
			WC_Admin_Settings::add_error(
				__( 'WDK Pay (Bitcoin): the BTC price must be a positive number.', 'wdk-pay' )
			);
			return (string) $this->get_option( $key );
		}
		return $value;
	}

	/**
	 * Validate the accent color field on save (6-digit hex or blank).
	 *
	 * @param string $key   Field key.
	 * @param string $value Submitted value.
	 * @return string Sanitised value.
	 */
	public function validate_accent_field( $key, $value ) {
		$value = trim( sanitize_text_field( (string) $value ) );
		if ( '' !== $value && ! preg_match( '/^#[0-9A-Fa-f]{6}$/', $value ) ) {
			WC_Admin_Settings::add_error(
				__( 'WDK Pay (Bitcoin): the accent color must be a 6-digit hex value like #F7931A.', 'wdk-pay' )
			);
			return (string) $this->get_option( $key );
		}
		return $value;
	}

	/**
	 * Loose Bitcoin-address shape check (bech32 bc1… / P2PKH 1… / P2SH 3…). This is
	 * a sanity guard for the admin field, not a full checksum validation.
	 *
	 * @param string $address Candidate address.
	 * @return bool True when it plausibly looks like a mainnet BTC address.
	 */
	public static function looks_like_btc_address( $address ) {
		$address = trim( (string) $address );
		if ( preg_match( '/^bc1[0-9ac-hj-np-z]{8,87}$/i', $address ) ) {
			return true;
		}
		if ( preg_match( '/^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/', $address ) ) {
			return true;
		}
		return false;
	}

	/**
	 * Resolve effective settings into a normalized array.
	 *
	 * @return array{
	 *     btc_address:string,
	 *     esplora_url:string,
	 *     confirmations:int,
	 *     btc_price:float,
	 *     payment_window:int,
	 *     accent:string
	 * }
	 */
	public function get_resolved_settings() {
		$accent = trim( (string) $this->get_option( 'accent', '#f7931a' ) );
		if ( '' !== $accent && ! preg_match( '/^#[0-9A-Fa-f]{6}$/', $accent ) ) {
			$accent = '';
		}

		return array(
			'btc_address'    => trim( (string) $this->get_option( 'btc_address', '' ) ),
			'esplora_url'    => trim( (string) $this->get_option( 'esplora_url', 'https://mempool.space/api' ) ),
			'confirmations'  => max( 1, (int) $this->get_option( 'confirmations', 1 ) ),
			'btc_price'      => (float) $this->get_option( 'btc_price', 0 ),
			'payment_window' => max( 1, (int) $this->get_option( 'payment_window', 60 ) ),
			'accent'         => $accent,
		);
	}

	/**
	 * Build a watcher from the resolved settings.
	 *
	 * @return WDK_Pay_Bitcoin_Watcher|null Null when no Esplora URL is configured.
	 */
	public function get_watcher() {
		$s = $this->get_resolved_settings();
		if ( '' === $s['esplora_url'] ) {
			return null;
		}
		return new WDK_Pay_Bitcoin_Watcher( array( 'base_url' => $s['esplora_url'] ) );
	}

	/**
	 * Resolve the receiving address for an order. Prefers a stored per-order
	 * address (stable across reloads); otherwise asks the
	 * `wdk_pay_bitcoin_order_address` filter (recommended: derive a fresh BIP-84
	 * address from the merchant's WDK BTC wallet), falling back to the static
	 * configured address.
	 *
	 * @param WC_Order            $order    The order.
	 * @param array<string,mixed> $settings Resolved settings.
	 * @return string Receiving address ('' when none configured).
	 */
	public function resolve_order_address( $order, array $settings ) {
		$stored = (string) $order->get_meta( WDK_Pay_Bitcoin_REST::META_ADDRESS );
		if ( '' !== $stored ) {
			return $stored;
		}

		/**
		 * Filter the per-order BTC receiving address. Return a freshly-derived
		 * BIP-84 address for privacy + attribution. Defaults to the static address.
		 *
		 * @param string   $address  The static configured address.
		 * @param WC_Order $order    The order being paid.
		 */
		$address = (string) apply_filters( 'wdk_pay_bitcoin_order_address', $settings['btc_address'], $order );
		$address = trim( $address );

		if ( '' !== $address ) {
			$order->update_meta_data( WDK_Pay_Bitcoin_REST::META_ADDRESS, $address );
			$order->save();
		}
		return $address;
	}

	/**
	 * Determine whether the gateway is available for use at checkout.
	 *
	 * @return bool
	 */
	public function is_available() {
		if ( 'yes' !== $this->get_option( 'enabled' ) ) {
			return false;
		}
		$s = $this->get_resolved_settings();
		$has_address = '' !== $s['btc_address'] || has_filter( 'wdk_pay_bitcoin_order_address' );
		if ( ! $has_address || '' === $s['esplora_url'] || $s['btc_price'] <= 0 ) {
			return false;
		}
		return parent::is_available();
	}

	/**
	 * Render an admin notice when the gateway is enabled but misconfigured.
	 *
	 * @return void
	 */
	public function maybe_render_admin_notice() {
		if ( 'yes' !== $this->get_option( 'enabled' ) ) {
			return;
		}
		$s        = $this->get_resolved_settings();
		$problems = array();
		if ( '' === $s['btc_address'] && ! has_filter( 'wdk_pay_bitcoin_order_address' ) ) {
			$problems[] = __( 'a Bitcoin receiving address', 'wdk-pay' );
		}
		if ( '' === $s['esplora_url'] ) {
			$problems[] = __( 'an Esplora API URL', 'wdk-pay' );
		}
		if ( $s['btc_price'] <= 0 ) {
			$problems[] = __( 'a BTC price for sats conversion', 'wdk-pay' );
		}
		if ( empty( $problems ) ) {
			return;
		}
		$message = sprintf(
			/* translators: %s: comma-separated list of missing settings. */
			__( 'WDK Pay (Bitcoin) is enabled but not fully configured. Please set %s.', 'wdk-pay' ),
			implode( __( ' and ', 'wdk-pay' ), $problems )
		);
		printf( '<div class="notice notice-warning"><p>%s</p></div>', esc_html( $message ) );
	}

	/**
	 * Process the checkout for an order: mark pending, redirect to the order-pay page.
	 *
	 * @param int $order_id The order ID.
	 * @return array{result:string,redirect:string}|void
	 */
	public function process_payment( $order_id ) {
		$order = wc_get_order( $order_id );
		if ( ! $order instanceof WC_Order ) {
			wc_add_notice( __( 'Unable to process payment: order not found.', 'wdk-pay' ), 'error' );
			return;
		}

		$order->update_status( 'pending', __( 'Awaiting Bitcoin payment.', 'wdk-pay' ) );
		$order->update_meta_data( WDK_Pay_Bitcoin_REST::META_STATUS, WDK_Pay_Bitcoin_Watcher::STATUS_PENDING );
		$order->save();

		wc_reduce_stock_levels( $order_id );

		if ( function_exists( 'WC' ) && WC()->cart ) {
			WC()->cart->empty_cart();
		}

		return array(
			'result'   => 'success',
			'redirect' => $order->get_checkout_payment_url( true ),
		);
	}

	/**
	 * Render the order-pay (receipt) page: resolve address + sats, show QR + poll.
	 *
	 * @param int $order_id The order ID.
	 * @return void
	 */
	public function receipt_page( $order_id ) {
		$order = wc_get_order( $order_id );
		if ( ! $order instanceof WC_Order ) {
			echo '<p>' . esc_html__( 'Order not found.', 'wdk-pay' ) . '</p>';
			return;
		}

		if ( $order->is_paid() ) {
			echo '<p>' . esc_html__( 'This order has already been paid. Thank you!', 'wdk-pay' ) . '</p>';
			return;
		}

		$settings = $this->get_resolved_settings();
		if ( '' === $settings['esplora_url'] || $settings['btc_price'] <= 0 ) {
			echo '<p>' . esc_html__( 'Bitcoin payments are temporarily unavailable. Please contact the store.', 'wdk-pay' ) . '</p>';
			return;
		}

		$address = $this->resolve_order_address( $order, $settings );
		if ( '' === $address ) {
			echo '<p>' . esc_html__( 'Bitcoin payments are temporarily unavailable (no receiving address). Please contact the store.', 'wdk-pay' ) . '</p>';
			return;
		}

		$sats = WDK_Pay_Bitcoin_Watcher::sats_for_fiat( (string) $order->get_total(), $settings['btc_price'] );
		if ( $sats <= 0 ) {
			echo '<p>' . esc_html__( 'Order amount converts to zero satoshis.', 'wdk-pay' ) . '</p>';
			return;
		}

		// Persist the quoted sats so the verifier checks the right minimum.
		$order->update_meta_data( WDK_Pay_Bitcoin_REST::META_SATS, (int) $sats );
		$order->save();

		$label = sprintf(
			/* translators: 1: site name, 2: order number. */
			__( '%1$s — order #%2$s', 'wdk-pay' ),
			get_bloginfo( 'name' ),
			$order->get_order_number()
		);
		$uri = WDK_Pay_Bitcoin_Watcher::build_bip21_uri( $address, (int) $sats, $label );

		$this->enqueue_assets( $order, $uri );
		$this->render_payment( $order, $address, (int) $sats, $uri, $settings );
	}

	/**
	 * Enqueue the QR library and the inline render/poll script.
	 *
	 * @param WC_Order $order The order.
	 * @param string   $uri   BIP-21 URI to encode in the QR.
	 * @return void
	 */
	private function enqueue_assets( $order, $uri ) {
		wp_enqueue_script(
			'wdk-pay-qrcode',
			'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js',
			array(),
			'1.4.4',
			true
		);

		$config = array(
			'uri'          => (string) $uri,
			'statusUrl'    => rest_url( WDK_Pay_Bitcoin_REST::NAMESPACE . '/bitcoin/status/' . rawurlencode( $order->get_order_key() ) ),
			'returnUrl'    => $order->get_checkout_order_received_url(),
			'pollInterval' => 12000,
			'i18n'         => array(
				'copied'  => __( 'Copied', 'wdk-pay' ),
				'copy'    => __( 'Copy address', 'wdk-pay' ),
				'paid'    => __( 'Payment detected — redirecting…', 'wdk-pay' ),
				'seen'    => __( 'Payment seen — waiting for confirmations…', 'wdk-pay' ),
				'expired' => __( 'This request expired. Refresh the page to get a new one.', 'wdk-pay' ),
			),
		);

		wp_register_script( 'wdk-pay-bitcoin', false, array( 'wdk-pay-qrcode' ), WDK_PAY_VERSION, true );
		wp_enqueue_script( 'wdk-pay-bitcoin' );
		wp_add_inline_script( 'wdk-pay-bitcoin', 'window.WDK_PAY_BTC=' . wp_json_encode( $config ) . ';' . $this->inline_script(), 'after' );
	}

	/**
	 * The browser-side renderer + poller (rendered inline, depends on qrcode-generator).
	 *
	 * @return string JavaScript source.
	 */
	private function inline_script() {
		return <<<'JS'
(function(){
  var c = window.WDK_PAY_BTC; if(!c){return;}
  function ready(fn){ if(document.readyState!=='loading'){fn();} else {document.addEventListener('DOMContentLoaded',fn);} }
  ready(function(){
    var qrEl = document.getElementById('wdk-btc-qr');
    if (qrEl && typeof qrcode === 'function') {
      try { var q = qrcode(0,'M'); q.addData(String(c.uri)); q.make(); qrEl.innerHTML = q.createImgTag(5,8); var img=qrEl.querySelector('img'); if(img){img.style.width='220px';img.style.height='220px';img.style.imageRendering='pixelated';} }
      catch(e){ qrEl.textContent = c.uri; }
    }
    var copyBtn = document.getElementById('wdk-btc-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', function(){
        var addr = (copyBtn.getAttribute('data-address')||'');
        var done = function(){ copyBtn.textContent = c.i18n.copied; setTimeout(function(){ copyBtn.textContent = c.i18n.copy; }, 1500); };
        if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(addr).then(done, done); }
        else { var t=document.getElementById('wdk-btc-address'); if(t){ var r=document.createRange(); r.selectNode(t); var s=window.getSelection(); s.removeAllRanges(); s.addRange(r); try{document.execCommand('copy');}catch(e){} s.removeAllRanges(); done(); } }
      });
    }
    var note = document.getElementById('wdk-btc-note');
    var stopped = false;
    function poll(){
      if (stopped) { return; }
      fetch(c.statusUrl, { headers: { 'Accept':'application/json' } })
        .then(function(r){ return r.json(); })
        .then(function(d){
          if (!d || stopped) { return; }
          if (d.status === 'paid') { stopped = true; if(note){ note.textContent = c.i18n.paid; } window.location.href = c.returnUrl; }
          else if (d.status === 'expired') { stopped = true; if(note){ note.textContent = c.i18n.expired; } }
          else if (d.seen) { if(note){ note.textContent = c.i18n.seen + (d.confirmations ? ' ('+d.confirmations+')' : ''); } }
        })
        .catch(function(){});
    }
    poll();
    setInterval(poll, c.pollInterval || 12000);
  });
})();
JS;
	}

	/**
	 * Render the payment card markup (the QR is hydrated by the inline script).
	 *
	 * @param WC_Order            $order    The order.
	 * @param string              $address  Receiving address.
	 * @param int                 $sats     Amount in satoshis.
	 * @param string              $uri      BIP-21 URI.
	 * @param array<string,mixed> $settings Resolved settings.
	 * @return void
	 */
	private function render_payment( $order, $address, $sats, $uri, array $settings ) {
		$accent     = '' !== $settings['accent'] ? $settings['accent'] : '#f7931a';
		$sats_label = WDK_Pay_Bitcoin_Watcher::format_sats( (int) $sats );
		$btc_label  = WDK_Pay_Bitcoin_Watcher::sats_to_btc_string( (int) $sats ) . ' BTC';
		$fiat_label = wp_strip_all_tags( wc_price( $order->get_total(), array( 'currency' => $order->get_currency() ) ) );
		?>
		<div id="wdk-pay-btc-root" style="max-width:420px;margin:0 auto;text-align:center;font-family:inherit;">
			<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border:1px solid #e5e5e5;border-radius:12px;margin-bottom:14px;">
				<span style="opacity:.7;"><?php esc_html_e( 'Amount due', 'wdk-pay' ); ?></span>
				<strong><?php echo esc_html( $btc_label ); ?> <span style="opacity:.6;font-weight:400;">(<?php echo esc_html( $fiat_label ); ?>)</span></strong>
			</div>
			<div id="wdk-btc-qr" style="display:inline-block;background:#fff;padding:10px;border-radius:12px;border:1px solid #e5e5e5;min-height:220px;min-width:220px;"></div>
			<p style="font-size:13px;opacity:.7;margin:12px 0 6px;">
				<?php
				echo esc_html(
					sprintf(
						/* translators: %s: amount in sats. */
						__( 'Send exactly %s to the address below.', 'wdk-pay' ),
						$sats_label
					)
				);
				?>
			</p>
			<code id="wdk-btc-address" style="display:block;word-break:break-all;font-size:12px;background:#f6f6f6;padding:8px 10px;border-radius:8px;"><?php echo esc_html( (string) $address ); ?></code>
			<button type="button" id="wdk-btc-copy" data-address="<?php echo esc_attr( (string) $address ); ?>" style="margin-top:10px;width:100%;padding:10px 14px;border:none;border-radius:10px;cursor:pointer;font-weight:600;color:#fff;background:<?php echo esc_attr( $accent ); ?>;">
				<?php esc_html_e( 'Copy address', 'wdk-pay' ); ?>
			</button>
			<p id="wdk-btc-note" style="font-size:13px;opacity:.8;margin-top:12px;"><?php esc_html_e( 'Waiting for payment… this updates automatically.', 'wdk-pay' ); ?></p>
		</div>
		<?php
	}
}
