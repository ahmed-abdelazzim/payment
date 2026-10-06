import React, { useState, useEffect } from 'react';
import { PlatformOverview, SubscriptionPlan, SubscriptionOrder } from '../types';
import { apiFetch } from '../api';

interface PlatformDashboardViewProps {
  language: 'en' | 'ar';
  showToast: (msg: string) => void;
}

export const PlatformDashboardView: React.FC<PlatformDashboardViewProps> = ({
  language,
  showToast,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'orders' | 'settings' | 'plans' | 'subscriptions' | 'inbound'>('overview');
  const [loading, setLoading] = useState<boolean>(true);

  // Data states
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [orders, setOrders] = useState<SubscriptionOrder[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [platformTxns, setPlatformTxns] = useState<any[]>([]);

  // Platform Settings State
  const [instapayNumber, setInstapayNumber] = useState<string>('01551234263');
  const [beneficiaryName, setBeneficiaryName] = useState<string>('******أحمد ع****** ع****** ر');
  const [isSavingSettings, setIsSavingSettings] = useState<boolean>(false);

  // Review & Approval Modal State
  const [selectedOrder, setSelectedOrder] = useState<SubscriptionOrder | null>(null);
  const [approvalAction, setApprovalAction] = useState<'approve' | 'reject' | null>(null);
  const [actionReason, setActionReason] = useState<string>('');
  const [selectedTxnId, setSelectedTxnId] = useState<string>('');
  const [isProcessingAction, setIsProcessingAction] = useState<boolean>(false);

  const fetchPlatformData = async () => {
    try {
      setLoading(true);
      const [overRes, ordRes, plansRes, subsRes, txnsRes, settRes] = await Promise.all([
        apiFetch('/api/v1/platform/overview'),
        apiFetch('/api/v1/platform/orders'),
        apiFetch('/api/v1/platform/plans'),
        apiFetch('/api/v1/platform/subscriptions'),
        apiFetch('/api/v1/platform/transactions'),
        apiFetch('/api/v1/platform/settings'),
      ]);

      if (overRes.ok) setOverview(await overRes.json());
      if (ordRes.ok) setOrders(await ordRes.json());
      if (plansRes.ok) setPlans(await plansRes.json());
      if (subsRes.ok) setSubscriptions(await subsRes.json());
      if (txnsRes.ok) setPlatformTxns(await txnsRes.json());
      if (settRes.ok) {
        const s = await settRes.json();
        setInstapayNumber(s.instapay_number || '01551234263');
        setBeneficiaryName(s.beneficiary_name || '******أحمد ع****** ع****** ر');
      }
    } catch {
      // offline
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlatformData();
  }, []);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSettings(true);
    try {
      const res = await apiFetch('/api/v1/platform/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instapayNumber: instapayNumber.trim(),
          beneficiaryName: beneficiaryName.trim(),
        }),
      });

      if (res.ok) {
        showToast(
          language === 'ar'
            ? 'تم حفظ وتحديث إعدادات استقبال اشتراكات المنصة بنجاح'
            : 'Platform subscription receiver settings updated'
        );
        fetchPlatformData();
      } else {
        const err = await res.json();
        showToast(err.message || 'Failed to update settings');
      }
    } catch {
      showToast(language === 'ar' ? 'خطأ في الاتصال' : 'Connection error');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleApproveOrder = async () => {
    if (!selectedOrder || !actionReason) {
      showToast(language === 'ar' ? 'يرجى كتابة سبب الاعتماد' : 'Reason required');
      return;
    }

    setIsProcessingAction(true);
    try {
      const res = await apiFetch(`/api/v1/platform/orders/${selectedOrder.id}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: actionReason.trim(),
          transactionId: selectedTxnId || undefined,
        }),
      });

      if (res.ok) {
        showToast(language === 'ar' ? 'تم اعتماد الطلب وتفعيل اشتراك المتجر بنجاح' : 'Order approved & plan activated');
        setSelectedOrder(null);
        setApprovalAction(null);
        setActionReason('');
        setSelectedTxnId('');
        fetchPlatformData();
      } else {
        const err = await res.json();
        showToast(err.message || 'Approval failed');
      }
    } catch {
      showToast(language === 'ar' ? 'خطأ في معالجة الاعتماد' : 'Action failed');
    } finally {
      setIsProcessingAction(false);
    }
  };

  const handleRejectOrder = async () => {
    if (!selectedOrder || !actionReason) {
      showToast(language === 'ar' ? 'يرجى كتابة سبب الرفض' : 'Reason required');
      return;
    }

    setIsProcessingAction(true);
    try {
      const res = await apiFetch(`/api/v1/platform/orders/${selectedOrder.id}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: actionReason.trim(),
        }),
      });

      if (res.ok) {
        showToast(language === 'ar' ? 'تم رفض الطلب وتوثيق السبب' : 'Order rejected');
        setSelectedOrder(null);
        setApprovalAction(null);
        setActionReason('');
        fetchPlatformData();
      } else {
        const err = await res.json();
        showToast(err.message || 'Rejection failed');
      }
    } catch {
      showToast(language === 'ar' ? 'خطأ في رفض الطلب' : 'Action failed');
    } finally {
      setIsProcessingAction(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-margin-mobile sm:px-margin-desktop py-space-md sm:py-space-lg space-y-space-lg">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-space-sm border-b border-outline-variant">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="material-symbols-outlined text-primary text-2xl">shield_person</span>
            <h1 className="text-headline-sm font-extrabold text-on-surface">
              {language === 'ar' ? 'لوحة صاحب المنصة' : 'Platform Owner Console'}
            </h1>
            <span className="px-2 py-0.5 rounded text-label-xs font-bold bg-primary text-on-primary uppercase">
              Master Admin
            </span>
          </div>
          <p className="text-body-sm text-on-surface-variant">
            {language === 'ar'
              ? 'إدارة اشتراكات المتاجر، مراجعة تحويلات إنستاباي، وضبط أسعار الباقات وقنوات استقبال الأرباح'
              : 'Manage merchant subscriptions, review InstaPay payments, configure plans & receiver channels'}
          </p>
        </div>

        {/* Refresh button */}
        <button
          onClick={fetchPlatformData}
          className="px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-label-sm font-semibold flex items-center gap-1.5 transition-all self-start sm:self-auto cursor-pointer"
        >
          <span className="material-symbols-outlined text-base">refresh</span>
          <span>{language === 'ar' ? 'تحديث البيانات' : 'Refresh'}</span>
        </button>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-outline-variant/60">
        {[
          { id: 'overview', icon: 'dashboard', ar: 'المؤشرات العامة', en: 'Overview' },
          { id: 'orders', icon: 'fact_check', ar: 'طلبات الاشتراك والمطابقة', en: 'Orders Queue', count: overview?.pendingReviewOrders },
          { id: 'settings', icon: 'tune', ar: 'إعدادات رقم إنستاباي', en: 'Receiver Settings' },
          { id: 'plans', icon: 'inventory_2', ar: 'الباقات الرسمية', en: 'Official Plans' },
          { id: 'subscriptions', icon: 'card_membership', ar: 'المشتركون والاشتراكات', en: 'Active Subscribers' },
          { id: 'inbound', icon: 'receipt', ar: 'تحويلات هاتف المنصة', en: 'Platform Inbound Feed' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-3.5 py-2 rounded-xl text-label-sm font-bold flex items-center gap-2 whitespace-nowrap transition-all cursor-pointer ${
              activeTab === tab.id
                ? 'bg-primary text-on-primary shadow-xs'
                : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-lg">{tab.icon}</span>
            <span>{language === 'ar' ? tab.ar : tab.en}</span>
            {tab.count !== undefined && tab.count > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-label-xs font-bold bg-amber-500 text-black">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 1. OVERVIEW TAB */}
      {activeTab === 'overview' && overview && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant shadow-xs">
              <span className="text-label-sm text-on-surface-variant block mb-1">
                {language === 'ar' ? 'إجمالي إيرادات الاشتراكات:' : 'Total Subscription Revenue:'}
              </span>
              <div className="flex items-baseline gap-1">
                <span className="text-headline-sm font-extrabold font-mono text-primary">
                  {overview.totalRevenueEgp.toLocaleString()}
                </span>
                <span className="text-label-sm font-bold text-on-surface">ج.م</span>
              </div>
            </div>

            <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant shadow-xs">
              <span className="text-label-sm text-on-surface-variant block mb-1">
                {language === 'ar' ? 'الاشتراكات النشطة:' : 'Active Subscriptions:'}
              </span>
              <div className="flex items-baseline gap-1">
                <span className="text-headline-sm font-extrabold font-mono text-on-surface">
                  {overview.activeSubscriptions}
                </span>
                <span className="text-label-sm text-on-surface-variant">
                  {language === 'ar' ? 'متجر مشترك' : 'merchants'}
                </span>
              </div>
            </div>

            <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant shadow-xs">
              <span className="text-label-sm text-on-surface-variant block mb-1">
                {language === 'ar' ? 'طلبات قيد المراجعة والمطابقة:' : 'Orders in Review Queue:'}
              </span>
              <div className="flex items-baseline gap-1">
                <span className={`text-headline-sm font-extrabold font-mono ${overview.pendingReviewOrders > 0 ? 'text-amber-600' : 'text-on-surface'}`}>
                  {overview.pendingReviewOrders}
                </span>
                <span className="text-label-sm text-on-surface-variant">
                  {language === 'ar' ? 'طلب بحاجة لقرار' : 'pending claims'}
                </span>
              </div>
            </div>

            <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant shadow-xs">
              <span className="text-label-sm text-on-surface-variant block mb-1">
                {language === 'ar' ? 'إجمالي طلبات السداد:' : 'Total Subscription Orders:'}
              </span>
              <div className="flex items-baseline gap-1">
                <span className="text-headline-sm font-extrabold font-mono text-on-surface">
                  {overview.totalOrders}
                </span>
                <span className="text-label-sm text-on-surface-variant">
                  {language === 'ar' ? 'طلب مسجل' : 'orders'}
                </span>
              </div>
            </div>
          </div>

          {/* Operational Capture Phone Status */}
          <div className="p-6 rounded-2xl bg-surface-container-lowest border border-outline-variant shadow-xs">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                  <span className="material-symbols-outlined text-2xl">phonelink_ring</span>
                </div>
                <div>
                  <h3 className="text-title-md font-bold text-on-surface">
                    {language === 'ar' ? 'هاتف استقبال مدفوعات المنصة (Terminal Gate)' : 'Platform Payment Capture Phone'}
                  </h3>
                  <p className="text-body-xs text-on-surface-variant">
                    {language === 'ar'
                      ? 'الجهاز الفعلي المربوط بحساب إنستاباي الشخصي (01551234263) لالتقاط رسائل تحويلات الاشتراكات فورياً'
                      : 'The dedicated physical terminal paired with InstaPay (01551234263) to capture subscriber payments in real-time'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
                <span className="text-label-sm font-bold text-primary">
                  {language === 'ar' ? 'متصل وجاهز للاستقبال' : 'Connected & Online'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-outline-variant/60 text-body-sm">
              <div>
                <span className="text-label-xs text-on-surface-variant block">{language === 'ar' ? 'معرّف الجهاز:' : 'Device ID:'}</span>
                <span className="font-mono font-bold text-on-surface">DEV-PLATFORM-01</span>
              </div>
              <div>
                <span className="text-label-xs text-on-surface-variant block">{language === 'ar' ? 'رقم محفظة إنستاباي المرتبطة:' : 'Bound InstaPay MSISDN:'}</span>
                <span dir="ltr" className="font-mono font-bold text-primary">{instapayNumber}</span>
              </div>
              <div>
                <span className="text-label-xs text-on-surface-variant block">{language === 'ar' ? 'بروتوكول الالتقاط والتشفير:' : 'Ingestion & Cipher:'}</span>
                <span className="font-semibold text-on-surface">Native Agent / HMAC-SHA256</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. ORDERS QUEUE TAB */}
      {activeTab === 'orders' && (
        <div className="p-6 rounded-2xl bg-surface-container-lowest border border-outline-variant shadow-xs space-y-4">
          <div>
            <h3 className="text-title-md font-bold text-on-surface">
              {language === 'ar' ? 'طابور مراجعة ومطابقة طلبات الاشتراكات' : 'Subscription Orders & Matching Queue'}
            </h3>
            <p className="text-body-xs text-on-surface-variant">
              {language === 'ar'
                ? 'مراجعة المبالغ المحولة، مطابقة رقم مرجع التحويل مع رسائل إنستاباي، والاعتماد أو الرفض مع توثيق السبب'
                : 'Review claimed payments, match reference against inbound InstaPay messages, approve or reject with audit trail'}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left rtl:text-right border-collapse">
              <thead>
                <tr className="border-b border-outline-variant text-label-sm text-on-surface-variant font-semibold">
                  <th className="py-2.5 px-3">{language === 'ar' ? 'المتجر / المؤسسة' : 'Merchant'}</th>
                  <th className="py-2.5 px-3">{language === 'ar' ? 'رقم الطلب' : 'Order #'}</th>
                  <th className="py-2.5 px-3">{language === 'ar' ? 'الباقة' : 'Plan'}</th>
                  <th className="py-2.5 px-3">{language === 'ar' ? 'المبلغ المطلوب' : 'Amount'}</th>
                  <th className="py-2.5 px-3">{language === 'ar' ? 'المرجع المسجل' : 'Reported Ref'}</th>
                  <th className="py-2.5 px-3">{language === 'ar' ? 'المرسل' : 'Sender'}</th>
                  <th className="py-2.5 px-3">{language === 'ar' ? 'الحالة' : 'Status'}</th>
                  <th className="py-2.5 px-3 text-center">{language === 'ar' ? 'قرار صاحب المنصة' : 'Decision'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/60 text-body-sm">
                {orders.map((ord) => (
                  <tr key={ord.id} className="hover:bg-surface-container-low/50 transition-colors">
                    <td className="py-3 px-3">
                      <span className="font-bold text-on-surface block">
                        {language === 'ar' ? ord.org_name_ar || ord.org_name : ord.org_name}
                      </span>
                      <span className="text-label-xs text-on-surface-variant">{ord.user_email}</span>
                    </td>
                    <td className="py-3 px-3 font-mono text-label-xs font-bold text-primary">
                      {ord.order_number}
                    </td>
                    <td className="py-3 px-3 font-medium">
                      {language === 'ar' ? ord.plan_name_ar : ord.plan_name_en}
                    </td>
                    <td className="py-3 px-3 font-mono font-bold text-on-surface">
                      {ord.price_egp.toLocaleString()} ج.م
                    </td>
                    <td className="py-3 px-3 font-mono text-label-xs text-primary font-bold">
                      {ord.reported_transfer_ref || '—'}
                    </td>
                    <td className="py-3 px-3 text-label-xs text-on-surface-variant">
                      {ord.reported_sender_info || '—'}
                    </td>
                    <td className="py-3 px-3">
                      <span className={`px-2 py-0.5 rounded-full text-label-xs font-bold ${
                        ord.status === 'confirmed' ? 'bg-primary/10 text-primary' :
                        ord.status === 'rejected' ? 'bg-error/10 text-error' :
                        ord.status === 'in_review' || ord.status === 'payment_reported' ? 'bg-amber-500/10 text-amber-600' :
                        'bg-surface-container text-on-surface-variant'
                      }`}>
                        {ord.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center">
                      {ord.status !== 'confirmed' && ord.status !== 'rejected' ? (
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => {
                              setSelectedOrder(ord);
                              setApprovalAction('approve');
                              setActionReason(language === 'ar' ? 'تم التحقق من استلام المبلغ في إنستاباي ومطابقته' : 'Verified on InstaPay receiver');
                            }}
                            className="px-2.5 py-1 rounded-lg bg-primary text-on-primary text-label-xs font-bold hover:bg-primary/90 transition-all cursor-pointer shadow-2xs"
                          >
                            {language === 'ar' ? 'اعتماد' : 'Approve'}
                          </button>
                          <button
                            onClick={() => {
                              setSelectedOrder(ord);
                              setApprovalAction('reject');
                              setActionReason('');
                            }}
                            className="px-2.5 py-1 rounded-lg bg-error/10 text-error hover:bg-error/20 text-label-xs font-bold transition-all cursor-pointer"
                          >
                            {language === 'ar' ? 'رفض' : 'Reject'}
                          </button>
                        </div>
                      ) : (
                        <span className="text-label-xs text-on-surface-variant font-mono">
                          {ord.approval_type === 'automatic'
                            ? language === 'ar' ? 'مفعل آلياً ⚡' : 'Auto-reconciled'
                            : ord.approval_type === 'manual'
                            ? language === 'ar' ? 'اعتماد يدوي' : 'Manual'
                            : '—'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. PLATFORM RECEIVER SETTINGS TAB */}
      {activeTab === 'settings' && (
        <div className="max-w-2xl p-6 rounded-2xl bg-surface-container-lowest border border-outline-variant shadow-xs space-y-5">
          <div>
            <h3 className="text-title-md font-bold text-on-surface">
              {language === 'ar' ? 'إعدادات استقبال مدفوعات الاشتراكات' : 'Platform Subscription Receiver Settings'}
            </h3>
            <p className="text-body-xs text-on-surface-variant">
              {language === 'ar'
                ? 'رقم إنستاباي الشخصي واسم المستفيد الذي يظهر للعملاء عند الاشتراك. التعديل هنا ينعكس على كافة الطلبات الجديدة دون تعديل الطلبات السابقة.'
                : 'Personal InstaPay number and beneficiary name displayed to merchants during checkout. Changes apply to future orders.'}
            </p>
          </div>

          <form onSubmit={handleSaveSettings} className="space-y-4">
            <div>
              <label className="block text-label-sm font-bold text-on-surface mb-1">
                {language === 'ar' ? 'رقم هاتف إنستاباي الشخصي (مع الحفاظ على الصفر):' : 'InstaPay Personal Phone Number (with leading zero):'}
              </label>
              <input
                type="tel"
                inputMode="numeric"
                autoComplete="off"
                dir="ltr"
                maxLength={11}
                pattern="01[0125][0-9]{8}"
                title={language === 'ar' ? 'رقم موبايل مصري من 11 رقماً' : 'Egyptian mobile number, 11 digits'}
                required
                value={instapayNumber}
                onChange={(e) => setInstapayNumber(e.target.value.replace(/\D/g, '').slice(0, 11))}
                placeholder="01xxxxxxxxx"
                className="w-full px-3.5 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest font-mono font-bold text-title-sm text-on-surface focus:outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="block text-label-sm font-bold text-on-surface mb-1">
                {language === 'ar' ? 'اسم المستفيد في إنستاباي (المعروض للعملاء):' : 'InstaPay Beneficiary Name (displayed to users):'}
              </label>
              <input
                type="text"
                required
                value={beneficiaryName}
                onChange={(e) => setBeneficiaryName(e.target.value)}
                placeholder="******أحمد ع****** ع****** ر"
                className="w-full px-3.5 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-body-sm focus:outline-none focus:border-primary"
              />
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={isSavingSettings}
                className="px-5 py-2.5 rounded-xl bg-primary text-on-primary font-bold text-label-md flex items-center gap-2 hover:bg-primary/90 transition-all cursor-pointer shadow-xs active:scale-95 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-lg">save</span>
                <span>{isSavingSettings ? (language === 'ar' ? 'جاري الحفظ...' : 'Saving...') : (language === 'ar' ? 'حفظ إعدادات الاستقبال' : 'Save Receiver Settings')}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 4. PLANS & PRICING TAB */}
      {activeTab === 'plans' && (
        <div className="space-y-4">
          <div className="p-6 rounded-2xl bg-surface-container-lowest border border-outline-variant shadow-xs">
            <h3 className="text-title-md font-bold text-on-surface mb-1">
              {language === 'ar' ? 'الباقات الرسمية وحدود الهواتف' : 'Official Subscription Plans & Phone Limits'}
            </h3>
            <p className="text-body-xs text-on-surface-variant mb-4">
              {language === 'ar'
                ? 'شروط الباقات وأسعارها وحدود الأجهزة تُدار مركزياً ولا يمكن تعديلها من لوحة التشغيل.'
                : 'Plan terms, prices, and device limits are centrally managed and cannot be changed from the operations console.'}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {plans.map((p) => (
                <div key={p.id} className="p-5 rounded-xl border border-outline-variant bg-surface-container-low flex flex-col justify-between">
                  <div>
                    <h4 className="text-title-sm font-bold text-on-surface mb-1">
                      {language === 'ar' ? p.name_ar : p.name_en}
                    </h4>
                    <span className="text-label-xs text-on-surface-variant block mb-3">
                      {p.billing_cycle === 'annual' ? 'دورة سنوية' : 'دورة شهرية'}
                    </span>

                    <div className="p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/60 mb-3 space-y-1">
                      <div className="flex items-center justify-between text-body-sm">
                        <span className="text-on-surface-variant">{language === 'ar' ? 'السعر الحالي:' : 'Price:'}</span>
                        <span className="font-mono font-bold text-primary">{p.price_egp} ج.م</span>
                      </div>
                      <div className="flex items-center justify-between text-body-sm">
                        <span className="text-on-surface-variant">{language === 'ar' ? 'حد الهواتف:' : 'Device Limit:'}</span>
                        <span className="font-bold">{p.device_limit} هواتف</span>
                      </div>
                    </div>
                  </div>

                  <div className="w-full py-2 rounded-lg bg-surface-container-high text-on-surface-variant text-label-sm font-semibold flex items-center justify-center gap-1.5">
                    <span className="material-symbols-outlined text-base">lock</span>
                    <span>{language === 'ar' ? 'شروط باقة معتمدة' : 'Approved plan terms'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 5. ACTIVE SUBSCRIBERS TAB */}
      {activeTab === 'subscriptions' && (
        <div className="p-6 rounded-2xl bg-surface-container-lowest border border-outline-variant shadow-xs space-y-4">
          <h3 className="text-title-md font-bold text-on-surface">
            {language === 'ar' ? 'سجل اشتراكات المتاجر النشطة والمنتهية' : 'Merchant Subscriptions Directory'}
          </h3>

          <div className="overflow-x-auto">
            <table className="w-full text-left rtl:text-right border-collapse">
              <thead>
                <tr className="border-b border-outline-variant text-label-sm text-on-surface-variant font-semibold">
                  <th className="py-2.5 px-3">{language === 'ar' ? 'المتجر' : 'Merchant'}</th>
                  <th className="py-2.5 px-3">{language === 'ar' ? 'الباقة الحالية' : 'Plan'}</th>
                  <th className="py-2.5 px-3">{language === 'ar' ? 'حد الأجهزة' : 'Limit'}</th>
                  <th className="py-2.5 px-3">{language === 'ar' ? 'الحالة' : 'Status'}</th>
                  <th className="py-2.5 px-3">{language === 'ar' ? 'تاريخ البداية' : 'Starts'}</th>
                  <th className="py-2.5 px-3">{language === 'ar' ? 'تاريخ الانتهاء' : 'Ends'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/60 text-body-sm">
                {subscriptions.map((s) => (
                  <tr key={s.id} className="hover:bg-surface-container-low/50 transition-colors">
                    <td className="py-3 px-3 font-bold text-on-surface">
                      {language === 'ar' ? s.org_name_ar || s.org_name : s.org_name}
                    </td>
                    <td className="py-3 px-3 font-semibold text-primary">
                      {language === 'ar' ? s.plan_name_ar : s.plan_name_en}
                    </td>
                    <td className="py-3 px-3 font-mono font-bold">
                      {s.device_limit} {language === 'ar' ? 'هواتف' : 'phones'}
                    </td>
                    <td className="py-3 px-3">
                      <span className={`px-2.5 py-0.5 rounded-full text-label-xs font-bold ${
                        s.status === 'active' ? 'bg-primary/10 text-primary' : 'bg-surface-container text-on-surface-variant'
                      }`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-label-xs text-on-surface-variant">
                      {new Date(s.starts_at).toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US')}
                    </td>
                    <td className="py-3 px-3 text-label-xs text-on-surface font-semibold">
                      {new Date(s.ends_at).toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 6. PLATFORM INBOUND FEED TAB */}
      {activeTab === 'inbound' && (
        <div className="p-6 rounded-2xl bg-surface-container-lowest border border-outline-variant shadow-xs space-y-4">
          <div>
            <h3 className="text-title-md font-bold text-on-surface">
              {language === 'ar' ? 'التحويلات المستلمة على هاتف استقبال المنصة' : 'Inbound Transfers on Platform Receiver'}
            </h3>
            <p className="text-body-xs text-on-surface-variant">
              {language === 'ar'
                ? 'الرسائل والتحويلات الملتقطة فعلياً من تطبيق إنستاباي على هاتف صاحب المنصة DEV-PLATFORM-01'
                : 'Raw confirmed inbound payments captured by the platform receiver phone'}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left rtl:text-right border-collapse">
              <thead>
                <tr className="border-b border-outline-variant text-label-sm text-on-surface-variant font-semibold">
                  <th className="py-2.5 px-3">{language === 'ar' ? 'رقم العملية (TRX ID)' : 'TRX ID'}</th>
                  <th className="py-2.5 px-3">{language === 'ar' ? 'المبلغ' : 'Amount'}</th>
                  <th className="py-2.5 px-3">{language === 'ar' ? 'اسم / رقم المحوّل' : 'Sender'}</th>
                  <th className="py-2.5 px-3">{language === 'ar' ? 'وقت التحويل' : 'Timestamp'}</th>
                  <th className="py-2.5 px-3">{language === 'ar' ? 'الطلب المطابق' : 'Matched Order'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/60 text-body-sm">
                {platformTxns.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-on-surface-variant">
                      {language === 'ar' ? 'لا توجد تحويلات مسجلة بعد على محفظة المنصة.' : 'No inbound platform transactions yet.'}
                    </td>
                  </tr>
                ) : (
                  platformTxns.map((tx) => (
                    <tr key={tx.id} className="hover:bg-surface-container-low/50 transition-colors">
                      <td className="py-3 px-3 font-mono font-bold text-on-surface text-label-xs">
                        {tx.external_trx_id}
                      </td>
                      <td className="py-3 px-3 font-mono font-bold text-primary">
                        {tx.amount.toLocaleString()} ج.م
                      </td>
                      <td className="py-3 px-3 text-label-xs text-on-surface">
                        {tx.sender_name || tx.sender_phone || 'InstaPay Transfer'}
                      </td>
                      <td className="py-3 px-3 text-label-xs text-on-surface-variant">
                        {new Date(tx.financial_event_at).toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US')}
                      </td>
                      <td className="py-3 px-3 font-mono text-label-xs">
                        {tx.matched_order_number ? (
                          <span className="px-2 py-0.5 rounded bg-primary/10 text-primary font-bold">
                            {tx.matched_order_number}
                          </span>
                        ) : (
                          <span className="text-on-surface-variant">{language === 'ar' ? 'متاح للمطابقة' : 'Unassigned'}</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Decision Modal (Approve / Reject) */}
      {selectedOrder && approvalAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95">
            <div className="p-6 bg-surface-container-low border-b border-outline-variant flex items-center justify-between">
              <h3 className="text-title-md font-bold text-on-surface">
                {approvalAction === 'approve'
                  ? language === 'ar' ? 'اعتماد الطلب وتفعيل الاشتراك' : 'Approve & Activate Subscription'
                  : language === 'ar' ? 'رفض طلب الاشتراك' : 'Reject Subscription Order'}
              </h3>
              <button
                onClick={() => {
                  setSelectedOrder(null);
                  setApprovalAction(null);
                }}
                className="p-1 rounded-lg text-on-surface-variant hover:bg-surface-container"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-3.5 rounded-xl bg-surface-container-low border border-outline-variant/60 text-body-sm space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-on-surface-variant">{language === 'ar' ? 'المتجر:' : 'Merchant:'}</span>
                  <span className="font-bold">{selectedOrder.org_name_ar || selectedOrder.org_name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-on-surface-variant">{language === 'ar' ? 'الباقة:' : 'Plan:'}</span>
                  <span className="font-bold text-primary">{selectedOrder.plan_name_ar}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-on-surface-variant">{language === 'ar' ? 'المبلغ:' : 'Amount:'}</span>
                  <span className="font-mono font-bold">{selectedOrder.price_egp} ج.م</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-on-surface-variant">{language === 'ar' ? 'المرجع المدخل من المشترك:' : 'Reported Ref:'}</span>
                  <span className="font-mono text-label-xs font-bold text-primary">{selectedOrder.reported_transfer_ref || '—'}</span>
                </div>
              </div>

              {approvalAction === 'approve' && (
                <div>
                  <label className="block text-label-sm font-bold text-on-surface mb-1">
                    {language === 'ar' ? 'ربط بتحويل وارد من هاتف المنصة (اختياري):' : 'Bind Platform Inbound Transaction (Optional):'}
                  </label>
                  <select
                    value={selectedTxnId}
                    onChange={(e) => setSelectedTxnId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-body-sm"
                  >
                    <option value="">{language === 'ar' ? '-- بدون ربط مباشر --' : '-- No direct binding --'}</option>
                    {platformTxns.filter((t) => !t.matched_order_number && t.amount === selectedOrder.price_egp).map((tx) => (
                      <option key={tx.id} value={tx.id}>
                        {tx.external_trx_id} — {tx.amount} ج.م ({tx.sender_name || tx.sender_phone || 'InstaPay'})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-label-sm font-bold text-on-surface mb-1">
                  {approvalAction === 'approve'
                    ? language === 'ar' ? 'سبب وملاحظات الاعتماد (إلزامي لسجل التدقيق):' : 'Approval Reason (Mandatory):'
                    : language === 'ar' ? 'سبب الرفض (إلزامي):' : 'Rejection Reason (Mandatory):'}
                </label>
                <textarea
                  required
                  rows={3}
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  placeholder={language === 'ar' ? 'أدخل السبب الموثق...' : 'Enter documented reason...'}
                  className="w-full px-3.5 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-body-sm focus:outline-none focus:border-primary resize-none"
                />
              </div>
            </div>

            <div className="p-4 border-t border-outline-variant bg-surface-container-low flex items-center justify-between">
              <button
                onClick={() => {
                  setSelectedOrder(null);
                  setApprovalAction(null);
                }}
                className="px-4 py-2 rounded-lg bg-surface-container-high hover:bg-surface-container text-on-surface text-label-sm font-semibold transition-all cursor-pointer"
              >
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>

              <button
                onClick={approvalAction === 'approve' ? handleApproveOrder : handleRejectOrder}
                disabled={isProcessingAction || !actionReason}
                className={`px-5 py-2.5 rounded-xl font-bold text-label-md flex items-center gap-1.5 transition-all cursor-pointer shadow-xs disabled:opacity-50 ${
                  approvalAction === 'approve'
                    ? 'bg-primary text-on-primary hover:bg-primary/90'
                    : 'bg-error text-on-error hover:bg-error/90'
                }`}
              >
                <span className="material-symbols-outlined text-lg">
                  {approvalAction === 'approve' ? 'check_circle' : 'cancel'}
                </span>
                <span>
                  {approvalAction === 'approve'
                    ? language === 'ar' ? 'تأكيد التفعيل' : 'Confirm Activation'
                    : language === 'ar' ? 'تأكيد الرفض' : 'Confirm Rejection'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
