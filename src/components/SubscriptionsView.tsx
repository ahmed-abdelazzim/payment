import React, { useState, useEffect } from 'react';
import { CurrentSubscription, SubscriptionPlan, SubscriptionOrder, SubscriptionReceipt } from '../types';
import { ReceiptModal } from './ReceiptModal';
import { apiFetch } from '../api';

interface SubscriptionsViewProps {
  language: 'en' | 'ar';
  onNavigateToTab?: (tab: string) => void;
  showToast: (msg: string) => void;
}

export const SubscriptionsView: React.FC<SubscriptionsViewProps> = ({
  language,
  onNavigateToTab,
  showToast,
}) => {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [currentSub, setCurrentSub] = useState<CurrentSubscription | null>(null);
  const [orders, setOrders] = useState<SubscriptionOrder[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [platformInstapayNumber, setPlatformInstapayNumber] = useState<string>('01551234263');
  const [beneficiaryName, setBeneficiaryName] = useState<string>('عبدالرحمن عبده');

  // Checkout Modal State
  const [activeOrder, setActiveOrder] = useState<SubscriptionOrder | null>(null);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState<boolean>(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState<boolean>(false);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState<boolean>(false);
  const [isSubmittingReport, setIsSubmittingReport] = useState<boolean>(false);

  // Transfer Proof Form
  const [transferRef, setTransferRef] = useState<string>('');
  const [senderInfo, setSenderInfo] = useState<string>('');
  const [transferTime, setTransferTime] = useState<string>(new Date().toISOString().slice(0, 16));
  const [transferNotes, setTransferNotes] = useState<string>('');
  const [copiedNumber, setCopiedNumber] = useState<boolean>(false);

  // Receipt Modal State
  const [selectedReceipt, setSelectedReceipt] = useState<SubscriptionReceipt | null>(null);

  // Load all plans, current subscription, and orders
  const loadSubscriptionData = async () => {
    try {
      setLoading(true);
      const [plansRes, currentRes, ordersRes] = await Promise.all([
        apiFetch('/api/v1/subscriptions/plans'),
        apiFetch('/api/v1/subscriptions/current'),
        apiFetch('/api/v1/subscriptions/orders'),
      ]);

      if (plansRes.ok) {
        const pData = await plansRes.json();
        setPlans(pData.plans || []);
        if (pData.platformInstapayNumber) {
          setPlatformInstapayNumber(pData.platformInstapayNumber);
        }
        if (pData.beneficiaryName) {
          setBeneficiaryName(pData.beneficiaryName);
        }
      }

      if (currentRes.ok) {
        const cData = await currentRes.json();
        setCurrentSub(cData);
      }

      if (ordersRes.ok) {
        const oData = await ordersRes.json();
        setOrders(oData || []);
      }
    } catch {
      // offline
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSubscriptionData();
  }, []);

  const handleCopyNumber = (num: string) => {
    navigator.clipboard.writeText(num);
    setCopiedNumber(true);
    showToast(language === 'ar' ? 'تم نسخ رقم إنستاباي إلى الحافظة' : 'InstaPay number copied to clipboard');
    setTimeout(() => setCopiedNumber(false), 3000);
  };

  // 1. Create a new subscription order
  const handleSelectPlan = async (plan: SubscriptionPlan) => {
    setIsSubmittingOrder(true);
    try {
      const res = await apiFetch('/api/v1/subscriptions/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ planId: plan.id }),
      });

      if (res.ok) {
        const data = await res.json();
        setActiveOrder(data.order);
        setIsCheckoutOpen(true);
        loadSubscriptionData();
        showToast(
          language === 'ar'
            ? `تم إنشاء طلب اشتراك جديد: ${data.order.order_number}`
            : `Subscription order created: ${data.order.order_number}`
        );
      } else {
        const err = await res.json();
        showToast(err.message || 'Failed to create subscription order');
      }
    } catch {
      showToast(language === 'ar' ? 'حدث خطأ في الاتصال' : 'Connection error');
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  // 2. Report payment execution from user's InstaPay app
  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrder) return;

    if (!transferRef && !senderInfo) {
      showToast(
        language === 'ar'
          ? 'يرجى إدخال رقم مرجع التحويل أو اسم/رقم هاتف المرسل'
          : 'Please provide either transfer reference or sender details'
      );
      return;
    }

    setIsSubmittingReport(true);
    try {
      const res = await apiFetch(`/api/v1/subscriptions/orders/${activeOrder.id}/report-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reportedTransferRef: transferRef.trim(),
          reportedSenderInfo: senderInfo.trim(),
          reportedTransferTime: transferTime,
          reportedNotes: transferNotes.trim(),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setIsReportModalOpen(false);
        setIsCheckoutOpen(false);
        setActiveOrder(null);
        setTransferRef('');
        setSenderInfo('');
        setTransferNotes('');
        loadSubscriptionData();

        showToast(data.message);
      } else {
        const err = await res.json();
        showToast(err.message || 'Report submission failed');
      }
    } catch {
      showToast(language === 'ar' ? 'حدث خطأ في إرسال البيانات' : 'Submission error');
    } finally {
      setIsSubmittingReport(false);
    }
  };

  // 3. View official receipt
  const handleViewReceipt = async (orderId: string) => {
    try {
      const res = await apiFetch(`/api/v1/subscriptions/receipts/${orderId}`);
      if (res.ok) {
        const receipt = await res.json();
        setSelectedReceipt(receipt);
      } else {
        showToast(language === 'ar' ? 'لم يتم العثور على الإيصال' : 'Receipt not found');
      }
    } catch {
      showToast(language === 'ar' ? 'خطأ في جلب الإيصال' : 'Error fetching receipt');
    }
  };

  const parseFeatures = (json: string): string[] => {
    try {
      return JSON.parse(json);
    } catch {
      return [];
    }
  };

  const getFeatureLabel = (key: string): { ar: string; en: string; icon: string } => {
    switch (key) {
      case 'realtime_reconciliation':
        return {
          ar: 'مطابقة العمليات اللحظية وخوارزمية الفحص الفلكي (Section 12A)',
          en: 'Real-time transaction parsing & Section 12A reconciliation ledger',
          icon: 'sync_alt',
        };
      case 'macrodroid_agent':
        return {
          ar: 'ربط هواتف أندرويد وماكرو درويد بكود اقتران مشفر 15 دقيقة',
          en: 'Pairing Android terminals & MacroDroid via 15-min pairing code',
          icon: 'phonelink_ring',
        };
      case 'hmac_security':
        return {
          ar: 'تأمين كامل بتشفير HMAC-SHA256 ونبضات مشفرة ومنع تكرار النبضات',
          en: 'HMAC-SHA256 device request signing and anti-replay defense',
          icon: 'security',
        };
      case 'cbe_limits':
        return {
          ar: 'مراقبة سقوف البنك المركزي وتنبيهات الاستهلاك 80% و 90%',
          en: 'CBE daily/monthly turnover ceilings & 80%/90% alert triggers',
          icon: 'notifications_active',
        };
      case 'audit_trail':
        return {
          ar: 'سجلات تدقيق أمان غير قابلة للتعديل وتتبع مشغلي النظام',
          en: 'Immutable security audit logs & operator action history',
          icon: 'verified_user',
        };
      case 'telegram_webhooks':
        return {
          ar: 'تنبيهات فورية عبر بوت تيليجرام وربط ويبهوك للمتجر',
          en: 'Instant Telegram notifications & webhook integrations',
          icon: 'send',
        };
      case 'csv_export':
        return {
          ar: 'تصدير كشوفات العمليات والتبديل المرن بين الفروع ومساحات العمل',
          en: 'Ledger CSV exports & multi-workspace fleet switching',
          icon: 'download',
        };
      default:
        return {
          ar: key,
          en: key,
          icon: 'check_circle',
        };
    }
  };

  const getStatusBadge = (status: SubscriptionOrder['status']) => {
    switch (status) {
      case 'confirmed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-label-xs font-bold bg-primary/10 text-primary border border-primary/20">
            <span className="material-symbols-outlined text-[13px]">check_circle</span>
            <span>{language === 'ar' ? 'تم تأكيد الدفع' : 'Payment Confirmed'}</span>
          </span>
        );
      case 'payment_reported':
      case 'in_review':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-label-xs font-bold bg-amber-500/10 text-amber-600 border border-amber-500/20">
            <span className="material-symbols-outlined text-[13px] animate-spin">progress_activity</span>
            <span>{language === 'ar' ? 'قيد المراجعة والمطابقة' : 'In Review & Matching'}</span>
          </span>
        );
      case 'pending_payment':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-label-xs font-bold bg-surface-container text-on-surface-variant border border-outline-variant">
            <span className="material-symbols-outlined text-[13px]">schedule</span>
            <span>{language === 'ar' ? 'في انتظار التحويل' : 'Awaiting Transfer'}</span>
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-label-xs font-bold bg-error/10 text-error border border-error/20">
            <span className="material-symbols-outlined text-[13px]">cancel</span>
            <span>{language === 'ar' ? 'مرفوض' : 'Rejected'}</span>
          </span>
        );
      case 'expired':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-label-xs font-bold bg-surface-container-high text-on-surface-variant">
            <span className="material-symbols-outlined text-[13px]">history</span>
            <span>{language === 'ar' ? 'انتهت المهلة' : 'Expired'}</span>
          </span>
        );
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-margin-mobile sm:px-margin-desktop py-space-md sm:py-space-lg space-y-space-lg">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-space-sm border-b border-outline-variant">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="material-symbols-outlined text-primary text-2xl">workspace_premium</span>
            <h1 className="text-headline-sm font-extrabold text-on-surface">
              {language === 'ar' ? 'الباقات والاشتراك' : 'Plans & Subscriptions'}
            </h1>
          </div>
          <p className="text-body-sm text-on-surface-variant">
            {language === 'ar'
              ? 'اختر باقة استيعاب هواتف الالتقاط المناسبة لحجم أعمالك مع تفعيل فوري عبر إنستاباي'
              : 'Choose the terminal capture capacity that fits your business scale with real InstaPay verification'}
          </p>
        </div>

        {/* Current Active Plan Pill */}
        {currentSub && (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-container-low border border-outline-variant">
            <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold">
              <span className="material-symbols-outlined text-xl">devices</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-label-xs text-on-surface-variant block">
                  {language === 'ar' ? 'حد هواتف الالتقاط:' : 'Terminal Capacity:'}
                </span>
                <span className="text-label-sm font-mono font-bold text-primary">
                  {currentSub.devicesUsed} / {currentSub.deviceLimit} {language === 'ar' ? 'هواتف' : 'phones'}
                </span>
              </div>
              <span className="text-title-xs font-bold text-on-surface">
                {language === 'ar' ? currentSub.planNameAr : currentSub.planNameEn}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Subscription Expiry / Grace Period Alert */}
      {currentSub && currentSub.status === 'grace_period' && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-on-surface flex items-start gap-3">
          <span className="material-symbols-outlined text-amber-600 text-2xl shrink-0">warning</span>
          <div>
            <h4 className="text-title-sm font-bold text-amber-800 dark:text-amber-200">
              {language === 'ar' ? 'فترة سماح للتجديد (3 أيام)' : 'Renewal Grace Period (3 Days)'}
            </h4>
            <p className="text-body-sm text-amber-700 dark:text-amber-300">
              {language === 'ar'
                ? 'انتهت فترة الاشتراك الحالية. الخدمة مستمرة مؤقتاً لحين تجديد الاشتراك لتجنب توقف مراقبة هواتف الاستقبال.'
                : 'Your subscription period has ended. Service is temporarily continuing during grace period. Renew to avoid terminal disconnection.'}
            </p>
          </div>
        </div>
      )}

      {/* Plans Pricing Cards Grid */}
      <div>
        <div className="text-center max-w-2xl mx-auto mb-space-lg">
          <h2 className="text-title-lg font-bold text-on-surface mb-1">
            {language === 'ar' ? 'باقات الاشتراك الشهرية والسنوية' : 'Available Subscription Tiers'}
          </h2>
          <p className="text-body-sm text-on-surface-variant">
            {language === 'ar'
              ? 'عدد الهواتف يشير إلى أجهزة التقاط رسائل الدفع المرتبطة بحسابك. الباقة السنوية تشمل كافة مميزات المنصة الحالية.'
              : 'Number of phones refers to message capture terminals linked to your workspace. Annual plan includes all current platform features.'}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
          {plans.map((plan) => {
            const isCurrentPlan = currentSub?.planId === plan.id && currentSub?.status === 'active';
            const isAnnual = plan.billing_cycle === 'annual';
            const features = parseFeatures(plan.features_json);

            return (
              <div key={plan.id} className="flex flex-col">
                {/* Popular / Annual Banner Placed Above the Card */}
                <div className="h-7 mb-2 flex items-center justify-center">
                  {isAnnual ? (
                    <span className="animate-slide-down-fade inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-primary text-on-primary text-label-xs font-bold shadow-xs whitespace-nowrap">
                      <span className="material-symbols-outlined text-sm">stars</span>
                      <span>{language === 'ar' ? 'أفضل قيمة — توفير شهرين' : 'Best Value — 2 Months Free'}</span>
                    </span>
                  ) : (
                    <div className="hidden md:block h-full" aria-hidden="true" />
                  )}
                </div>

                <div
                  className={`rounded-2xl p-6 flex flex-col justify-between transition-all border flex-1 ${
                    isAnnual
                      ? 'bg-surface-container-lowest border-primary shadow-lg ring-2 ring-primary/20'
                      : 'bg-surface-container-lowest border-outline-variant hover:border-primary/50'
                  }`}
                >
                  <div>
                    {/* Plan Title & Limits */}
                    <div className="mb-4">
                      <h3 className="text-title-md font-bold text-on-surface">
                        {language === 'ar' ? plan.name_ar : plan.name_en}
                      </h3>
                    <p className="text-body-xs text-on-surface-variant mt-0.5">
                      {language === 'ar'
                        ? `ربط حتى ${plan.device_limit} هواتف لاستقبال الرسائل`
                        : `Connect up to ${plan.device_limit} capture phones`}
                    </p>
                  </div>

                  {/* Price */}
                  <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/60 mb-5 flex items-baseline gap-1">
                    <span className="text-display-xs font-extrabold font-mono text-on-surface">
                      {plan.price_egp.toLocaleString()}
                    </span>
                    <span className="text-title-sm font-bold text-primary">
                      {language === 'ar' ? 'ج.م' : 'EGP'}
                    </span>
                    <span className="text-label-sm text-on-surface-variant font-normal">
                      / {plan.billing_cycle === 'annual' ? (language === 'ar' ? 'سنوياً' : 'year') : (language === 'ar' ? 'شهرياً' : 'month')}
                    </span>
                  </div>

                  {/* Feature Checklist */}
                  <div className="space-y-3 mb-6">
                    <span className="text-label-xs font-bold uppercase tracking-wider text-on-surface-variant block">
                      {language === 'ar' ? 'المميزات المشمولة فعلياً:' : 'Included Features:'}
                    </span>
                    <ul className="space-y-2.5">
                      {features.map((featKey) => {
                        const feat = getFeatureLabel(featKey);
                        return (
                          <li key={featKey} className="flex items-start gap-2.5 text-body-sm text-on-surface">
                            <span className="material-symbols-outlined text-primary text-base shrink-0 mt-0.5">
                              check_circle
                            </span>
                            <span>{language === 'ar' ? feat.ar : feat.en}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>

                {/* Action Button */}
                <div className="pt-4 border-t border-outline-variant/60">
                  <button
                    onClick={() => handleSelectPlan(plan)}
                    disabled={isSubmittingOrder}
                    className={`w-full py-2.5 px-4 rounded-xl font-bold text-label-md flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs active:scale-98 ${
                      isAnnual
                        ? 'bg-primary text-on-primary hover:bg-primary/90'
                        : 'bg-surface-container-high hover:bg-surface-container text-on-surface border border-outline-variant'
                    }`}
                  >
                    <span>
                      {isCurrentPlan
                        ? language === 'ar' ? 'تجديد الاشتراك' : 'Renew Plan'
                        : isAnnual
                        ? language === 'ar' ? 'اشترك سنويًا' : 'Subscribe Annually'
                        : language === 'ar' ? 'اشترك الآن' : 'Subscribe Now'}
                    </span>
                    <span className="material-symbols-outlined text-lg">arrow_forward</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        </div>
      </div>

      {/* Subscription Orders History Table */}
      <div className="p-6 rounded-2xl bg-surface-container-lowest border border-outline-variant shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-title-md font-bold text-on-surface">
              {language === 'ar' ? 'سجل طلبات الاشتراك والتحويلات' : 'Subscription Orders History'}
            </h3>
            <p className="text-body-xs text-on-surface-variant">
              {language === 'ar'
                ? 'متابعة حالة التحويل والمطابقة مع حساب إنستاباي وتحميل الإيصالات المعتمدة'
                : 'Track payment matching status with InstaPay and download verified receipts'}
            </p>
          </div>
          <button
            onClick={loadSubscriptionData}
            className="p-2 rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors"
            title="Refresh"
          >
            <span className="material-symbols-outlined text-xl">refresh</span>
          </button>
        </div>

        {orders.length === 0 ? (
          <div className="text-center py-8 text-on-surface-variant">
            <span className="material-symbols-outlined text-3xl mb-2 block">receipt_long</span>
            <p className="text-body-sm">
              {language === 'ar' ? 'لا توجد طلبات اشتراك سابقة.' : 'No prior subscription orders found.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left rtl:text-right border-collapse">
              <thead>
                <tr className="border-b border-outline-variant text-label-sm text-on-surface-variant font-semibold">
                  <th className="py-2.5 px-3">{language === 'ar' ? 'رقم الطلب' : 'Order #'}</th>
                  <th className="py-2.5 px-3">{language === 'ar' ? 'الباقة' : 'Plan'}</th>
                  <th className="py-2.5 px-3">{language === 'ar' ? 'المبلغ' : 'Amount'}</th>
                  <th className="py-2.5 px-3">{language === 'ar' ? 'الحالة' : 'Status'}</th>
                  <th className="py-2.5 px-3">{language === 'ar' ? 'المرجع المسجل' : 'Reported Ref'}</th>
                  <th className="py-2.5 px-3">{language === 'ar' ? 'التاريخ' : 'Date'}</th>
                  <th className="py-2.5 px-3 text-center">{language === 'ar' ? 'الإجراء' : 'Action'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/60 text-body-sm">
                {orders.map((ord) => (
                  <tr key={ord.id} className="hover:bg-surface-container-low/50 transition-colors">
                    <td className="py-3 px-3 font-mono text-label-xs font-bold text-primary">
                      {ord.order_number}
                    </td>
                    <td className="py-3 px-3 font-semibold">
                      {language === 'ar' ? ord.plan_name_ar : ord.plan_name_en}
                    </td>
                    <td className="py-3 px-3 font-mono font-bold text-on-surface">
                      {ord.price_egp.toLocaleString()} ج.م
                    </td>
                    <td className="py-3 px-3">{getStatusBadge(ord.status)}</td>
                    <td className="py-3 px-3 font-mono text-label-xs text-on-surface-variant">
                      {ord.reported_transfer_ref || '—'}
                    </td>
                    <td className="py-3 px-3 text-label-xs text-on-surface-variant">
                      {new Date(ord.created_at).toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US')}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {ord.status === 'confirmed' ? (
                          <button
                            onClick={() => handleViewReceipt(ord.id)}
                            className="px-2.5 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 text-label-xs font-bold flex items-center gap-1 transition-all cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[14px]">receipt_long</span>
                            <span>{language === 'ar' ? 'الإيصال' : 'Receipt'}</span>
                          </button>
                        ) : ord.status === 'pending_payment' || ord.status === 'in_review' ? (
                          <button
                            onClick={() => {
                              setActiveOrder(ord);
                              setIsCheckoutOpen(true);
                            }}
                            className="px-2.5 py-1 rounded-md bg-surface-container-high hover:bg-surface-container text-on-surface text-label-xs font-semibold flex items-center gap-1 transition-all cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[14px]">send</span>
                            <span>{language === 'ar' ? 'إبلاغ التحويل' : 'Report Payment'}</span>
                          </button>
                        ) : (
                          <span className="text-on-surface-variant text-label-xs">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Checkout Instructions Modal */}
      {isCheckoutOpen && activeOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95">
            {/* Header */}
            <div className="p-6 bg-surface-container-low border-b border-outline-variant flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary text-on-primary flex items-center justify-center shadow-xs">
                  <span className="material-symbols-outlined text-2xl">payments</span>
                </div>
                <div>
                  <h3 className="text-title-md font-bold text-on-surface">
                    {language === 'ar' ? 'تعليمات تحويل الاشتراك (إنستاباي)' : 'InstaPay Transfer Instructions'}
                  </h3>
                  <span className="text-label-xs font-mono text-primary font-bold">
                    {activeOrder.order_number}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setIsCheckoutOpen(false)}
                className="p-1 rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5">
              {/* Order Summary Card */}
              <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/80 flex items-center justify-between">
                <div>
                  <span className="text-label-xs text-on-surface-variant block">
                    {language === 'ar' ? 'الباقة المختارة:' : 'Selected Plan:'}
                  </span>
                  <span className="text-title-sm font-bold text-on-surface">
                    {language === 'ar' ? activeOrder.plan_name_ar : activeOrder.plan_name_en}
                  </span>
                  <span className="text-label-xs text-primary font-medium block">
                    {activeOrder.device_limit} {language === 'ar' ? 'هواتف التقاط' : 'capture phones'}
                  </span>
                </div>
                <div className="text-right rtl:text-left">
                  <span className="text-label-xs text-on-surface-variant block">
                    {language === 'ar' ? 'المبلغ المطلوب سداده:' : 'Amount to Transfer:'}
                  </span>
                  <span className="text-headline-xs font-extrabold font-mono text-primary">
                    {activeOrder.price_egp.toLocaleString()} ج.م
                  </span>
                </div>
              </div>

              {/* InstaPay Transfer Target Phone Number */}
              <div className="p-4 rounded-xl bg-primary/5 border border-primary/20 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-label-sm font-bold text-on-surface">
                    {language === 'ar' ? 'رقم إنستاباي المعتمد لاستقبال الاشتراك:' : 'Official InstaPay Receiver Phone:'}
                  </span>
                  <span className="px-2 py-0.5 rounded text-label-xs font-bold bg-primary text-on-primary">
                    InstaPay
                  </span>
                </div>

                <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-surface-container-lowest border border-outline-variant">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-xl">call</span>
                    <span
                      dir="ltr"
                      className="font-mono text-title-md font-bold tracking-wider text-on-surface select-all"
                    >
                      {activeOrder.instapay_target_number || platformInstapayNumber}
                    </span>
                  </div>

                  <button
                    onClick={() => handleCopyNumber(activeOrder.instapay_target_number || platformInstapayNumber)}
                    className="px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-container text-primary font-bold text-label-xs flex items-center gap-1 transition-all cursor-pointer border border-outline-variant/60 active:scale-95"
                  >
                    <span className="material-symbols-outlined text-[15px]">
                      {copiedNumber ? 'check' : 'content_copy'}
                    </span>
                    <span>{copiedNumber ? (language === 'ar' ? 'تم النسخ' : 'Copied') : (language === 'ar' ? 'نسخ الرقم' : 'Copy')}</span>
                  </button>
                </div>

                {beneficiaryName && (
                  <div className="flex items-center justify-between text-body-xs text-on-surface-variant pt-1 border-t border-outline-variant/40">
                    <span>{language === 'ar' ? 'اسم المستفيد في إنستاباي:' : 'Beneficiary Name:'}</span>
                    <span className="font-bold text-on-surface">{beneficiaryName}</span>
                  </div>
                )}
              </div>

              {/* Explanatory Notice */}
              <div className="p-3.5 rounded-xl bg-surface-container-low border border-outline-variant/60 text-body-xs text-on-surface-variant space-y-1.5">
                <div className="flex items-center gap-1.5 font-bold text-on-surface">
                  <span className="material-symbols-outlined text-primary text-sm">info</span>
                  <span>{language === 'ar' ? 'خطوات السداد والتفعيل:' : 'Payment & Activation Steps:'}</span>
                </div>
                <p>
                  {language === 'ar'
                    ? '1. افتح تطبيق إنستاباي على هاتفك وقم بتحويل المبلغ المطلوب أعلاه تماماً إلى الرقم الموضح.'
                    : '1. Open InstaPay on your mobile phone and transfer the exact amount above to the recipient phone.'}
                </p>
                <p>
                  {language === 'ar'
                    ? '2. بعد إتمام التحويل، اضغط على زر «حوّلت المبلغ» بالأسفل وسجل رقم مرجع التحويل أو اسمك للربط الفوري.'
                    : '2. After sending, click "I Transferred the Amount" below and provide the transfer reference for matching.'}
                </p>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-outline-variant bg-surface-container-low flex items-center justify-between">
              <button
                onClick={() => setIsCheckoutOpen(false)}
                className="px-4 py-2 rounded-lg bg-surface-container-high hover:bg-surface-container text-on-surface text-label-sm font-semibold transition-all cursor-pointer"
              >
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>

              <button
                onClick={() => {
                  setIsCheckoutOpen(false);
                  setIsReportModalOpen(true);
                }}
                className="px-5 py-2.5 rounded-xl bg-primary text-on-primary font-bold text-label-md flex items-center gap-2 hover:bg-primary/90 transition-all cursor-pointer shadow-xs active:scale-95"
              >
                <span className="material-symbols-outlined text-lg">check_circle</span>
                <span>{language === 'ar' ? 'حوّلت المبلغ' : 'I Transferred the Amount'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Report Payment Form Modal */}
      {isReportModalOpen && activeOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95">
            {/* Header */}
            <div className="p-6 bg-surface-container-low border-b border-outline-variant flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary text-on-primary flex items-center justify-center shadow-xs">
                  <span className="material-symbols-outlined text-2xl">send</span>
                </div>
                <div>
                  <h3 className="text-title-md font-bold text-on-surface">
                    {language === 'ar' ? 'تسجيل بيانات تحويل إنستاباي' : 'Submit InstaPay Transfer Proof'}
                  </h3>
                  <span className="text-label-xs font-mono text-primary font-bold">
                    {activeOrder.order_number} ({activeOrder.price_egp} ج.م)
                  </span>
                </div>
              </div>
              <button
                onClick={() => setIsReportModalOpen(false)}
                className="p-1 rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmitReport}>
              <div className="p-6 space-y-4">
                {/* Important Trust Notice */}
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-body-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
                  <span className="material-symbols-outlined text-base text-amber-600 shrink-0 mt-0.5">verified_user</span>
                  <span>
                    {language === 'ar'
                      ? 'النظام يربط بياناتك آلياً برسالة التحويل المستلمة فعلياً على حساب صاحب المنصة. لن يتم التفعيل حتى وصول الرسالة وتطابقها برمجياً.'
                      : 'The system matches your claim with the real payment message captured on the platform receiver. Plan activates upon cryptographic verification.'}
                  </span>
                </div>

                {/* Transfer Reference / TRX ID */}
                <div>
                  <label className="block text-label-sm font-bold text-on-surface mb-1">
                    {language === 'ar' ? 'رقم مرجع التحويل (إنستاباي / البنك):' : 'Transfer Reference # / InstaPay TRX ID:'}
                  </label>
                  <input
                    type="text"
                    value={transferRef}
                    onChange={(e) => setTransferRef(e.target.value)}
                    placeholder="e.g. IPN260930129384 أو رقم الإشعار"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface font-mono text-body-sm focus:outline-none focus:border-primary"
                  />
                  <span className="text-label-xs text-on-surface-variant mt-1 block">
                    {language === 'ar' ? 'الرقم المرجعي الموضح في شاشة نجاح التحويل بتطبيق إنستاباي' : 'Reference code displayed on InstaPay completion receipt'}
                  </span>
                </div>

                {/* Sender Name / Phone */}
                <div>
                  <label className="block text-label-sm font-bold text-on-surface mb-1">
                    {language === 'ar' ? 'اسم أو رقم هاتف المرسل:' : 'Sender Name or Phone Number:'}
                  </label>
                  <input
                    type="text"
                    value={senderInfo}
                    onChange={(e) => setSenderInfo(e.target.value)}
                    placeholder="010... أو اسم الحساب المحول منه"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-body-sm focus:outline-none focus:border-primary"
                  />
                </div>

                {/* Transfer Time */}
                <div>
                  <label className="block text-label-sm font-bold text-on-surface mb-1">
                    {language === 'ar' ? 'وقت إجراء التحويل التقريبي:' : 'Approximate Transfer Time:'}
                  </label>
                  <input
                    type="datetime-local"
                    value={transferTime}
                    onChange={(e) => setTransferTime(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-body-sm focus:outline-none focus:border-primary"
                  />
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-label-sm font-bold text-on-surface mb-1">
                    {language === 'ar' ? 'ملاحظات إضافية (اختياري):' : 'Additional Notes (Optional):'}
                  </label>
                  <textarea
                    rows={2}
                    value={transferNotes}
                    onChange={(e) => setTransferNotes(e.target.value)}
                    placeholder={language === 'ar' ? 'أي تفاصيل تساعد في مطابقة التحويل...' : 'Any details to assist with reconciliation...'}
                    className="w-full px-3.5 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-body-sm focus:outline-none focus:border-primary resize-none"
                  />
                </div>
              </div>

              {/* Footer Actions */}
              <div className="p-4 border-t border-outline-variant bg-surface-container-low flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setIsReportModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-surface-container-high hover:bg-surface-container text-on-surface text-label-sm font-semibold transition-all cursor-pointer"
                >
                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>

                <button
                  type="submit"
                  disabled={isSubmittingReport}
                  className="px-5 py-2.5 rounded-xl bg-primary text-on-primary font-bold text-label-md flex items-center gap-2 hover:bg-primary/90 transition-all cursor-pointer shadow-xs active:scale-95 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-lg">
                    {isSubmittingReport ? 'progress_activity' : 'send'}
                  </span>
                  <span>{language === 'ar' ? 'إرسال بيانات التحويل للمطابقة' : 'Submit for Verification'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Official Receipt Modal */}
      {selectedReceipt && (
        <ReceiptModal
          receipt={selectedReceipt}
          onClose={() => setSelectedReceipt(null)}
          language={language}
        />
      )}
    </div>
  );
};
