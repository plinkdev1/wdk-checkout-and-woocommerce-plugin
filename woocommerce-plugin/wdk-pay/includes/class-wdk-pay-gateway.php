<?php
/**
 * WooCommerce payment gateway.
 *
 * @package WDK_Pay
 */

// Guard against direct access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * WDK_Pay_Gateway
 *
 * A WooCommerce payment gateway that settles orders in self-custodial USDt.
 *
 * Flow:
 *   1. Customer selects "Pay with USDt" at checkout.
 *   2. process_payment() creates the order as `pending`, reduces stock, empties
 *      the cart, and redirects to the WooCommerce order-pay page.
 *   3. receipt_page() renders the mount point + config for the checkout widget.
 *   4. The widget submits the tx hash to the REST API, which verifies it
 *      on-chain and calls payment_complete().
 *
 * @package WDK_Pay
 */
class WDK_Pay_Gateway extends WC_Payment_Gateway {

	/**
	 * Constructor: wire up settings, properties, and hooks.
	 */
	public function __construct() {
		$this->id                 = 'wdk_pay';
		$this->method_title       = __( 'WDK Pay (USDt)', 'wdk-pay' );
		$this->method_description = __( 'Accept self-custodial USDt payments verified on-chain. Customers pay directly to your receiving address from a WDK-powered wallet.', 'wdk-pay' );
		$this->has_fields         = false;
		$this->supports           = array( 'products' );

		// Gateway icon shown next to the method at checkout: the WDK badge.
		$this->icon = apply_filters( 'wdk_pay_gateway_icon', WDK_PAY_PLUGIN_URL . 'assets/img/wdk-pay-icon.png' );

		// Build the settings UI and load saved values.
		$this->init_form_fields();
		$this->init_settings();

		// Surface the merchant-facing title/description from settings.
		$this->title       = $this->get_option( 'title' );
		$this->description = $this->get_option( 'description' );

		// Persist settings from the admin form.
		add_action(
			'woocommerce_update_options_payment_gateways_' . $this->id,
			array( $this, 'process_admin_options' )
		);

		// Render the widget on the order-pay (receipt) page for this gateway.
		add_action( 'woocommerce_receipt_' . $this->id, array( $this, 'receipt_page' ) );
	}

	/**
	 * Render the gateway icon at a tidy, constrained size next to the method
	 * title. Without this override WooCommerce would emit the raw (128px) image.
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
			'enabled'            => array(
				'title'   => __( 'Enable/Disable', 'wdk-pay' ),
				'type'    => 'checkbox',
				'label'   => __( 'Enable WDK Pay (USDt)', 'wdk-pay' ),
				'default' => 'no',
			),
			'title'              => array(
				'title'       => __( 'Title', 'wdk-pay' ),
				'type'        => 'text',
				'description' => __( 'Payment method title shown to customers at checkout.', 'wdk-pay' ),
				'default'     => __( 'Pay with USDt', 'wdk-pay' ),
				'desc_tip'    => true,
			),
			'description'        => array(
				'title'       => __( 'Description', 'wdk-pay' ),
				'type'        => 'textarea',
				'description' => __( 'Payment method description shown to customers at checkout.', 'wdk-pay' ),
				'default'     => __( 'Pay in USDt from your self-custodial WDK wallet. Your payment is verified on-chain.', 'wdk-pay' ),
				'desc_tip'    => true,
			),
			'receiving_address'  => array(
				'title'       => __( 'Merchant receiving address', 'wdk-pay' ),
				'type'        => 'text',
				'description' => __( 'The 0x address that will receive USDt payments. Required.', 'wdk-pay' ),
				'default'     => '',
				'placeholder' => '0x...',
				'desc_tip'    => true,
			),
			'chain'              => array(
				'title'       => __( 'Settlement chain', 'wdk-pay' ),
				'type'        => 'select',
				'description' => __( 'The EVM chain on which payments are made and verified.', 'wdk-pay' ),
				'default'     => 'ethereum',
				'options'     => WDK_Pay_Chains::options(),
				'desc_tip'    => true,
			),
			'asset'              => array(
				'title'       => __( 'Accepted asset', 'wdk-pay' ),
				'type'        => 'select',
				'description' => __( 'The Tether asset customers pay with. XAUt (Tether Gold) settles on Ethereum; on chains where the selected asset is not deployed, the gateway falls back to USDt.', 'wdk-pay' ),
				'default'     => 'usdt',
				'options'     => WDK_Pay_Chains::asset_options(),
				'desc_tip'    => true,
			),
			'token_address'      => array(
				'title'       => __( 'Token address (override)', 'wdk-pay' ),
				'type'        => 'text',
				'description' => __( 'Optional. Override the contract address for the selected chain/asset. Leave blank to use the built-in default.', 'wdk-pay' ),
				'default'     => '',
				'placeholder' => __( 'Defaults to the chain’s asset contract', 'wdk-pay' ),
				'desc_tip'    => true,
			),
			'rpc_url'            => array(
				'title'       => __( 'RPC URL', 'wdk-pay' ),
				'type'        => 'text',
				'description' => __( 'JSON-RPC endpoint used to verify payments on-chain (e.g. an Infura/Alchemy/self-hosted node URL). Required.', 'wdk-pay' ),
				'default'     => '',
				'placeholder' => 'https://...',
				'desc_tip'    => true,
			),
			'confirmations'      => array(
				'title'             => __( 'Required confirmations', 'wdk-pay' ),
				'type'              => 'number',
				'description'       => __( 'Number of block confirmations required before an order is marked paid.', 'wdk-pay' ),
				'default'           => '1',
				'desc_tip'          => true,
				'custom_attributes' => array(
					'min'  => '1',
					'step' => '1',
				),
			),
			'payment_window'     => array(
				'title'             => __( 'Payment window (minutes)', 'wdk-pay' ),
				'type'              => 'number',
				'description'       => __( 'How long the customer has to complete payment before the intent expires.', 'wdk-pay' ),
				'default'           => '30',
				'desc_tip'          => true,
				'custom_attributes' => array(
					'min'  => '1',
					'step' => '1',
				),
			),
			'pricing_note'       => array(
				'title'       => __( 'Prices are denominated in USDt', 'wdk-pay' ),
				'type'        => 'checkbox',
				'label'       => __( 'My store prices are 1:1 with USDt', 'wdk-pay' ),
				'description' => __( 'Informational. This plugin assumes the order total maps 1:1 to USDt (6 decimals). Keep your store currency aligned with USD/USDt so the amount charged on-chain matches the cart total.', 'wdk-pay' ),
				'default'     => 'yes',
				'desc_tip'    => false,
			),
			'gasless_eip3009'    => array(
				'title'       => __( 'Gasless (EIP-3009)', 'wdk-pay' ),
				'type'        => 'checkbox',
				'label'       => __( 'Advertise gasless transferWithAuthorization support', 'wdk-pay' ),
				'description' => __( 'Informational toggle passed to the checkout widget. When enabled, the widget may offer EIP-3009 gasless USDt transfers where supported. Verification is identical (an on-chain Transfer is still produced).', 'wdk-pay' ),
				'default'     => 'no',
				'desc_tip'    => false,
			),
			'appearance_title'   => array(
				'title'       => __( 'Checkout appearance', 'wdk-pay' ),
				'type'        => 'title',
				'description' => __( 'Match the payment widget to your storefront. Colors are 6-digit hex (e.g. #F4642F); leave a color blank to use the WDK default.', 'wdk-pay' ),
			),
			'brand_name'         => array(
				'title'       => __( 'Brand name', 'wdk-pay' ),
				'type'        => 'text',
				'description' => __( 'Optional store name shown atop the checkout widget (next to the logo).', 'wdk-pay' ),
				'default'     => '',
				'desc_tip'    => true,
			),
			'brand_logo'         => array(
				'title'       => __( 'Brand logo', 'wdk-pay' ),
				'type'        => 'wdk_media',
				'description' => __( 'Optional logo shown atop the checkout widget. Pick from your media library or paste an image URL.', 'wdk-pay' ),
				'default'     => '',
				'placeholder' => 'https://…',
				'desc_tip'    => true,
			),
			'theme_accent'       => array(
				'title'       => __( 'Accent / button color', 'wdk-pay' ),
				'type'        => 'wdk_color',
				'description' => __( 'Primary buttons and highlights.', 'wdk-pay' ),
				'default'     => '#f4642f',
				'placeholder' => '#f4642f',
				'desc_tip'    => true,
			),
			'theme_accent_text'  => array(
				'title'       => __( 'Accent text color', 'wdk-pay' ),
				'type'        => 'wdk_color',
				'description' => __( 'Text/icon color on the accent buttons.', 'wdk-pay' ),
				'default'     => '#ffffff',
				'placeholder' => '#ffffff',
				'desc_tip'    => true,
			),
			'theme_surface'      => array(
				'title'       => __( 'Surface (card) color', 'wdk-pay' ),
				'type'        => 'wdk_color',
				'description' => __( 'Background of the amount card inside the widget.', 'wdk-pay' ),
				'default'     => '#161312',
				'placeholder' => '#161312',
				'desc_tip'    => true,
			),
			'theme_on_surface'   => array(
				'title'       => __( 'Surface text color', 'wdk-pay' ),
				'type'        => 'wdk_color',
				'description' => __( 'Text color shown on the surface/card.', 'wdk-pay' ),
				'default'     => '#f7eee8',
				'placeholder' => '#f7eee8',
				'desc_tip'    => true,
			),
			'theme_radius'       => array(
				'title'       => __( 'Corner style', 'wdk-pay' ),
				'type'        => 'select',
				'description' => __( 'Roundness of the checkout card and buttons.', 'wdk-pay' ),
				'default'     => 'rounded',
				'options'     => array(
					'sharp'   => __( 'Sharp (4px)', 'wdk-pay' ),
					'soft'    => __( 'Soft (10px)', 'wdk-pay' ),
					'rounded' => __( 'Rounded (14px)', 'wdk-pay' ),
					'pill'    => __( 'Pill (22px)', 'wdk-pay' ),
				),
				'desc_tip'    => true,
			),
		);
	}

	/**
	 * Render a color field: a native color picker bound to a hex text input.
	 *
	 * Registered as form-field type `wdk_color`. Self-contained (no enqueued
	 * admin script, no dependency on WooCommerce's optional color type): the
	 * text input is the saved value, the swatch is a visual aid, and the two
	 * stay in sync via minimal inline handlers.
	 *
	 * @param string              $key  Field key.
	 * @param array<string,mixed> $data Field definition.
	 * @return string Field HTML (a settings table row).
	 */
	public function generate_wdk_color_html( $key, $data ) {
		$field_key = $this->get_field_key( $key );
		$defaults  = array(
			'title'       => '',
			'class'       => '',
			'placeholder' => '',
			'desc_tip'    => false,
			'description' => '',
			'default'     => '',
		);
		$data      = wp_parse_args( $data, $defaults );
		$value     = $this->get_option( $key, $data['default'] );
		$swatch_id = $field_key . '_swatch';

		ob_start();
		?>
		<tr valign="top">
			<th scope="row" class="titledesc">
				<label for="<?php echo esc_attr( $field_key ); ?>"><?php echo wp_kses_post( $data['title'] ); ?> <?php echo $this->get_tooltip_html( $data ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></label>
			</th>
			<td class="forminp">
				<fieldset>
					<legend class="screen-reader-text"><span><?php echo wp_kses_post( $data['title'] ); ?></span></legend>
					<input
						type="color"
						id="<?php echo esc_attr( $swatch_id ); ?>"
						value="<?php echo esc_attr( '' !== $value ? $value : ( $data['default'] ? $data['default'] : '#000000' ) ); ?>"
						style="width:42px;height:30px;vertical-align:middle;padding:0;border:1px solid #ddd;border-radius:4px;cursor:pointer;"
						oninput="var t=document.getElementById('<?php echo esc_js( $field_key ); ?>');if(t){t.value=this.value;}" />
					<input
						class="input-text regular-input <?php echo esc_attr( $data['class'] ); ?>"
						type="text"
						name="<?php echo esc_attr( $field_key ); ?>"
						id="<?php echo esc_attr( $field_key ); ?>"
						style="width:120px;vertical-align:middle;font-family:monospace;margin-left:6px;"
						value="<?php echo esc_attr( $value ); ?>"
						placeholder="<?php echo esc_attr( $data['placeholder'] ); ?>"
						oninput="var s=document.getElementById('<?php echo esc_js( $swatch_id ); ?>');if(s&&/^#[0-9A-Fa-f]{6}$/.test(this.value)){s.value=this.value;}" />
					<?php echo $this->get_description_html( $data ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
				</fieldset>
			</td>
		</tr>
		<?php
		return ob_get_clean();
	}

	/**
	 * Validate/sanitize a `wdk_color` field on save: require 6-digit hex.
	 *
	 * An empty value is allowed (the widget falls back to the WDK default).
	 * Invalid input is rejected with an admin error and the prior value kept.
	 *
	 * @param string $key   Field key.
	 * @param string $value Submitted value.
	 * @return string Sanitised hex color, or '' to use the default.
	 */
	public function validate_wdk_color_field( $key, $value ) {
		$value = trim( sanitize_text_field( (string) $value ) );

		if ( '' === $value ) {
			return '';
		}

		if ( ! preg_match( '/^#[0-9A-Fa-f]{6}$/', $value ) ) {
			WC_Admin_Settings::add_error(
				__( 'WDK Pay: checkout colors must be a 6-digit hex value like #F4642F.', 'wdk-pay' )
			);
			return (string) $this->get_option( $key );
		}

		return $value;
	}

	/**
	 * Ensure the WordPress media library is available on the gateway settings
	 * screen (so the brand-logo picker can open it), then render the form.
	 *
	 * @return void
	 */
	public function admin_options() {
		wp_enqueue_media();
		parent::admin_options();
	}

	/**
	 * Render a media field: a URL text input, a "Select image" button that opens
	 * the WordPress media library, and a small live preview. Registered as
	 * form-field type `wdk_media`. Self-contained — the inline handlers drive
	 * `wp.media` (loaded via admin_options()).
	 *
	 * @param string              $key  Field key.
	 * @param array<string,mixed> $data Field definition.
	 * @return string Field HTML (a settings table row).
	 */
	public function generate_wdk_media_html( $key, $data ) {
		$field_key = $this->get_field_key( $key );
		$defaults  = array(
			'title'       => '',
			'class'       => '',
			'placeholder' => '',
			'desc_tip'    => false,
			'description' => '',
			'default'     => '',
		);
		$data      = wp_parse_args( $data, $defaults );
		$value     = (string) $this->get_option( $key, $data['default'] );
		$preview   = $field_key . '_preview';

		ob_start();
		?>
		<tr valign="top">
			<th scope="row" class="titledesc">
				<label for="<?php echo esc_attr( $field_key ); ?>"><?php echo wp_kses_post( $data['title'] ); ?> <?php echo $this->get_tooltip_html( $data ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></label>
			</th>
			<td class="forminp">
				<fieldset>
					<legend class="screen-reader-text"><span><?php echo wp_kses_post( $data['title'] ); ?></span></legend>
					<input
						class="input-text regular-input <?php echo esc_attr( $data['class'] ); ?>"
						type="text"
						name="<?php echo esc_attr( $field_key ); ?>"
						id="<?php echo esc_attr( $field_key ); ?>"
						style="width:320px;vertical-align:middle;"
						value="<?php echo esc_attr( $value ); ?>"
						placeholder="<?php echo esc_attr( $data['placeholder'] ); ?>"
						oninput="var p=document.getElementById('<?php echo esc_js( $preview ); ?>');if(p){p.src=this.value;p.style.display=this.value?'inline-block':'none';}" />
					<button
						type="button"
						class="button"
						style="vertical-align:middle;margin-left:6px;"
						onclick="(function(input,prev){if(!window.wp||!wp.media){return;}var f=wp.media({title:'<?php echo esc_js( __( 'Select brand logo', 'wdk-pay' ) ); ?>',multiple:false,library:{type:'image'}});f.on('select',function(){var a=f.state().get('selection').first().toJSON();input.value=a.url;prev.src=a.url;prev.style.display='inline-block';});f.open();})(document.getElementById('<?php echo esc_js( $field_key ); ?>'),document.getElementById('<?php echo esc_js( $preview ); ?>'));return false;">
						<?php esc_html_e( 'Select image', 'wdk-pay' ); ?>
					</button>
					<br />
					<img id="<?php echo esc_attr( $preview ); ?>" src="<?php echo esc_url( $value ); ?>" alt="" style="max-height:40px;width:auto;margin-top:8px;border-radius:6px;display:<?php echo $value ? 'inline-block' : 'none'; ?>;" />
					<?php echo $this->get_description_html( $data ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
				</fieldset>
			</td>
		</tr>
		<?php
		return ob_get_clean();
	}

	/**
	 * Validate/sanitize a `wdk_media` field on save: an http(s) image URL or blank.
	 *
	 * @param string $key   Field key.
	 * @param string $value Submitted value.
	 * @return string Sanitised URL, or '' when cleared.
	 */
	public function validate_wdk_media_field( $key, $value ) {
		$value = esc_url_raw( trim( (string) $value ) );
		if ( '' !== $value && ! wp_http_validate_url( $value ) ) {
			WC_Admin_Settings::add_error(
				__( 'WDK Pay: the brand logo must be a valid image URL.', 'wdk-pay' )
			);
			return (string) $this->get_option( $key );
		}
		return $value;
	}

	/**
	 * Resolve the merchant's checkout-appearance settings into a CheckoutTheme
	 * partial (the JS widget merges it over its DEFAULT_CHECKOUT_THEME).
	 *
	 * Only keys the merchant actually set are returned for the colors; the
	 * corner radius always resolves (to a px string) from the select.
	 *
	 * @return array<string,string> Partial CheckoutTheme (camelCase keys).
	 */
	private function resolve_theme() {
		$radius_map = array(
			'sharp'   => '4px',
			'soft'    => '10px',
			'rounded' => '14px',
			'pill'    => '22px',
		);
		$radius_key = (string) $this->get_option( 'theme_radius', 'rounded' );
		$radius     = isset( $radius_map[ $radius_key ] ) ? $radius_map[ $radius_key ] : '14px';

		$theme = array();
		$map   = array(
			'theme_accent'      => 'accent',
			'theme_accent_text' => 'accentText',
			'theme_surface'     => 'surface',
			'theme_on_surface'  => 'onSurface',
		);
		foreach ( $map as $option_key => $theme_key ) {
			$val = trim( (string) $this->get_option( $option_key, '' ) );
			if ( '' !== $val && preg_match( '/^#[0-9A-Fa-f]{6}$/', $val ) ) {
				$theme[ $theme_key ] = $val;
			}
		}
		$theme['radius'] = $radius;

		return $theme;
	}

	/**
	 * Resolve effective settings into a normalized array.
	 *
	 * Centralises defaulting (e.g. token address falling back to the chain
	 * default) so the gateway, intent, and REST layers agree.
	 *
	 * @return array{
	 *     receiving_address:string,
	 *     chain:string,
	 *     asset:string,
	 *     token_address:string,
	 *     rpc_url:string,
	 *     confirmations:int,
	 *     payment_window:int,
	 *     gasless:bool,
	 *     pricing_note:bool,
	 *     theme:array<string,string>
	 * }
	 */
	public function get_resolved_settings() {
		$chain = (string) $this->get_option( 'chain', 'ethereum' );
		if ( ! WDK_Pay_Chains::is_supported( $chain ) ) {
			$chain = 'ethereum';
		}

		$asset_key = (string) $this->get_option( 'asset', 'usdt' );
		$asset     = WDK_Pay_Chains::asset( $chain, $asset_key );

		$token_override = trim( (string) $this->get_option( 'token_address', '' ) );
		if ( '' !== $token_override ) {
			$token_address = $token_override;
		} elseif ( $asset && ! empty( $asset['token'] ) ) {
			$token_address = (string) $asset['token'];
		} else {
			$token_address = WDK_Pay_Chains::token_for( $chain );
		}

		return array(
			'receiving_address' => trim( (string) $this->get_option( 'receiving_address', '' ) ),
			'chain'             => $chain,
			'asset'             => $asset_key,
			'token_address'     => $token_address,
			'rpc_url'           => trim( (string) $this->get_option( 'rpc_url', '' ) ),
			'confirmations'     => max( 1, (int) $this->get_option( 'confirmations', 1 ) ),
			'payment_window'    => max( 1, (int) $this->get_option( 'payment_window', 30 ) ),
			'gasless'           => 'yes' === $this->get_option( 'gasless_eip3009', 'no' ),
			'pricing_note'      => 'yes' === $this->get_option( 'pricing_note', 'yes' ),
			'theme'             => $this->resolve_theme(),
			'brand'             => $this->resolve_brand(),
		);
	}

	/**
	 * Resolve the merchant's brand settings (logo + name) into a CheckoutBrand
	 * partial for the widget. Returns an empty array when nothing is set, so the
	 * widget renders no brand header.
	 *
	 * @return array<string,string> Partial CheckoutBrand (`name` / `logoUrl`).
	 */
	private function resolve_brand() {
		$brand = array();
		$name  = trim( (string) $this->get_option( 'brand_name', '' ) );
		$logo  = esc_url_raw( trim( (string) $this->get_option( 'brand_logo', '' ) ) );
		if ( '' !== $name ) {
			$brand['name'] = $name;
		}
		if ( '' !== $logo ) {
			$brand['logoUrl'] = $logo;
		}
		return $brand;
	}

	/**
	 * Validate and sanitize the receiving address admin field on save.
	 *
	 * @param string $key   Field key.
	 * @param string $value Submitted value.
	 * @return string Sanitised address.
	 */
	public function validate_receiving_address_field( $key, $value ) {
		$value = sanitize_text_field( (string) $value );
		$norm  = WDK_Pay_Verifier::normalize_address( $value );

		if ( '' !== $value && '' === $norm ) {
			WC_Admin_Settings::add_error(
				__( 'WDK Pay: the merchant receiving address must be a valid 0x EVM address.', 'wdk-pay' )
			);
		}

		return $value;
	}

	/**
	 * Validate and sanitize the token address override admin field on save.
	 *
	 * @param string $key   Field key.
	 * @param string $value Submitted value.
	 * @return string Sanitised address.
	 */
	public function validate_token_address_field( $key, $value ) {
		$value = sanitize_text_field( (string) $value );
		$norm  = WDK_Pay_Verifier::normalize_address( $value );

		if ( '' !== $value && '' === $norm ) {
			WC_Admin_Settings::add_error(
				__( 'WDK Pay: the USDt token address override must be a valid 0x EVM address.', 'wdk-pay' )
			);
		}

		return $value;
	}

	/**
	 * Validate and sanitize the RPC URL admin field on save.
	 *
	 * @param string $key   Field key.
	 * @param string $value Submitted value.
	 * @return string Sanitised URL.
	 */
	public function validate_rpc_url_field( $key, $value ) {
		$value = esc_url_raw( trim( (string) $value ) );

		if ( '' !== $value && ! wp_http_validate_url( $value ) ) {
			WC_Admin_Settings::add_error(
				__( 'WDK Pay: the RPC URL must be a valid http(s) URL.', 'wdk-pay' )
			);
		}

		return $value;
	}

	/**
	 * Determine whether the gateway is available for use at checkout.
	 *
	 * Requires a valid receiving address and an RPC URL in addition to the
	 * standard "enabled" flag.
	 *
	 * @return bool True when the gateway can be offered.
	 */
	public function is_available() {
		if ( 'yes' !== $this->get_option( 'enabled' ) ) {
			return false;
		}

		$settings = $this->get_resolved_settings();

		if ( '' === WDK_Pay_Verifier::normalize_address( $settings['receiving_address'] ) ) {
			return false;
		}

		if ( '' === $settings['rpc_url'] ) {
			return false;
		}

		if ( '' === WDK_Pay_Verifier::normalize_address( $settings['token_address'] ) ) {
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

		$settings = $this->get_resolved_settings();
		$problems = array();

		if ( '' === WDK_Pay_Verifier::normalize_address( $settings['receiving_address'] ) ) {
			$problems[] = __( 'a valid merchant receiving address', 'wdk-pay' );
		}
		if ( '' === $settings['rpc_url'] ) {
			$problems[] = __( 'an RPC URL for on-chain verification', 'wdk-pay' );
		}

		if ( empty( $problems ) ) {
			return;
		}

		$message = sprintf(
			/* translators: %s: comma-separated list of missing settings. */
			__( 'WDK Pay is enabled but not fully configured. Please set %s.', 'wdk-pay' ),
			implode( __( ' and ', 'wdk-pay' ), $problems )
		);

		printf(
			'<div class="notice notice-warning"><p>%s</p></div>',
			esc_html( $message )
		);
	}

	/**
	 * Process the checkout for an order.
	 *
	 * Marks the order pending, reduces stock, empties the cart, and redirects to
	 * the order-pay page where the widget is rendered.
	 *
	 * @param int $order_id The order ID.
	 * @return array{result:string,redirect:string}|void Result array on success.
	 */
	public function process_payment( $order_id ) {
		$order = wc_get_order( $order_id );

		if ( ! $order instanceof WC_Order ) {
			wc_add_notice( __( 'Unable to process payment: order not found.', 'wdk-pay' ), 'error' );
			return;
		}

		// Mark as pending payment; the order-pay page will host the widget.
		$order->update_status( 'pending', __( 'Awaiting USDt payment.', 'wdk-pay' ) );

		// Seed payment status meta so polling has a value immediately.
		$order->update_meta_data( WDK_Pay_REST::META_STATUS, WDK_Pay_Verifier::PENDING );
		$order->save();

		// Reduce stock now that an order is committed.
		wc_reduce_stock_levels( $order_id );

		// Empty the cart so the customer can re-shop if they abandon payment.
		if ( function_exists( 'WC' ) && WC()->cart ) {
			WC()->cart->empty_cart();
		}

		return array(
			'result'   => 'success',
			'redirect' => $order->get_checkout_payment_url( true ),
		);
	}

	/**
	 * Render the order-pay (receipt) page: the widget mount point + config.
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

		// Already paid? Tell the customer and stop — no need to mount the widget.
		if ( $order->is_paid() ) {
			echo '<p>' . esc_html__( 'This order has already been paid. Thank you!', 'wdk-pay' ) . '</p>';
			return;
		}

		$settings = $this->get_resolved_settings();

		// Defensive: never render a widget we cannot verify against.
		if ( '' === WDK_Pay_Verifier::normalize_address( $settings['receiving_address'] ) || '' === $settings['rpc_url'] ) {
			echo '<p>' . esc_html__( 'USDt payments are temporarily unavailable. Please contact the store.', 'wdk-pay' ) . '</p>';
			return;
		}

		$config = $this->build_widget_config( $order, $settings );

		$this->enqueue_widget_assets( $config );

		// The mount point the widget hydrates into.
		echo '<div id="wdk-pay-root" data-wdk-pay="1"></div>';
	}

	/**
	 * Enqueue the checkout widget and its dependencies, and localize config.
	 *
	 * @param array<string,mixed> $config The WDK_PAY config object.
	 * @return void
	 */
	private function enqueue_widget_assets( array $config ) {
		// ethers.js (UMD) from CDN as a dependency of the widget.
		wp_enqueue_script(
			'ethers',
			'https://cdnjs.cloudflare.com/ajax/libs/ethers/6.13.2/ethers.umd.min.js',
			array(),
			'6.13.2',
			true
		);

		// The checkout widget itself (provided separately by the JS engineer).
		wp_enqueue_script(
			'wdk-pay-checkout',
			plugins_url( 'assets/js/wdk-checkout.js', WDK_PAY_PLUGIN_FILE ),
			array( 'ethers' ),
			WDK_PAY_VERSION,
			true
		);

		// Hand the widget its configuration as window.WDK_PAY.
		wp_localize_script( 'wdk-pay-checkout', 'WDK_PAY', $config );
	}

	/**
	 * Build the window.WDK_PAY config object for the widget.
	 *
	 * The structure here is a hard contract with the JS widget — keep it stable.
	 *
	 * @param WC_Order            $order    The order being paid.
	 * @param array<string,mixed> $settings Resolved gateway settings.
	 * @return array<string,mixed> Config object.
	 */
	private function build_widget_config( $order, array $settings ) {
		$intent = ( new WDK_Pay_Intent( $order, $settings ) )->to_array();

		$config = array(
			'intent'    => $intent,
			'endpoints' => array(
				'confirm' => rest_url( WDK_Pay_REST::NAMESPACE . '/confirm' ),
				'status'  => rest_url( WDK_Pay_REST::NAMESPACE . '/status/' . rawurlencode( $order->get_order_key() ) ),
			),
			'nonce'     => wp_create_nonce( 'wp_rest' ),
			'returnUrl' => $order->get_checkout_order_received_url(),
			'options'   => array(
				'gasless'      => (bool) $settings['gasless'],
				'pollInterval' => 5000,
			),
		);

		// Merchant-chosen palette (CheckoutTheme partial). Only attach when set,
		// so the widget keeps its WDK default when the merchant changed nothing.
		if ( ! empty( $settings['theme'] ) ) {
			$config['theme'] = $settings['theme'];
		}

		// Merchant brand (logo + name) — only attach when set so the widget renders
		// no header by default.
		if ( ! empty( $settings['brand'] ) ) {
			$config['brand'] = $settings['brand'];
		}

		return $config;
	}
}
