<?php
/**
 * WooCommerce Lightning payment gateway.
 *
 * @package WDK_Pay
 */

// Guard against direct access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * WDK_Pay_Lightning_Gateway
 *
 * Accept Lightning (BOLT11) payments at WooCommerce checkout. The merchant points
 * the gateway at a Lightning backend they control — a Spark service, LNbits, or
 * LND-REST (anything the JS `@wdk-starter/wdk-checkout/lightning` client speaks).
 *
 * Flow:
 *   1. Customer selects "Pay with Lightning".
 *   2. process_payment() marks the order pending and redirects to the order-pay page.
 *   3. receipt_page() converts the total to sats, mints a BOLT11 invoice server-side
 *      (credentials never reach the browser), and renders it as a QR + copyable
 *      string with a small status poller.
 *   4. The poller hits /wdk-pay/v1/lightning/status/{key}; when the backend reports
 *      paid, the order is completed and the customer is redirected to the receipt.
 *
 * Self-custodial: the invoice is paid into the merchant's own Lightning wallet;
 * nothing here custodies funds.
 *
 * @package WDK_Pay
 */
class WDK_Pay_Lightning_Gateway extends WC_Payment_Gateway {

	/**
	 * Constructor: wire up settings, properties, and hooks.
	 */
	public function __construct() {
		$this->id                 = 'wdk_pay_lightning';
		$this->method_title       = __( 'WDK Pay (Lightning)', 'wdk-pay' );
		$this->method_description = __( 'Accept Lightning (BOLT11) payments into your own Lightning wallet — a Spark service, LNbits, or LND-REST endpoint you control. Invoices are minted and verified server-side; the customer pays from any Lightning wallet.', 'wdk-pay' );
		$this->has_fields         = false;
		$this->supports           = array( 'products' );

		$this->icon = apply_filters( 'wdk_pay_lightning_gateway_icon', WDK_PAY_PLUGIN_URL . 'assets/img/wdk-pay-lightning-icon.png' );

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
				'label'   => __( 'Enable WDK Pay (Lightning)', 'wdk-pay' ),
				'default' => 'no',
			),
			'title'          => array(
				'title'       => __( 'Title', 'wdk-pay' ),
				'type'        => 'text',
				'description' => __( 'Payment method title shown to customers at checkout.', 'wdk-pay' ),
				'default'     => __( 'Pay with Lightning', 'wdk-pay' ),
				'desc_tip'    => true,
			),
			'description'    => array(
				'title'       => __( 'Description', 'wdk-pay' ),
				'type'        => 'textarea',
				'description' => __( 'Payment method description shown to customers at checkout.', 'wdk-pay' ),
				'default'     => __( 'Pay instantly over the Lightning Network. Scan the invoice from any Lightning wallet (including a WDK Spark wallet).', 'wdk-pay' ),
				'desc_tip'    => true,
			),
			'backend_title'  => array(
				'title'       => __( 'Lightning backend', 'wdk-pay' ),
				'type'        => 'title',
				'description' => __( 'Point the gateway at a Lightning service you control (Spark service, LNbits, LND-REST). Invoices are minted and polled server-side; the key never reaches the browser.', 'wdk-pay' ),
			),
			'ln_base_url'    => array(
				'title'       => __( 'Backend base URL', 'wdk-pay' ),
				'type'        => 'text',
				'description' => __( 'Base URL of your Lightning service. Required.', 'wdk-pay' ),
				'default'     => '',
				'placeholder' => 'https://...',
				'desc_tip'    => true,
			),
			'ln_api_key'     => array(
				'title'       => __( 'API key', 'wdk-pay' ),
				'type'        => 'password',
				'description' => __( 'Sent to your backend as an auth header. Leave blank if your endpoint needs none.', 'wdk-pay' ),
				'default'     => '',
				'desc_tip'    => true,
			),
			'ln_auth_header' => array(
				'title'       => __( 'API key header name', 'wdk-pay' ),
				'type'        => 'text',
				'description' => __( 'Header the API key is sent under (e.g. X-Api-Key or Authorization).', 'wdk-pay' ),
				'default'     => 'X-Api-Key',
				'desc_tip'    => true,
			),
			'ln_create_path' => array(
				'title'       => __( 'Create-invoice path', 'wdk-pay' ),
				'type'        => 'text',
				'description' => __( 'POST path for minting an invoice. Default /invoices.', 'wdk-pay' ),
				'default'     => '/invoices',
				'desc_tip'    => true,
			),
			'ln_status_path' => array(
				'title'       => __( 'Invoice-status path', 'wdk-pay' ),
				'type'        => 'text',
				'description' => __( 'GET path for reading an invoice; use {id} for the invoice id. Default /invoices/{id}.', 'wdk-pay' ),
				'default'     => '/invoices/{id}',
				'desc_tip'    => true,
			),
			'pricing_title'  => array(
				'title'       => __( 'Pricing', 'wdk-pay' ),
				'type'        => 'title',
				'description' => __( 'The order total is converted to satoshis at invoice time using the BTC price below. Set it to your current rate, or wire a live feed (see ROADMAP).', 'wdk-pay' ),
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
				'description'       => __( 'How long the invoice stays valid before it expires.', 'wdk-pay' ),
				'default'           => '15',
				'desc_tip'          => true,
				'custom_attributes' => array(
					'min'  => '1',
					'step' => '1',
				),
			),
			'accent'         => array(
				'title'       => __( 'Accent color', 'wdk-pay' ),
				'type'        => 'text',
				'description' => __( 'Primary button color on the invoice page. 6-digit hex (e.g. #F7931A). Leave blank for the default.', 'wdk-pay' ),
				'default'     => '#f7931a',
				'placeholder' => '#f7931a',
				'desc_tip'    => true,
			),
		);
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
				__( 'WDK Pay (Lightning): the BTC price must be a positive number.', 'wdk-pay' )
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
				__( 'WDK Pay (Lightning): the accent color must be a 6-digit hex value like #F7931A.', 'wdk-pay' )
			);
			return (string) $this->get_option( $key );
		}
		return $value;
	}

	/**
	 * Validate the backend base URL field on save.
	 *
	 * @param string $key   Field key.
	 * @param string $value Submitted value.
	 * @return string Sanitised URL.
	 */
	public function validate_ln_base_url_field( $key, $value ) {
		$value = esc_url_raw( trim( (string) $value ) );
		if ( '' !== $value && ! wp_http_validate_url( $value ) ) {
			WC_Admin_Settings::add_error(
				__( 'WDK Pay (Lightning): the backend base URL must be a valid http(s) URL.', 'wdk-pay' )
			);
		}
		return $value;
	}

	/**
	 * Resolve effective settings into a normalized array.
	 *
	 * @return array{
	 *     ln_base_url:string,
	 *     ln_api_key:string,
	 *     ln_auth_header:string,
	 *     ln_create_path:string,
	 *     ln_status_path:string,
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
			'ln_base_url'    => trim( (string) $this->get_option( 'ln_base_url', '' ) ),
			'ln_api_key'     => (string) $this->get_option( 'ln_api_key', '' ),
			'ln_auth_header' => trim( (string) $this->get_option( 'ln_auth_header', 'X-Api-Key' ) ),
			'ln_create_path' => trim( (string) $this->get_option( 'ln_create_path', '/invoices' ) ),
			'ln_status_path' => trim( (string) $this->get_option( 'ln_status_path', '/invoices/{id}' ) ),
			'btc_price'      => (float) $this->get_option( 'btc_price', 0 ),
			'payment_window' => max( 1, (int) $this->get_option( 'payment_window', 15 ) ),
			'accent'         => $accent,
		);
	}

	/**
	 * Build a Lightning backend client from the resolved settings.
	 *
	 * @return WDK_Pay_Lightning_Client|null Null when no backend URL is configured.
	 */
	public function get_client() {
		$s = $this->get_resolved_settings();
		if ( '' === $s['ln_base_url'] ) {
			return null;
		}
		return new WDK_Pay_Lightning_Client(
			array(
				'base_url'    => $s['ln_base_url'],
				'api_key'     => $s['ln_api_key'],
				'auth_header' => $s['ln_auth_header'],
				'create_path' => $s['ln_create_path'],
				'status_path' => $s['ln_status_path'],
			)
		);
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
		if ( '' === $s['ln_base_url'] || $s['btc_price'] <= 0 ) {
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
		if ( '' === $s['ln_base_url'] ) {
			$problems[] = __( 'a Lightning backend URL', 'wdk-pay' );
		}
		if ( $s['btc_price'] <= 0 ) {
			$problems[] = __( 'a BTC price for sats conversion', 'wdk-pay' );
		}
		if ( empty( $problems ) ) {
			return;
		}
		$message = sprintf(
			/* translators: %s: comma-separated list of missing settings. */
			__( 'WDK Pay (Lightning) is enabled but not fully configured. Please set %s.', 'wdk-pay' ),
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

		$order->update_status( 'pending', __( 'Awaiting Lightning payment.', 'wdk-pay' ) );
		$order->update_meta_data( WDK_Pay_Lightning_REST::META_STATUS, WDK_Pay_Lightning_Client::STATUS_PENDING );
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
	 * Render the order-pay (receipt) page: mint/reuse the invoice + show QR + poll.
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
		$client   = $this->get_client();
		if ( ! $client || $settings['btc_price'] <= 0 ) {
			echo '<p>' . esc_html__( 'Lightning payments are temporarily unavailable. Please contact the store.', 'wdk-pay' ) . '</p>';
			return;
		}

		$invoice = $this->resolve_invoice( $order, $settings, $client );
		if ( is_wp_error( $invoice ) ) {
			echo '<p>' . esc_html__( 'Could not create a Lightning invoice right now. Please try again or contact the store.', 'wdk-pay' ) . '</p>';
			return;
		}

		$this->enqueue_assets( $order, $invoice );
		$this->render_invoice( $order, $invoice, $settings );
	}

	/**
	 * Return a usable invoice for the order: reuse the stored one while it's still
	 * valid (same sats, unexpired), otherwise mint a fresh one and persist it.
	 *
	 * @param WC_Order                 $order    The order.
	 * @param array<string,mixed>      $settings Resolved settings.
	 * @param WDK_Pay_Lightning_Client $client   Backend client.
	 * @return array{id:string,bolt11:string,amount_sats:int,expires_at:int}|WP_Error
	 */
	private function resolve_invoice( $order, array $settings, WDK_Pay_Lightning_Client $client ) {
		$sats = WDK_Pay_Lightning_Client::sats_for_fiat( (string) $order->get_total(), $settings['btc_price'] );
		if ( $sats <= 0 ) {
			return new WP_Error( 'wdk_ln_amount', __( 'Order amount converts to zero satoshis.', 'wdk-pay' ) );
		}

		$stored_id    = (string) $order->get_meta( WDK_Pay_Lightning_REST::META_INVOICE_ID );
		$stored_b11   = (string) $order->get_meta( WDK_Pay_Lightning_REST::META_BOLT11 );
		$stored_exp   = (int) $order->get_meta( WDK_Pay_Lightning_REST::META_EXPIRES );
		$stored_sats  = (int) $order->get_meta( WDK_Pay_Lightning_REST::META_SATS );
		$still_valid  = '' !== $stored_id && '' !== $stored_b11 && $stored_exp > ( time() + 30 ) && $stored_sats === $sats;

		if ( $still_valid ) {
			return array(
				'id'          => $stored_id,
				'bolt11'      => $stored_b11,
				'amount_sats' => $stored_sats,
				'expires_at'  => $stored_exp,
			);
		}

		$memo    = sprintf(
			/* translators: 1: site name, 2: order number. */
			__( '%1$s — order #%2$s', 'wdk-pay' ),
			get_bloginfo( 'name' ),
			$order->get_order_number()
		);
		$invoice = $client->create_invoice( $sats, $memo, $settings['payment_window'] * 60 );
		if ( is_wp_error( $invoice ) ) {
			return $invoice;
		}

		$order->update_meta_data( WDK_Pay_Lightning_REST::META_INVOICE_ID, $invoice['id'] );
		$order->update_meta_data( WDK_Pay_Lightning_REST::META_BOLT11, $invoice['bolt11'] );
		$order->update_meta_data( WDK_Pay_Lightning_REST::META_EXPIRES, (int) $invoice['expires_at'] );
		$order->update_meta_data( WDK_Pay_Lightning_REST::META_SATS, (int) $invoice['amount_sats'] );
		$order->update_meta_data( WDK_Pay_Lightning_REST::META_STATUS, WDK_Pay_Lightning_Client::STATUS_PENDING );
		$order->save();

		return $invoice;
	}

	/**
	 * Enqueue the QR library and the inline render/poll script.
	 *
	 * @param WC_Order            $order   The order.
	 * @param array<string,mixed> $invoice Resolved invoice.
	 * @return void
	 */
	private function enqueue_assets( $order, array $invoice ) {
		wp_enqueue_script(
			'wdk-pay-qrcode',
			'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js',
			array(),
			'1.4.4',
			true
		);

		$config = array(
			'bolt11'       => (string) $invoice['bolt11'],
			'statusUrl'    => rest_url( WDK_Pay_Lightning_REST::NAMESPACE . '/lightning/status/' . rawurlencode( $order->get_order_key() ) ),
			'returnUrl'    => $order->get_checkout_order_received_url(),
			'expiresAt'    => (int) $invoice['expires_at'],
			'pollInterval' => 4000,
			'i18n'         => array(
				'copied'  => __( 'Copied', 'wdk-pay' ),
				'copy'    => __( 'Copy invoice', 'wdk-pay' ),
				'paid'    => __( 'Payment received — redirecting…', 'wdk-pay' ),
				'expired' => __( 'This invoice expired. Refresh the page to get a new one.', 'wdk-pay' ),
			),
		);

		wp_register_script( 'wdk-pay-lightning', false, array( 'wdk-pay-qrcode' ), WDK_PAY_VERSION, true );
		wp_enqueue_script( 'wdk-pay-lightning' );
		wp_add_inline_script( 'wdk-pay-lightning', 'window.WDK_PAY_LN=' . wp_json_encode( $config ) . ';' . $this->inline_script(), 'after' );
	}

	/**
	 * The browser-side renderer + poller (rendered inline, depends on qrcode-generator).
	 *
	 * @return string JavaScript source.
	 */
	private function inline_script() {
		return <<<'JS'
(function(){
  var c = window.WDK_PAY_LN; if(!c){return;}
  function ready(fn){ if(document.readyState!=='loading'){fn();} else {document.addEventListener('DOMContentLoaded',fn);} }
  ready(function(){
    var qrEl = document.getElementById('wdk-ln-qr');
    if (qrEl && typeof qrcode === 'function') {
      try { var q = qrcode(0,'M'); q.addData(String(c.bolt11).toUpperCase()); q.make(); qrEl.innerHTML = q.createImgTag(5,8); var img=qrEl.querySelector('img'); if(img){img.style.width='220px';img.style.height='220px';img.style.imageRendering='pixelated';} }
      catch(e){ qrEl.textContent = c.bolt11; }
    }
    var copyBtn = document.getElementById('wdk-ln-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', function(){
        var done = function(){ copyBtn.textContent = c.i18n.copied; setTimeout(function(){ copyBtn.textContent = c.i18n.copy; }, 1500); };
        if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(c.bolt11).then(done, done); }
        else { var t=document.getElementById('wdk-ln-bolt11'); if(t){ var r=document.createRange(); r.selectNode(t); var s=window.getSelection(); s.removeAllRanges(); s.addRange(r); try{document.execCommand('copy');}catch(e){} s.removeAllRanges(); done(); } }
      });
    }
    var note = document.getElementById('wdk-ln-note');
    var stopped = false;
    function poll(){
      if (stopped) { return; }
      if (c.expiresAt && (Date.now()/1000) > c.expiresAt + 5) { stopped = true; if(note){ note.textContent = c.i18n.expired; } return; }
      fetch(c.statusUrl, { headers: { 'Accept':'application/json' } })
        .then(function(r){ return r.json(); })
        .then(function(d){
          if (!d || stopped) { return; }
          if (d.status === 'paid') { stopped = true; if(note){ note.textContent = c.i18n.paid; } window.location.href = c.returnUrl; }
          else if (d.status === 'expired') { stopped = true; if(note){ note.textContent = c.i18n.expired; } }
        })
        .catch(function(){});
    }
    poll();
    setInterval(poll, c.pollInterval || 4000);
  });
})();
JS;
	}

	/**
	 * Render the invoice card markup (the QR + bolt11 are hydrated by the inline script).
	 *
	 * @param WC_Order            $order    The order.
	 * @param array<string,mixed> $invoice  Resolved invoice.
	 * @param array<string,mixed> $settings Resolved settings.
	 * @return void
	 */
	private function render_invoice( $order, array $invoice, array $settings ) {
		$accent     = '' !== $settings['accent'] ? $settings['accent'] : '#f7931a';
		$sats_label = WDK_Pay_Lightning_Client::format_sats( (int) $invoice['amount_sats'] );
		$fiat_label = wp_strip_all_tags( wc_price( $order->get_total(), array( 'currency' => $order->get_currency() ) ) );
		?>
		<div id="wdk-pay-ln-root" style="max-width:420px;margin:0 auto;text-align:center;font-family:inherit;">
			<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border:1px solid #e5e5e5;border-radius:12px;margin-bottom:14px;">
				<span style="opacity:.7;"><?php esc_html_e( 'Amount due', 'wdk-pay' ); ?></span>
				<strong><?php echo esc_html( $sats_label ); ?> <span style="opacity:.6;font-weight:400;">(<?php echo esc_html( $fiat_label ); ?>)</span></strong>
			</div>
			<div id="wdk-ln-qr" style="display:inline-block;background:#fff;padding:10px;border-radius:12px;border:1px solid #e5e5e5;min-height:220px;min-width:220px;"></div>
			<p style="font-size:13px;opacity:.7;margin:12px 0 6px;"><?php esc_html_e( 'Scan with any Lightning wallet, or copy the invoice.', 'wdk-pay' ); ?></p>
			<code id="wdk-ln-bolt11" style="display:block;word-break:break-all;font-size:11px;background:#f6f6f6;padding:8px 10px;border-radius:8px;"><?php echo esc_html( (string) $invoice['bolt11'] ); ?></code>
			<button type="button" id="wdk-ln-copy" style="margin-top:10px;width:100%;padding:10px 14px;border:none;border-radius:10px;cursor:pointer;font-weight:600;color:#fff;background:<?php echo esc_attr( $accent ); ?>;">
				<?php esc_html_e( 'Copy invoice', 'wdk-pay' ); ?>
			</button>
			<p id="wdk-ln-note" style="font-size:13px;opacity:.8;margin-top:12px;"><?php esc_html_e( 'Waiting for payment… this updates automatically.', 'wdk-pay' ); ?></p>
		</div>
		<?php
	}
}
