<?php
/**
 * Main plugin class.
 *
 * @package WDK_Pay
 */

// Guard against direct access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * WDK_Pay
 *
 * The plugin's singleton orchestrator. Registers the payment gateway with
 * WooCommerce, wires up the REST controller, and surfaces admin affordances
 * (settings link, configuration notices).
 *
 * @package WDK_Pay
 */
final class WDK_Pay {

	/**
	 * Singleton instance.
	 *
	 * @var WDK_Pay|null
	 */
	private static $instance = null;

	/**
	 * REST controller.
	 *
	 * @var WDK_Pay_REST
	 */
	private $rest;

	/**
	 * Retrieve (and lazily create) the singleton instance.
	 *
	 * @return WDK_Pay
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}

		return self::$instance;
	}

	/**
	 * Constructor: register all hooks.
	 */
	private function __construct() {
		$this->rest = new WDK_Pay_REST();
		$this->register_hooks();
	}

	/**
	 * Register WordPress/WooCommerce hooks.
	 *
	 * @return void
	 */
	private function register_hooks() {
		// Register the gateway with WooCommerce.
		add_filter( 'woocommerce_payment_gateways', array( $this, 'register_gateway' ) );

		// REST routes.
		add_action( 'rest_api_init', array( $this->rest, 'register_routes' ) );

		// Internationalisation.
		add_action( 'init', array( $this, 'load_textdomain' ) );

		// Admin: settings shortcut + configuration notice.
		add_filter(
			'plugin_action_links_' . plugin_basename( WDK_PAY_PLUGIN_FILE ),
			array( $this, 'plugin_action_links' )
		);
		add_action( 'admin_notices', array( $this, 'configuration_notice' ) );
	}

	/**
	 * Add the gateway class to WooCommerce's gateway registry.
	 *
	 * @param array<int,string> $gateways Registered gateway class names.
	 * @return array<int,string> Updated list.
	 */
	public function register_gateway( $gateways ) {
		$gateways[] = 'WDK_Pay_Gateway';

		return $gateways;
	}

	/**
	 * Load the plugin text domain for translations.
	 *
	 * @return void
	 */
	public function load_textdomain() {
		load_plugin_textdomain(
			'wdk-pay',
			false,
			dirname( plugin_basename( WDK_PAY_PLUGIN_FILE ) ) . '/languages'
		);
	}

	/**
	 * Add a "Settings" link to the plugin row on the Plugins screen.
	 *
	 * @param array<int,string> $links Existing action links.
	 * @return array<int,string> Updated links.
	 */
	public function plugin_action_links( $links ) {
		$settings_url = admin_url( 'admin.php?page=wc-settings&tab=checkout&section=wdk_pay' );

		$settings_link = sprintf(
			'<a href="%s">%s</a>',
			esc_url( $settings_url ),
			esc_html__( 'Settings', 'wdk-pay' )
		);

		array_unshift( $links, $settings_link );

		return $links;
	}

	/**
	 * Render a configuration notice when the gateway is enabled but incomplete.
	 *
	 * Delegates to the gateway so the validation logic lives in one place.
	 *
	 * @return void
	 */
	public function configuration_notice() {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}

		$gateway = $this->get_gateway_instance();
		if ( $gateway instanceof WDK_Pay_Gateway ) {
			$gateway->maybe_render_admin_notice();
		}
	}

	/**
	 * Resolve the live gateway instance from WooCommerce.
	 *
	 * @return WDK_Pay_Gateway|null
	 */
	private function get_gateway_instance() {
		if ( ! function_exists( 'WC' ) || ! WC()->payment_gateways() ) {
			return null;
		}

		$gateways = WC()->payment_gateways()->payment_gateways();

		if ( isset( $gateways['wdk_pay'] ) && $gateways['wdk_pay'] instanceof WDK_Pay_Gateway ) {
			return $gateways['wdk_pay'];
		}

		return null;
	}
}
