<?php
/**
 * Plugin Name: Sarraf Ops Payment Gateway for WooCommerce
 * Plugin URI: https://sarraf.ops
 * Description: بوابة دفع صرّاف الإلكترونية لربط محافظ فودافون كاش، إنستاباي، أورانج كاش، وإي آند كاش مع المتاجر الإلكترونية مع تأكيد فوري آلي.
 * Version: 1.0.0
 * Author: Sarraf Ops Engine
 * Text Domain: sarraf-ops
 * Domain Path: /languages
 *
 * @package SarrafOps
 */

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}

add_action('plugins_loaded', 'init_sarraf_gateway_class');

function init_sarraf_gateway_class() {
    class WC_Gateway_Sarraf extends WC_Payment_Gateway {

        public function __construct() {
            $this->id = 'sarraf_pay';
            $this->icon = apply_filters('woocommerce_sarraf_icon', '');
            $this->has_fields = false;
            $this->method_title = __('صرّاف (فودافون كاش، إنستاباي، محافظ مصر)', 'sarraf-ops');
            $this->method_description = __('بوابة دفع مؤتمتة تقبل فودافون كاش وإنستاباي مع مطابقة وتأكيد فوري للطلبات بدون مراجعة يدوية.', 'sarraf-ops');

            $this->supports = array(
                'products'
            );

            // Load form fields
            $this->init_form_fields();
            $this->init_settings();

            // Define user settings
            $this->title = $this->get_option('title', 'فودافون كاش / إنستاباي (آلي عبر صرّاف)');
            $this->description = $this->get_option('description', 'ادفع بأمان عبر فودافون كاش، إنستاباي، أو المحافظ الإلكترونية. سيتم تأكيد طلبك تلقائياً خلال ثوانٍ.');
            $this->enabled = $this->get_option('enabled');
            $this->testmode = 'yes' === $this->get_option('testmode');
            $this->gateway_url = rtrim($this->get_option('gateway_url', 'https://sarraf.yourdomain.com'), '/');
            $this->public_key = $this->get_option('public_key');
            $this->secret_key = $this->get_option('secret_key');

            // Action hooks
            add_action('woocommerce_update_options_payment_gateways_' . $this->id, array($this, 'process_admin_options'));
            add_action('woocommerce_api_sarraf_webhook', array($this, 'handle_sarraf_webhook'));
        }

        public function init_form_fields() {
            $this->form_fields = array(
                'enabled' => array(
                    'title'       => __('تفعيل / تعطيل', 'sarraf-ops'),
                    'label'       => __('تفعيل بوابة دفع صرّاف', 'sarraf-ops'),
                    'type'        => 'checkbox',
                    'description' => '',
                    'default'     => 'yes'
                ),
                'title' => array(
                    'title'       => __('عنوان وسيلة الدفع للعملاء', 'sarraf-ops'),
                    'type'        => 'text',
                    'description' => __('العنوان الذي يراه العميل في صفحة إتمام الطلب (Checkout).', 'sarraf-ops'),
                    'default'     => 'فودافون كاش / إنستاباي (تأكيد فوري عبر صرّاف)',
                    'desc_tip'    => true,
                ),
                'description' => array(
                    'title'       => __('وصف وسيلة الدفع', 'sarraf-ops'),
                    'type'        => 'textarea',
                    'description' => __('الوصف الإرشادي للعميل في صفحة الدفع.', 'sarraf-ops'),
                    'default'     => 'ادفع بسهولة عبر فودافون كاش، إنستاباي، أو المحفظة الذكية الخاصة بك. بعد الضغط على تأكيد الطلب، ستظهر لك بيانات التحويل وسيتم تأكيد طلبك آلياً.',
                ),
                'gateway_url' => array(
                    'title'       => __('رابط خادم صرّاف (Gateway URL)', 'sarraf-ops'),
                    'type'        => 'text',
                    'description' => __('عنوان خادم صرّاف الخاص بك (مثال: https://app.sarraf.com).', 'sarraf-ops'),
                    'default'     => 'https://app.sarraf.com',
                ),
                'public_key' => array(
                    'title'       => __('المفتاح العام (Public Key)', 'sarraf-ops'),
                    'type'        => 'text',
                    'description' => __('يبدأ بـ pk_live_ أو pk_test_ وموجود في لوحة صرّاف > الربط والمتاجر.', 'sarraf-ops'),
                ),
                'secret_key' => array(
                    'title'       => __('المفتاح السري (Secret Key)', 'sarraf-ops'),
                    'type'        => 'password',
                    'description' => __('يبدأ بـ sk_live_ أو sk_test_ وموجود في لوحة صرّاف > الربط والمتاجر.', 'sarraf-ops'),
                ),
                'testmode' => array(
                    'title'       => __('وضع الاختبار (Sandbox)', 'sarraf-ops'),
                    'label'       => __('تفعيل الوضع التجريبي لاختبار الدفع بدون تحويلات حقيقية', 'sarraf-ops'),
                    'type'        => 'checkbox',
                    'default'     => 'no',
                ),
            );
        }

        public function process_payment($order_id) {
            $order = wc_get_order($order_id);

            if (!$order) {
                wc_add_notice(__('تعذر العثور على الطلب.', 'sarraf-ops'), 'error');
                return array('result' => 'fail');
            }

            $endpoint = $this->gateway_url . '/api/v1/checkout/sessions';
            $webhook_url = add_query_arg('wc-api', 'sarraf_webhook', home_url('/'));
            $return_url = $this->get_return_url($order);
            $cancel_url = $order->get_cancel_order_url();

            $body = array(
                'order_id'       => (string) $order->get_order_number(),
                'amount'         => floatval($order->get_total()),
                'currency'       => 'EGP',
                'customer_name'  => trim($order->get_billing_first_name() . ' ' . $order->get_billing_last_name()),
                'customer_phone' => $order->get_billing_phone(),
                'customer_email' => $order->get_billing_email(),
                'mode'           => $this->testmode ? 'test' : 'live',
                'return_url'     => $return_url,
                'cancel_url'     => $cancel_url,
                'webhook_url'    => $webhook_url,
                'metadata'       => array(
                    'wc_order_id'  => $order_id,
                    'store_url'    => home_url(),
                    'billing_city' => $order->get_billing_city(),
                ),
            );

            $response = wp_remote_post($endpoint, array(
                'method'    => 'POST',
                'timeout'   => 20,
                'headers'   => array(
                    'Content-Type'  => 'application/json',
                    'Authorization' => 'Bearer ' . trim($this->secret_key),
                    'X-Public-Key'  => trim($this->public_key),
                ),
                'body'      => wp_json_encode($body),
            ));

            if (is_wp_error($response)) {
                wc_add_notice(__('حدث خطأ أثناء الاتصال ببوابة الدفع: ', 'sarraf-ops') . $response->get_error_message(), 'error');
                return array('result' => 'fail');
            }

            $status_code = wp_remote_retrieve_response_code($response);
            $response_body = json_decode(wp_remote_retrieve_body($response), true);

            if ($status_code !== 200 && $status_code !== 201) {
                $err_msg = isset($response_body['message']) ? $response_body['message'] : __('فشل إنشاء جلسة الدفع.', 'sarraf-ops');
                wc_add_notice($err_msg, 'error');
                return array('result' => 'fail');
            }

            $checkout_url = isset($response_body['checkoutUrl']) ? $response_body['checkoutUrl'] : '';
            if (empty($checkout_url)) {
                wc_add_notice(__('لم يتم استلام رابط الدفع من الخادم.', 'sarraf-ops'), 'error');
                return array('result' => 'fail');
            }

            // If checkout_url is relative, append base URL
            if (strpos($checkout_url, 'http') !== 0) {
                $checkout_url = $this->gateway_url . $checkout_url;
            }

            // Mark order as pending payment
            $order->update_status('pending', __('في انتظار إتمام العميل للتحويل عبر بوابة صرّاف.', 'sarraf-ops'));

            // Clear cart
            WC()->cart->empty_cart();

            return array(
                'result'   => 'success',
                'redirect' => $checkout_url,
            );
        }

        public function handle_sarraf_webhook() {
            $raw_input = file_get_contents('php://input');
            $data = json_decode($raw_input, true);

            if (empty($data)) {
                status_header(400);
                echo wp_json_encode(array('error' => 'EMPTY_BODY'));
                exit;
            }

            $event = isset($data['event']) ? $data['event'] : '';
            if ($event !== 'payment.confirmed' && $event !== 'checkout.session.completed') {
                status_header(200);
                echo wp_json_encode(array('status' => 'ignored', 'event' => $event));
                exit;
            }

            $order_number = isset($data['order_id']) ? $data['order_id'] : '';
            $wc_order_id = isset($data['metadata']['wc_order_id']) ? $data['metadata']['wc_order_id'] : null;

            $order = null;
            if ($wc_order_id) {
                $order = wc_get_order($wc_order_id);
            }
            if (!$order && $order_number) {
                $order_id_from_number = wc_get_order_id_by_order_number($order_number);
                if ($order_id_from_number) {
                    $order = wc_get_order($order_id_from_number);
                }
            }

            if (!$order) {
                status_header(404);
                echo wp_json_encode(array('error' => 'ORDER_NOT_FOUND', 'order_id' => $order_number));
                exit;
            }

            $trx_id = isset($data['external_trx_id']) ? $data['external_trx_id'] : (isset($data['transaction_id']) ? $data['transaction_id'] : 'CONFIRMED');
            $provider = isset($data['provider']) ? $data['provider'] : 'Sarraf';
            $amount = isset($data['amount']) ? $data['amount'] : $order->get_total();

            // Complete payment and transition order to Processing
            $order->payment_complete($trx_id);
            $order->add_order_note(sprintf(
                __('تم تأكيد الدفع آلياً بنجاح عبر صرّاف! الوسيلة: %s | رقم المعاملة: %s | المبلغ: %s ج.م', 'sarraf-ops'),
                $provider,
                $trx_id,
                $amount
            ));

            status_header(200);
            echo wp_json_encode(array(
                'status'   => 'success',
                'order_id' => $order->get_id(),
                'received' => true,
            ));
            exit;
        }
    }
}

function add_sarraf_gateway_to_woocommerce($gateways) {
    $gateways[] = 'WC_Gateway_Sarraf';
    return $gateways;
}
add_filter('woocommerce_payment_gateways', 'add_sarraf_gateway_to_woocommerce');
