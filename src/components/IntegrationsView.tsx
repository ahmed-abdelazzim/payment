import React, { useState, useEffect, useCallback } from 'react';
import { Workspace, User } from '../types';
import { apiFetch } from '../api';

interface IntegrationsViewProps {
  workspace: Workspace;
  currentUser: User;
  language: 'en' | 'ar';
  showToast: (msg: string) => void;
}

interface QuickSetupData {
  keys: {
    live: { publicKey: string; secretPreview: string };
    test: { publicKey: string; secretPreview: string; testSecretKey?: string };
  };
  webhookUrl: string;
  webhookSecretConfigured: boolean;
  activeSourcesCount: number;
  onlineDevicesCount: number;
  isReadyForPayments: boolean;
}

interface PaymentLinkItem {
  id: string;
  title: string;
  description?: string;
  amount: number;
  currency: string;
  isActive: boolean;
  reusable: boolean;
  redirectUrl?: string;
  totalCollected: number;
  successfulPaymentsCount: number;
  createdAt: string;
}

interface WebhookDeliveryItem {
  id: string;
  endpoint_id: string;
  event_id: string;
  http_status: number | null;
  response_body: string | null;
  attempt: number;
  delivered_at: string;
  url: string;
}

export const IntegrationsView: React.FC<IntegrationsViewProps> = ({
  workspace,
  language,
  showToast,
}) => {
  const [subTab, setSubTab] = useState<'setup' | 'plugins' | 'links' | 'simulator' | 'logs'>('setup');
  const [setupData, setSetupData] = useState<QuickSetupData | null>(null);
  const [paymentLinks, setPaymentLinks] = useState<PaymentLinkItem[]>([]);
  const [webhookLogs, setWebhookLogs] = useState<WebhookDeliveryItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Key visibility & copy state
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isTestMode, setIsTestMode] = useState<boolean>(false);

  // Webhook settings modal/form
  const [webhookUrlInput, setWebhookUrlInput] = useState<string>('');
  const [webhookSecretInput, setWebhookSecretInput] = useState<string>('');
  const [isSavingWebhook, setIsSavingWebhook] = useState<boolean>(false);
  const [isPingingWebhook, setIsPingingWebhook] = useState<boolean>(false);

  // New Payment Link Modal
  const [isCreateLinkOpen, setIsCreateLinkOpen] = useState<boolean>(false);
  const [newLinkTitle, setNewLinkTitle] = useState<string>('');
  const [newLinkAmount, setNewLinkAmount] = useState<string>('');
  const [newLinkDesc, setNewLinkDesc] = useState<string>('');
  const [newLinkRedirect, setNewLinkRedirect] = useState<string>('');
  const [isSubmittingLink, setIsSubmittingLink] = useState<boolean>(false);

  // Simulator State
  const [simAmount, setSimAmount] = useState<string>('250.00');
  const [simOrderId, setSimOrderId] = useState<string>('SIM-ORDER-101');
  const [simCustomerName, setSimCustomerName] = useState<string>('أحمد سمير');
  const [simCustomerPhone, setSimCustomerPhone] = useState<string>('01012345678');
  const [activeSimSession, setActiveSimSession] = useState<any | null>(null);
  const [isCreatingSim, setIsCreatingSim] = useState<boolean>(false);
  const [isSimulatingPayment, setIsSimulatingPayment] = useState<boolean>(false);

  // Fetch Quick Setup Data
  const loadSetupData = useCallback(async () => {
    try {
      const res = await apiFetch('/api/v1/api-keys/quick-setup');
      if (res.ok) {
        const data: QuickSetupData = await res.json();
        setSetupData(data);
        setWebhookUrlInput(data.webhookUrl || '');
      }
    } catch {}
    setIsLoading(false);
  }, []);

  // Fetch Payment Links
  const loadPaymentLinks = useCallback(async () => {
    try {
      const res = await apiFetch('/api/v1/payment-links');
      if (res.ok) {
        const data: PaymentLinkItem[] = await res.json();
        setPaymentLinks(data);
      }
    } catch {}
  }, []);

  // Fetch Webhook Deliveries
  const loadWebhookLogs = useCallback(async () => {
    try {
      const res = await apiFetch('/api/v1/integrations/webhooks/deliveries');
      if (res.ok) {
        const data: WebhookDeliveryItem[] = await res.json();
        setWebhookLogs(data);
      }
    } catch {}
  }, []);

  useEffect(() => {
    loadSetupData();
  }, [loadSetupData]);

  useEffect(() => {
    if (subTab === 'links') loadPaymentLinks();
    if (subTab === 'logs') loadWebhookLogs();
  }, [subTab, loadPaymentLinks, loadWebhookLogs]);

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(label);
    showToast(language === 'ar' ? `تم نسخ ${label} بنجاح!` : `${label} copied to clipboard!`);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const handleSaveWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingWebhook(true);
    try {
      const res = await apiFetch('/api/v1/organizations/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhookUrl: webhookUrlInput.trim(),
          webhookSecret: webhookSecretInput.trim() || undefined,
        }),
      });
      if (res.ok) {
        showToast(language === 'ar' ? 'تم حفظ إعدادات الـ Webhook بنجاح!' : 'Webhook settings saved successfully!');
        loadSetupData();
      } else {
        const err = await res.json();
        showToast(err.message || 'فشل حفظ الإعدادات');
      }
    } catch {
      showToast('تعذر حفظ الإعدادات حالياً');
    } finally {
      setIsSavingWebhook(false);
    }
  };

  const handleTestPingWebhook = async () => {
    setIsPingingWebhook(true);
    try {
      const res = await apiFetch('/api/v1/integrations/webhooks/test-ping', { method: 'POST' });
      const data = await res.json();
      showToast(data.message || (data.success ? 'تم استلام الإشعار بنجاح!' : 'فشل الاتصال'));
      loadWebhookLogs();
    } catch (err: any) {
      showToast(err.message || 'تعذر الاتصال بـ Webhook');
    } finally {
      setIsPingingWebhook(false);
    }
  };

  const handleCreatePaymentLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLinkTitle || !newLinkAmount) return;
    setIsSubmittingLink(true);

    try {
      const res = await apiFetch('/api/v1/payment-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newLinkTitle,
          description: newLinkDesc,
          amount: parseFloat(newLinkAmount),
          redirectUrl: newLinkRedirect,
          reusable: true,
        }),
      });

      if (res.ok) {
        showToast(language === 'ar' ? 'تم إنشاء رابط الدفع بنجاح!' : 'Payment link created successfully!');
        setIsCreateLinkOpen(false);
        setNewLinkTitle('');
        setNewLinkAmount('');
        setNewLinkDesc('');
        setNewLinkRedirect('');
        loadPaymentLinks();
      } else {
        const err = await res.json();
        showToast(err.message || 'فشل إنشاء الرابط');
      }
    } catch {
      showToast('تعذر إنشاء رابط الدفع');
    } finally {
      setIsSubmittingLink(false);
    }
  };

  const handleToggleLink = async (linkId: string) => {
    try {
      const res = await apiFetch(`/api/v1/payment-links/${linkId}/toggle`, { method: 'POST' });
      if (res.ok) {
        loadPaymentLinks();
        showToast(language === 'ar' ? 'تم تحديث حالة الرابط' : 'Link status updated');
      }
    } catch {}
  };

  const handleDeleteLink = async (linkId: string) => {
    if (!confirm(language === 'ar' ? 'هل أنت متأكد من حذف رابط الدفع هذا؟' : 'Are you sure you want to delete this payment link?')) return;
    try {
      const res = await apiFetch(`/api/v1/payment-links/${linkId}`, { method: 'DELETE' });
      if (res.ok) {
        loadPaymentLinks();
        showToast(language === 'ar' ? 'تم حذف الرابط بنجاح' : 'Payment link deleted');
      }
    } catch {}
  };

  const handleStartSimulation = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreatingSim(true);
    try {
      const res = await apiFetch('/api/v1/checkout/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: parseFloat(simAmount),
          orderId: simOrderId,
          customerName: simCustomerName,
          customerPhone: simCustomerPhone,
          mode: 'test',
          metadata: { simulator: true },
        }),
      });
      if (res.ok) {
        const session = await res.json();
        setActiveSimSession(session);
        showToast(language === 'ar' ? 'تم إنشاء جلسة دفع تجريبية!' : 'Sandbox test session created!');
      } else {
        const err = await res.json();
        showToast(err.message || 'فشل إنشاء الجلسة التجريبية');
      }
    } catch {
      showToast('تعذر بدء المحاكاة');
    } finally {
      setIsCreatingSim(false);
    }
  };

  const handleSimulatePayment = async () => {
    if (!activeSimSession) return;
    setIsSimulatingPayment(true);
    try {
      const res = await apiFetch(`/api/v1/checkout/sessions/${activeSimSession.id}/simulate`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setActiveSimSession(data.session);
        showToast(language === 'ar' ? 'تمت محاكاة التحويل وتم تأكيد الدفع بنجاح! 🎉' : 'Payment simulated & confirmed! 🎉');
        loadWebhookLogs();
      }
    } catch {
      showToast('فشلت محاكاة الدفع');
    } finally {
      setIsSimulatingPayment(false);
    }
  };

  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const currentKeys = isTestMode ? setupData?.keys.test : setupData?.keys.live;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6 animate-fade-in" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      {/* Top Hero Banner */}
      <div className="p-6 sm:p-8 rounded-3xl bg-gradient-to-r from-blue-900/40 via-indigo-900/30 to-slate-900/50 border border-blue-500/20 backdrop-blur-xl relative overflow-hidden shadow-2xl">
        <div className="absolute top-0 right-0 w-72 h-72 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 rounded-full bg-blue-500/20 border border-blue-500/30 text-blue-400 font-bold text-xs">
                {language === 'ar' ? 'بوابة الدفع ومساحة الربط' : 'Payment Gateway & Open Workspace'}
              </span>
              <span className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-medium text-xs flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                {language === 'ar' ? 'محافظ مصر مؤتمتة' : 'Automated Egyptian Rails'}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-on-surface tracking-tight">
              {language === 'ar'
                ? `ربط متجر ${workspace.nameAr || workspace.name} ببوابة صرّاف`
                : `Connect ${workspace.name} with Sarraf Gateway`}
            </h1>
            <p className="text-sm text-on-surface-variant max-w-2xl leading-relaxed">
              {language === 'ar'
                ? 'حوّل صرّاف إلى بوابة دفع متكاملة لمتجرك على Shopify أو WooCommerce أو Easy Orders أو أي موقع مخصص. تقبل فودافون كاش وإنستاباي مع تأكيد فوري آلي.'
                : 'Turn Sarraf into a full payment gateway on Shopify, WooCommerce, Easy Orders, or custom websites. Accept Vodafone Cash & InstaPay with instant automated reconciliation.'}
            </p>
          </div>

          {/* Sandbox Toggle */}
          <div className="flex items-center gap-3 p-3 rounded-2xl bg-surface-container-low/80 border border-outline-variant shrink-0">
            <div className="text-right rtl:text-right ltr:text-left">
              <span className="text-xs font-bold text-on-surface block">
                {isTestMode ? (language === 'ar' ? 'الوضع التجريبي (Sandbox)' : 'Test Mode') : (language === 'ar' ? 'الوضع الحي (Live Mode)' : 'Live Mode')}
              </span>
              <span className="text-[11px] text-on-surface-variant block">
                {isTestMode ? (language === 'ar' ? 'مفاتيح pk_test / sk_test' : 'Using test keys') : (language === 'ar' ? 'معاملات بنكية حقيقية' : 'Production mode')}
              </span>
            </div>
            <button
              onClick={() => setIsTestMode(!isTestMode)}
              className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer ${
                isTestMode ? 'bg-amber-500' : 'bg-emerald-600'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
                  isTestMode ? (language === 'ar' ? 'left-1' : 'right-1') : (language === 'ar' ? 'right-1' : 'left-1')
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Sub Tabs Navigation */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-outline-variant">
        <button
          onClick={() => setSubTab('setup')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-bold transition-all cursor-pointer shrink-0 ${
            subTab === 'setup'
              ? 'bg-primary text-on-primary shadow-md shadow-primary/20'
              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low'
          }`}
        >
          <span className="material-symbols-outlined text-base">key</span>
          <span>{language === 'ar' ? 'المفاتيح وبوابة الدفع' : 'API Keys & Setup'}</span>
        </button>

        <button
          onClick={() => setSubTab('plugins')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-bold transition-all cursor-pointer shrink-0 ${
            subTab === 'plugins'
              ? 'bg-primary text-on-primary shadow-md shadow-primary/20'
              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low'
          }`}
        >
          <span className="material-symbols-outlined text-base">extension</span>
          <span>{language === 'ar' ? 'إضافات المتاجر (WooCommerce / Shopify / Easy Orders)' : 'Store Plugins & SDK'}</span>
        </button>

        <button
          onClick={() => setSubTab('links')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-bold transition-all cursor-pointer shrink-0 ${
            subTab === 'links'
              ? 'bg-primary text-on-primary shadow-md shadow-primary/20'
              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low'
          }`}
        >
          <span className="material-symbols-outlined text-base">link</span>
          <span>{language === 'ar' ? 'روابط الدفع السريعة' : 'Payment Links'}</span>
        </button>

        <button
          onClick={() => setSubTab('simulator')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-bold transition-all cursor-pointer shrink-0 ${
            subTab === 'simulator'
              ? 'bg-primary text-on-primary shadow-md shadow-primary/20'
              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low'
          }`}
        >
          <span className="material-symbols-outlined text-base">science</span>
          <span>{language === 'ar' ? 'المختبر والتجربة الحية (Simulator)' : 'Live Simulator'}</span>
        </button>

        <button
          onClick={() => setSubTab('logs')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-bold transition-all cursor-pointer shrink-0 ${
            subTab === 'logs'
              ? 'bg-primary text-on-primary shadow-md shadow-primary/20'
              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low'
          }`}
        >
          <span className="material-symbols-outlined text-base">receipt_long</span>
          <span>{language === 'ar' ? 'سجل إشعارات الـ Webhook' : 'Webhook Logs'}</span>
        </button>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* SUB-TAB 1: API KEYS & QUICK SETUP */}
      {/* ------------------------------------------------------------- */}
      {subTab === 'setup' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Keys & Webhook Config */}
          <div className="lg:col-span-2 space-y-6">
            {/* Keys Card */}
            <div className="p-6 rounded-3xl bg-surface-container-lowest border border-outline-variant shadow-md space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-outline-variant">
                <div>
                  <h3 className="text-base font-bold text-on-surface">
                    {language === 'ar' ? 'مفاتيح الربط البرمجي (API Credentials)' : 'API Credentials'}
                  </h3>
                  <p className="text-xs text-on-surface-variant">
                    {language === 'ar'
                      ? 'استخدم هذه المفاتيح في متجرك لربط عمليات الدفع آلياً عبر خوادم صرّاف.'
                      : 'Use these credentials in your e-commerce store plugin or custom backend.'}
                  </p>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase ${
                  isTestMode ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' : 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
                }`}>
                  {isTestMode ? 'Sandbox' : 'Production'}
                </span>
              </div>

              {/* Public Key */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-on-surface-variant flex items-center justify-between">
                  <span>{language === 'ar' ? 'المفتاح العام (Public Key - للواجهات الأمامية و SDK):' : 'Public Key (Client SDK):'}</span>
                  <span className="text-[11px] text-blue-500 font-mono">pk_{isTestMode ? 'test' : 'live'}_...</span>
                </label>
                <div className="flex items-center gap-2 p-2 rounded-2xl bg-surface-container-low border border-outline-variant">
                  <span className="text-xs font-mono text-on-surface px-2 truncate flex-1" dir="ltr">
                    {currentKeys?.publicKey || 'جاري التحميل...'}
                  </span>
                  <button
                    onClick={() => currentKeys?.publicKey && copyText(currentKeys.publicKey, 'المفتاح العام')}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-surface-container hover:bg-surface-container-high text-xs font-bold text-on-surface transition-all cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-sm">
                      {copiedKey === 'المفتاح العام' ? 'check' : 'content_copy'}
                    </span>
                    <span>{copiedKey === 'المفتاح العام' ? (language === 'ar' ? 'تم النسخ' : 'Copied') : (language === 'ar' ? 'نسخ' : 'Copy')}</span>
                  </button>
                </div>
              </div>

              {/* Secret Key Preview */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-on-surface-variant flex items-center justify-between">
                  <span>{language === 'ar' ? 'المفتاح السري (Secret Key - لخوادم المتاجر والـ Webhook):' : 'Secret Key (Server-side):'}</span>
                  <span className="text-[11px] text-amber-600 font-mono">sk_{isTestMode ? 'test' : 'live'}_...</span>
                </label>
                <div className="flex items-center gap-2 p-2 rounded-2xl bg-surface-container-low border border-outline-variant">
                  <span className="text-xs font-mono text-on-surface px-2 truncate flex-1" dir="ltr">
                    {currentKeys?.secretPreview || 'sk_••••••••••••••••'}
                  </span>
                  {isTestMode && setupData?.keys.test.testSecretKey ? (
                    <button
                      onClick={() => copyText(setupData.keys.test.testSecretKey!, 'المفتاح السري التجريبي')}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-surface-container hover:bg-surface-container-high text-xs font-bold text-on-surface transition-all cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-sm">content_copy</span>
                      <span>{language === 'ar' ? 'نسخ المفتاح السري' : 'Copy Secret'}</span>
                    </button>
                  ) : (
                    <span className="text-[11px] text-on-surface-variant px-2">
                      {language === 'ar' ? 'مشفر بأمان (تم حفظه عند الإنشاء)' : 'Encrypted securely'}
                    </span>
                  )}
                </div>
              </div>

              {/* Gateway URL */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-on-surface-variant">
                  {language === 'ar' ? 'رابط بوابة صرّاف (Gateway Base URL):' : 'Gateway Base URL:'}
                </label>
                <div className="flex items-center gap-2 p-2 rounded-2xl bg-surface-container-low border border-outline-variant">
                  <span className="text-xs font-mono text-on-surface px-2 truncate flex-1" dir="ltr">
                    {currentOrigin}
                  </span>
                  <button
                    onClick={() => copyText(currentOrigin, 'رابط البوابة')}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-surface-container hover:bg-surface-container-high text-xs font-bold text-on-surface transition-all cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-sm">content_copy</span>
                    <span>{language === 'ar' ? 'نسخ الرابط' : 'Copy URL'}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Webhook Configuration Card */}
            <div className="p-6 rounded-3xl bg-surface-container-lowest border border-outline-variant shadow-md space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-outline-variant">
                <div>
                  <h3 className="text-base font-bold text-on-surface">
                    {language === 'ar' ? 'إعدادات إشعار المتجر (Webhook Notifications)' : 'Webhook Configuration'}
                  </h3>
                  <p className="text-xs text-on-surface-variant">
                    {language === 'ar'
                      ? 'عند تأكيد أي عملية دفع، سيقوم صرّاف بإرسال إشعار لحظي موقع لمتجرك لتأكيد الطلب آلياً.'
                      : 'When a payment is confirmed, Sarraf sends a signed POST payload to your store to fulfill orders.'}
                  </p>
                </div>
                <button
                  onClick={handleTestPingWebhook}
                  disabled={isPingingWebhook || !setupData?.webhookUrl}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 disabled:opacity-50 text-blue-600 text-xs font-bold transition-all cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm">send</span>
                  <span>{isPingingWebhook ? (language === 'ar' ? 'جاري الإرسال...' : 'Sending...') : (language === 'ar' ? 'إرسال فحص تجريبي Test Ping' : 'Test Ping')}</span>
                </button>
              </div>

              <form onSubmit={handleSaveWebhook} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-on-surface-variant block">
                    {language === 'ar' ? 'رابط الـ Webhook في متجرك (Endpoint URL):' : 'Store Webhook URL:'}
                  </label>
                  <input
                    type="url"
                    value={webhookUrlInput}
                    onChange={(e) => setWebhookUrlInput(e.target.value)}
                    placeholder="https://yourstore.com/?wc-api=sarraf_webhook"
                    className="w-full px-4 py-2.5 rounded-2xl bg-surface-container-low border border-outline-variant text-xs text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary font-mono"
                    dir="ltr"
                  />
                  <p className="text-[11px] text-on-surface-variant">
                    {language === 'ar'
                      ? 'مثال لووكوميرس: https://store.com/?wc-api=sarraf_webhook | لإيزي أوردرز: استخدم الروابط في تبويب الإضافات.'
                      : 'WooCommerce example: https://store.com/?wc-api=sarraf_webhook'}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-on-surface-variant block">
                    {language === 'ar' ? 'سر التوقيع الرقمي (Signing Secret - اختياري للتشفير):' : 'Signing Secret (Optional):'}
                  </label>
                  <input
                    type="password"
                    value={webhookSecretInput}
                    onChange={(e) => setWebhookSecretInput(e.target.value)}
                    placeholder={setupData?.webhookSecretConfigured ? '•••••••••••••••• (مضبوط بالفعل)' : 'sec_live_...'}
                    className="w-full px-4 py-2.5 rounded-2xl bg-surface-container-low border border-outline-variant text-xs text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary font-mono"
                    dir="ltr"
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={isSavingWebhook}
                    className="px-6 py-2.5 rounded-2xl bg-primary hover:bg-primary/90 text-on-primary text-xs font-bold transition-all shadow-md shadow-primary/20 cursor-pointer disabled:opacity-50"
                  >
                    {isSavingWebhook ? (language === 'ar' ? 'جاري الحفظ...' : 'Saving...') : (language === 'ar' ? 'حفظ إعدادات الـ Webhook' : 'Save Webhook Settings')}
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* Right Column: Readiness Checklist */}
          <div className="space-y-6">
            <div className="p-6 rounded-3xl bg-surface-container-lowest border border-outline-variant shadow-md space-y-4">
              <h3 className="text-base font-bold text-on-surface">
                {language === 'ar' ? 'حالة جاهزية بوابة الدفع' : 'Gateway Readiness'}
              </h3>
              <p className="text-xs text-on-surface-variant">
                {language === 'ar'
                  ? 'تحقق من اكتمال النقاط التالية لاستقبال المدفوعات من عملائك بنجاح:'
                  : 'Ensure the following prerequisites are complete to accept customer payments:'}
              </p>

              <div className="space-y-3">
                {/* 1. Payment Sources */}
                <div className="p-3 rounded-2xl bg-surface-container-low border border-outline-variant flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className={`material-symbols-outlined text-lg ${
                      (setupData?.activeSourcesCount || 0) > 0 ? 'text-emerald-500' : 'text-amber-500'
                    }`}>
                      {(setupData?.activeSourcesCount || 0) > 0 ? 'check_circle' : 'pending'}
                    </span>
                    <div>
                      <span className="text-xs font-bold text-on-surface block">
                        {language === 'ar' ? 'محافظ الاستقبال (فودافون كاش / إنستاباي)' : 'Receiving Wallets'}
                      </span>
                      <span className="text-[11px] text-on-surface-variant block">
                        {setupData?.activeSourcesCount || 0} {language === 'ar' ? 'محفظة نشطة' : 'active sources'}
                      </span>
                    </div>
                  </div>
                  {(setupData?.activeSourcesCount || 0) === 0 && (
                    <span className="text-[10px] font-bold text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded-md">
                      {language === 'ar' ? 'مطلوب إضافة محفظة' : 'Required'}
                    </span>
                  )}
                </div>

                {/* 2. Capture Device */}
                <div className="p-3 rounded-2xl bg-surface-container-low border border-outline-variant flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className={`material-symbols-outlined text-lg ${
                      (setupData?.onlineDevicesCount || 0) > 0 ? 'text-emerald-500' : 'text-amber-500'
                    }`}>
                      {(setupData?.onlineDevicesCount || 0) > 0 ? 'check_circle' : 'pending'}
                    </span>
                    <div>
                      <span className="text-xs font-bold text-on-surface block">
                        {language === 'ar' ? 'هاتف تتبع الإشعارات (POS Terminal)' : 'POS Capture Phone'}
                      </span>
                      <span className="text-[11px] text-on-surface-variant block">
                        {setupData?.onlineDevicesCount || 0} {language === 'ar' ? 'هاتف متصل بالإنترنت' : 'terminals online'}
                      </span>
                    </div>
                  </div>
                  {(setupData?.onlineDevicesCount || 0) === 0 && (
                    <span className="text-[10px] font-bold text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded-md">
                      {language === 'ar' ? 'اربط هاتفك' : 'Offline'}
                    </span>
                  )}
                </div>

                {/* 3. Webhook URL */}
                <div className="p-3 rounded-2xl bg-surface-container-low border border-outline-variant flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className={`material-symbols-outlined text-lg ${
                      setupData?.webhookUrl ? 'text-emerald-500' : 'text-slate-400'
                    }`}>
                      {setupData?.webhookUrl ? 'check_circle' : 'radio_button_unchecked'}
                    </span>
                    <div>
                      <span className="text-xs font-bold text-on-surface block">
                        {language === 'ar' ? 'رابط الـ Webhook للمتجر' : 'Store Webhook'}
                      </span>
                      <span className="text-[11px] text-on-surface-variant block">
                        {setupData?.webhookUrl ? (language === 'ar' ? 'تم ضبط الرابط' : 'Configured') : (language === 'ar' ? 'اختياري لتأكيد الطلب آلياً' : 'Optional')}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-outline-variant">
                <div className="p-3 rounded-2xl bg-blue-500/10 text-blue-700 dark:text-blue-300 text-xs space-y-1">
                  <span className="font-bold block flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">verified_user</span>
                    {language === 'ar' ? 'بوابة دفع بدون وسيط' : 'Direct Peer-to-Peer Gateway'}
                  </span>
                  <p className="text-[11px] leading-relaxed">
                    {language === 'ar'
                      ? 'أموال مبيعاتك تصل مباشرة وفوراً إلى محفظتك الخاصة بدون أي استقطاعات أو تأخير في التحويل!'
                      : 'Customer funds arrive immediately and directly to your own wallet without gateway middleman delays!'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* SUB-TAB 2: STORE PLUGINS & DROP-IN SDK */}
      {/* ------------------------------------------------------------- */}
      {subTab === 'plugins' && (
        <div className="space-y-6">
          {/* E-Commerce Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* WooCommerce */}
            <div className="p-6 rounded-3xl bg-surface-container-lowest border border-outline-variant shadow-md flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-purple-500/10 text-purple-600 flex items-center justify-center font-black text-xl">
                  W
                </div>
                <h3 className="text-lg font-bold text-on-surface">WooCommerce / WordPress</h3>
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  {language === 'ar'
                    ? 'إضافة ووكوميرس رسمية جاهزة للتحميل والتثبيت الفوري. تتيح وسيلة دفع فودافون كاش وإنستاباي مع تحديث حالة الطلبات تلقائياً.'
                    : 'Downloadable ready WooCommerce payment gateway plugin. Auto-completes orders upon payment confirmation.'}
                </p>
              </div>

              <div className="pt-4 border-t border-outline-variant space-y-2">
                <a
                  href="/api/v1/integrations/woocommerce/plugin-download"
                  download="class-wc-gateway-sarraf.php"
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-2xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs transition-all shadow-md shadow-purple-600/20 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm">download</span>
                  <span>{language === 'ar' ? 'تحميل إضافة ووكوميرس (PHP)' : 'Download Plugin (.php)'}</span>
                </a>
              </div>
            </div>

            {/* Shopify */}
            <div className="p-6 rounded-3xl bg-surface-container-lowest border border-outline-variant shadow-md flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-black text-xl">
                  S
                </div>
                <h3 className="text-lg font-bold text-on-surface">Shopify (شوبيفاي)</h3>
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  {language === 'ar'
                    ? 'ربط وسيلة دفع مخصصة (Custom Manual Payment Method) مع ربط Webhook الـ Orders لتحويل المشتري لصفحة الدفع وتأكيد الطلب.'
                    : 'Connect custom manual payment instructions with Shopify webhooks to automatically verify orders.'}
                </p>
              </div>

              <div className="pt-4 border-t border-outline-variant space-y-2">
                <button
                  onClick={() => copyText(`${currentOrigin}/api/v1/integrations/shopify/webhook?api_key=${currentKeys?.publicKey}`, 'Shopify Webhook URL')}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-all shadow-md shadow-emerald-600/20 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm">content_copy</span>
                  <span>{language === 'ar' ? 'نسخ رابط Shopify Webhook' : 'Copy Shopify Webhook'}</span>
                </button>
              </div>
            </div>

            {/* Easy Orders */}
            <div className="p-6 rounded-3xl bg-surface-container-lowest border border-outline-variant shadow-md flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-blue-500/10 text-blue-600 flex items-center justify-center font-black text-xl">
                  EO
                </div>
                <h3 className="text-lg font-bold text-on-surface">Easy Orders (إيزي أوردرز)</h3>
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  {language === 'ar'
                    ? 'المنصة الأكثر شعبية في مصر للتجارة الإلكترونية. أضف وسيلة دفع في إيزي أوردرز واربط Webhook الطلبات لإنشاء روابط الدفع فوراً.'
                    : 'Direct integration with Easy Orders platform. Auto-generates payment links upon order submission.'}
                </p>
              </div>

              <div className="pt-4 border-t border-outline-variant space-y-2">
                <button
                  onClick={() => copyText(`${currentOrigin}/api/v1/integrations/easyorders/webhook?api_key=${currentKeys?.publicKey}`, 'Easy Orders Webhook URL')}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-all shadow-md shadow-blue-600/20 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm">content_copy</span>
                  <span>{language === 'ar' ? 'نسخ رابط Easy Orders Webhook' : 'Copy Easy Orders Webhook'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Drop-in JavaScript SDK Embed Code Box */}
          <div className="p-6 rounded-3xl bg-surface-container-lowest border border-outline-variant shadow-md space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-outline-variant">
              <div>
                <h3 className="text-base font-bold text-on-surface">
                  {language === 'ar' ? 'كود التضمين المباشر لمواقع الويب (Drop-in JS SDK)' : 'Drop-in JS SDK for Custom Websites'}
                </h3>
                <p className="text-xs text-on-surface-variant">
                  {language === 'ar'
                    ? 'أضف زر الدفع أو نافذة الدفع المنبثقة مباشرة في أي موقع HTML أو React أو PHP بسطر كود واحد:'
                    : 'Add a sleek checkout modal or button to any website with a single line of JavaScript:'}
                </p>
              </div>
              <button
                onClick={() => copyText(`<script src="${currentOrigin}/sdk/sarraf-pay.js"></script>\n<script>\n  SarrafPay.checkout({\n    publicKey: '${currentKeys?.publicKey}',\n    amount: 250.00,\n    orderId: 'ORD-1001',\n    customerName: 'أحمد محمود',\n    customerPhone: '01012345678',\n    onSuccess: function(res) { alert('تم الدفع بنجاح! رقم العملية: ' + res.transactionId); }\n  });\n</script>`, 'كود التضمين JS')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-container hover:bg-surface-container-high text-xs font-bold text-on-surface cursor-pointer"
              >
                <span className="material-symbols-outlined text-sm">content_copy</span>
                <span>{language === 'ar' ? 'نسخ الكود' : 'Copy Code'}</span>
              </button>
            </div>

            <pre className="p-4 rounded-2xl bg-slate-950 text-slate-200 text-xs font-mono overflow-x-auto border border-slate-800" dir="ltr">
{`<!-- 1. استدعاء مكتبة صرّاف في موقعك -->
<script src="${currentOrigin}/sdk/sarraf-pay.js"></script>

<!-- 2. تشغيل نافذة الدفع عند النقر على الزر -->
<button onclick="payWithSarraf()">ادفع عبر فودافون كاش / إنستاباي</button>

<script>
function payWithSarraf() {
  SarrafPay.checkout({
    publicKey: '${currentKeys?.publicKey}',
    amount: 250.00,
    orderId: 'ORD-1001',
    customerName: 'اسم العميل',
    customerPhone: '01012345678',
    onSuccess: function(data) {
      console.log('Payment Confirmed!', data);
      alert('تم الدفع بنجاح! رقم العملية: ' + data.transactionId);
    },
    onClose: function() {
      console.log('Payment modal closed');
    }
  });
}
</script>`}
            </pre>
          </div>

          {/* Server-to-Server REST API Examples */}
          <div className="p-6 rounded-3xl bg-surface-container-lowest border border-outline-variant shadow-md space-y-4">
            <h3 className="text-base font-bold text-on-surface">
              {language === 'ar' ? 'واجهة برمجة التطبيقات (REST API & cURL / Node.js)' : 'REST API & cURL / Node.js'}
            </h3>
            <p className="text-xs text-on-surface-variant">
              {language === 'ar'
                ? 'استدعاء إنشاء جلسة الدفع برمجياً من السيرفر الخلفي لمتجرك:'
                : 'Create checkout sessions programmatically from your backend:'}
            </p>

            <pre className="p-4 rounded-2xl bg-slate-950 text-slate-200 text-xs font-mono overflow-x-auto border border-slate-800" dir="ltr">
{`curl -X POST ${currentOrigin}/api/v1/checkout/sessions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${currentKeys?.publicKey?.replace('pk_', 'sk_')}" \\
  -d '{
    "order_id": "ORDER-9912",
    "amount": 350.00,
    "currency": "EGP",
    "customer_name": "كريم سامي",
    "customer_phone": "01099887766",
    "return_url": "https://yourstore.com/thank-you"
  }'`}
            </pre>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* SUB-TAB 3: PAYMENT LINKS */}
      {/* ------------------------------------------------------------- */}
      {subTab === 'links' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-on-surface">
                {language === 'ar' ? 'روابط الدفع والفواتير السريعة' : 'Instant Payment Links'}
              </h3>
              <p className="text-xs text-on-surface-variant">
                {language === 'ar'
                  ? 'أنشئ روابط دفع لمشاركتها مع عملائك عبر واتساب وفيسبوك وإنستجرام بدون الحاجة لمتجر متكامل.'
                  : 'Create shareable payment links for WhatsApp, Instagram, or direct invoicing without a website.'}
              </p>
            </div>
            <button
              onClick={() => setIsCreateLinkOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-2xl bg-primary hover:bg-primary/90 text-on-primary text-xs font-bold transition-all shadow-md shadow-primary/20 cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              <span>{language === 'ar' ? 'إنشاء رابط دفع جديد' : 'New Payment Link'}</span>
            </button>
          </div>

          {/* Links List */}
          {paymentLinks.length === 0 ? (
            <div className="p-12 text-center rounded-3xl bg-surface-container-lowest border border-outline-variant space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto">
                <span className="material-symbols-outlined text-2xl">link_off</span>
              </div>
              <h4 className="text-sm font-bold text-on-surface">
                {language === 'ar' ? 'لا توجد روابط دفع منشأة حتى الآن' : 'No payment links created yet'}
              </h4>
              <p className="text-xs text-on-surface-variant max-w-sm mx-auto">
                {language === 'ar'
                  ? 'اضغط على "إنشاء رابط دفع جديد" للبدء في تحصيل المدفوعات فوراً عبر روابط سريعة.'
                  : 'Click "New Payment Link" to start accepting payments via shareable links.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {paymentLinks.map((link) => (
                <div
                  key={link.id}
                  className="p-5 rounded-3xl bg-surface-container-lowest border border-outline-variant shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-sm font-bold text-on-surface line-clamp-1">{link.title}</h4>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        link.isActive ? 'bg-emerald-500/10 text-emerald-600' : 'bg-slate-500/10 text-slate-500'
                      }`}>
                        {link.isActive ? (language === 'ar' ? 'فعّال' : 'Active') : (language === 'ar' ? 'معطل' : 'Paused')}
                      </span>
                    </div>

                    {link.description && (
                      <p className="text-xs text-on-surface-variant line-clamp-2">{link.description}</p>
                    )}

                    <div className="flex items-baseline gap-1 pt-1">
                      <span className="text-2xl font-black text-on-surface">{link.amount.toFixed(2)}</span>
                      <span className="text-xs font-bold text-primary">ج.م</span>
                    </div>

                    <div className="p-2.5 rounded-xl bg-surface-container-low text-[11px] text-on-surface-variant flex items-center justify-between">
                      <span>{language === 'ar' ? 'التحصيلات:' : 'Collected:'}</span>
                      <span className="font-bold text-on-surface">
                        {link.totalCollected.toFixed(2)} ج.م ({link.successfulPaymentsCount} {language === 'ar' ? 'مرات' : 'txns'})
                      </span>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-outline-variant flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => copyText(`${currentOrigin}/pay/${link.id}`, 'رابط الدفع')}
                        className="px-2.5 py-1.5 rounded-xl bg-surface-container hover:bg-surface-container-high text-xs font-bold text-on-surface transition-all cursor-pointer flex items-center gap-1"
                        title={language === 'ar' ? 'نسخ الرابط للمشاركة' : 'Copy link'}
                      >
                        <span className="material-symbols-outlined text-sm">content_copy</span>
                        <span>{language === 'ar' ? 'نسخ' : 'Copy'}</span>
                      </button>

                      <a
                        href={`/pay/${link.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2.5 py-1.5 rounded-xl bg-surface-container hover:bg-surface-container-high text-xs font-bold text-on-surface transition-all cursor-pointer flex items-center gap-1"
                        title={language === 'ar' ? 'معاينة صفحة الدفع' : 'Preview'}
                      >
                        <span className="material-symbols-outlined text-sm">open_in_new</span>
                      </a>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleToggleLink(link.id)}
                        className="p-1.5 rounded-xl hover:bg-surface-container text-on-surface-variant hover:text-on-surface transition-all cursor-pointer"
                        title={link.isActive ? (language === 'ar' ? 'إيقاف مؤقت' : 'Pause') : (language === 'ar' ? 'تفعيل' : 'Activate')}
                      >
                        <span className="material-symbols-outlined text-base">
                          {link.isActive ? 'pause_circle' : 'play_circle'}
                        </span>
                      </button>

                      <button
                        onClick={() => handleDeleteLink(link.id)}
                        className="p-1.5 rounded-xl hover:bg-red-500/10 text-on-surface-variant hover:text-red-500 transition-all cursor-pointer"
                        title={language === 'ar' ? 'حذف' : 'Delete'}
                      >
                        <span className="material-symbols-outlined text-base">delete</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Create Link Modal */}
          {isCreateLinkOpen && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-fade-in">
              <div className="max-w-md w-full p-6 rounded-3xl bg-surface-container-lowest border border-outline-variant shadow-2xl space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-outline-variant">
                  <h3 className="text-base font-bold text-on-surface">
                    {language === 'ar' ? 'إنشاء رابط دفع سريع' : 'New Payment Link'}
                  </h3>
                  <button
                    onClick={() => setIsCreateLinkOpen(false)}
                    className="p-1 rounded-lg text-on-surface-variant hover:bg-surface-container"
                  >
                    <span className="material-symbols-outlined text-lg">close</span>
                  </button>
                </div>

                <form onSubmit={handleCreatePaymentLink} className="space-y-3.5">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-on-surface-variant block">
                      {language === 'ar' ? 'عنوان الرابط / الخدمة (مطلوب):' : 'Title (Required):'}
                    </label>
                    <input
                      type="text"
                      required
                      value={newLinkTitle}
                      onChange={(e) => setNewLinkTitle(e.target.value)}
                      placeholder={language === 'ar' ? 'مثال: اشتراك كورس التسويق' : 'e.g. Marketing Course'}
                      className="w-full px-3.5 py-2.5 rounded-2xl bg-surface-container-low border border-outline-variant text-xs text-on-surface focus:outline-none focus:border-primary"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-on-surface-variant block">
                      {language === 'ar' ? 'المبلغ بالجنيه المصري (مطلوب):' : 'Amount in EGP (Required):'}
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      min="1"
                      required
                      value={newLinkAmount}
                      onChange={(e) => setNewLinkAmount(e.target.value)}
                      placeholder="250.00"
                      className="w-full px-3.5 py-2.5 rounded-2xl bg-surface-container-low border border-outline-variant text-xs text-on-surface focus:outline-none focus:border-primary font-bold"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-on-surface-variant block">
                      {language === 'ar' ? 'الوصف (اختياري):' : 'Description (Optional):'}
                    </label>
                    <textarea
                      rows={2}
                      value={newLinkDesc}
                      onChange={(e) => setNewLinkDesc(e.target.value)}
                      placeholder={language === 'ar' ? 'تفاصيل الفاتورة أو الخدمة...' : 'Details for customer...'}
                      className="w-full px-3.5 py-2 rounded-2xl bg-surface-container-low border border-outline-variant text-xs text-on-surface focus:outline-none focus:border-primary resize-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-on-surface-variant block">
                      {language === 'ar' ? 'رابط التحويل بعد الدفع (اختياري):' : 'Redirect URL after payment:'}
                    </label>
                    <input
                      type="url"
                      value={newLinkRedirect}
                      onChange={(e) => setNewLinkRedirect(e.target.value)}
                      placeholder="https://mywebsite.com/thank-you"
                      className="w-full px-3.5 py-2.5 rounded-2xl bg-surface-container-low border border-outline-variant text-xs text-on-surface focus:outline-none focus:border-primary font-mono"
                      dir="ltr"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-outline-variant">
                    <button
                      type="button"
                      onClick={() => setIsCreateLinkOpen(false)}
                      className="px-4 py-2 rounded-xl text-xs font-bold text-on-surface-variant hover:bg-surface-container"
                    >
                      {language === 'ar' ? 'إلغاء' : 'Cancel'}
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmittingLink}
                      className="px-5 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold shadow-md shadow-primary/20 hover:bg-primary/90 disabled:opacity-50"
                    >
                      {isSubmittingLink ? (language === 'ar' ? 'جاري الإنشاء...' : 'Creating...') : (language === 'ar' ? 'إنشاء الرابط' : 'Create Link')}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* SUB-TAB 4: LIVE SIMULATOR & SANDBOX */}
      {/* ------------------------------------------------------------- */}
      {subTab === 'simulator' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Simulator Form */}
          <div className="p-6 rounded-3xl bg-surface-container-lowest border border-outline-variant shadow-md space-y-5">
            <div>
              <span className="px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/20 text-xs font-bold uppercase mb-2 inline-block">
                Interactive Testing Hub
              </span>
              <h3 className="text-base font-bold text-on-surface">
                {language === 'ar' ? 'محاكي تجربة الدفع لعملائك (Live Simulator)' : 'Live Payment Simulator'}
              </h3>
              <p className="text-xs text-on-surface-variant">
                {language === 'ar'
                  ? 'جرب كيف يرى عملاؤك صفحة الدفع واختبر دورة التحويل وتأكيد الـ Webhook مباشرة دون الحاجة لأي تحويل مالي حقيقي.'
                  : 'Experience the customer checkout flow and test instant confirmation & webhooks without real money transfers.'}
              </p>
            </div>

            <form onSubmit={handleStartSimulation} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-on-surface-variant block">
                    {language === 'ar' ? 'مبلغ الطلب التجريبي:' : 'Test Amount (EGP):'}
                  </label>
                  <input
                    type="number"
                    step="1"
                    required
                    value={simAmount}
                    onChange={(e) => setSimAmount(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-2xl bg-surface-container-low border border-outline-variant text-xs text-on-surface font-bold"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-on-surface-variant block">
                    {language === 'ar' ? 'رقم الطلب التجريبي:' : 'Order ID:'}
                  </label>
                  <input
                    type="text"
                    required
                    value={simOrderId}
                    onChange={(e) => setSimOrderId(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-2xl bg-surface-container-low border border-outline-variant text-xs text-on-surface font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-on-surface-variant block">
                    {language === 'ar' ? 'اسم العميل التجريبي:' : 'Customer Name:'}
                  </label>
                  <input
                    type="text"
                    value={simCustomerName}
                    onChange={(e) => setSimCustomerName(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-2xl bg-surface-container-low border border-outline-variant text-xs text-on-surface"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-on-surface-variant block">
                    {language === 'ar' ? 'هاتف العميل التجريبي:' : 'Customer Phone:'}
                  </label>
                  <input
                    type="text"
                    value={simCustomerPhone}
                    onChange={(e) => setSimCustomerPhone(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-2xl bg-surface-container-low border border-outline-variant text-xs text-on-surface font-mono"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isCreatingSim}
                className="w-full py-3 px-4 rounded-2xl bg-primary hover:bg-primary/90 text-on-primary text-xs font-bold shadow-md shadow-primary/20 transition-all cursor-pointer disabled:opacity-50"
              >
                {isCreatingSim
                  ? (language === 'ar' ? 'جاري تجهيز الجلسة...' : 'Creating Session...')
                  : (language === 'ar' ? '1. إنشاء جلسة دفع تجريبية وفتح الشاشة' : '1. Launch Test Checkout Session')}
              </button>
            </form>

            {/* Step 2: Trigger Payment Confirmation */}
            {activeSimSession && (
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-3 animate-fade-in">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-800 dark:text-amber-200">
                    {language === 'ar' ? 'الجلسة نشطة وبانتظار الدفع:' : 'Session Ready for Simulation:'}
                  </span>
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                    activeSimSession.status === 'confirmed' ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white'
                  }`}>
                    {activeSimSession.status}
                  </span>
                </div>

                <p className="text-[11px] text-amber-800 dark:text-amber-200 leading-relaxed">
                  {language === 'ar'
                    ? 'اضغط أدناه لمحاكاة قيام المشتري بتحويل المبلغ عبر فودافون كاش أو إنستاباي، ولاحظ كيف يتم تأكيد الجلسة تلقائياً في الشاشة المقابلة!'
                    : 'Click below to simulate customer sending the funds and watch the checkout screen auto-confirm!'}
                </p>

                <button
                  onClick={handleSimulatePayment}
                  disabled={isSimulatingPayment || activeSimSession.status === 'confirmed'}
                  className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs shadow-md shadow-emerald-600/20 transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-sm">payments</span>
                  <span>
                    {activeSimSession.status === 'confirmed'
                      ? (language === 'ar' ? 'تم تأكيد الدفع بنجاح! 🎉' : 'Payment Confirmed! 🎉')
                      : (isSimulatingPayment ? (language === 'ar' ? 'جاري المحاكاة...' : 'Simulating...') : (language === 'ar' ? '2. محاكاة دفع العميل الآن (Simulate Transfer)' : '2. Simulate Customer Transfer Now'))}
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* Simulator Live Preview Frame */}
          <div className="p-6 rounded-3xl bg-surface-container-lowest border border-outline-variant shadow-md flex flex-col space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-outline-variant">
              <span className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sm text-primary">preview</span>
                {language === 'ar' ? 'معاينة شاشة العميل الحية' : 'Live Customer View'}
              </span>
              {activeSimSession && (
                <a
                  href={`/pay/${activeSimSession.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary font-bold hover:underline flex items-center gap-1"
                >
                  <span>{language === 'ar' ? 'فتح في نافذة مستقلة' : 'Open Full Window'}</span>
                  <span className="material-symbols-outlined text-xs">open_in_new</span>
                </a>
              )}
            </div>

            {activeSimSession ? (
              <div className="flex-1 w-full min-h-[520px] rounded-2xl overflow-hidden border border-slate-800 bg-slate-950">
                <iframe
                  src={`/pay/${activeSimSession.id}?embedded=true`}
                  className="w-full h-full border-none min-h-[520px]"
                  title="Checkout Preview"
                />
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-on-surface-variant border border-dashed border-outline-variant rounded-2xl space-y-2">
                <span className="material-symbols-outlined text-4xl text-outline">devices</span>
                <p className="text-xs">
                  {language === 'ar'
                    ? 'اضغط على "إنشاء جلسة دفع تجريبية" لعرض الشاشة هنا واختبار السداد لحظياً.'
                    : 'Click "Launch Test Checkout Session" to preview the live customer checkout here.'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* SUB-TAB 5: WEBHOOK DELIVERY LOGS */}
      {/* ------------------------------------------------------------- */}
      {subTab === 'logs' && (
        <div className="p-6 rounded-3xl bg-surface-container-lowest border border-outline-variant shadow-md space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-outline-variant">
            <div>
              <h3 className="text-base font-bold text-on-surface">
                {language === 'ar' ? 'سجل إشعارات الـ Webhook المرسلة لمتاجرك' : 'Outbound Webhook Delivery Logs'}
              </h3>
              <p className="text-xs text-on-surface-variant">
                {language === 'ar'
                  ? 'سجل تفصيلي بكل إشعار تم إرساله لمتجرك مع كود الاستجابة (HTTP Status) وحمولة البيانات.'
                  : 'Detailed logs of webhook payloads dispatched to your external store with HTTP statuses.'}
              </p>
            </div>
            <button
              onClick={loadWebhookLogs}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-container hover:bg-surface-container-high text-xs font-bold text-on-surface cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">refresh</span>
              <span>{language === 'ar' ? 'تحديث' : 'Refresh'}</span>
            </button>
          </div>

          {webhookLogs.length === 0 ? (
            <div className="p-12 text-center text-on-surface-variant text-xs">
              {language === 'ar' ? 'لم يتم إرسال أي إشعارات Webhook بعد.' : 'No webhook deliveries recorded yet.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right rtl:text-right ltr:text-left text-xs">
                <thead>
                  <tr className="border-b border-outline-variant text-on-surface-variant font-bold">
                    <th className="py-2.5 px-3">{language === 'ar' ? 'التوقيت' : 'Timestamp'}</th>
                    <th className="py-2.5 px-3">{language === 'ar' ? 'الحالة (HTTP)' : 'Status'}</th>
                    <th className="py-2.5 px-3">{language === 'ar' ? 'رابط المتجر' : 'Endpoint URL'}</th>
                    <th className="py-2.5 px-3">{language === 'ar' ? 'المحاولة' : 'Attempt'}</th>
                    <th className="py-2.5 px-3">{language === 'ar' ? 'استجابة السيرفر' : 'Response'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/60 font-mono">
                  {webhookLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-surface-container-low/50">
                      <td className="py-2.5 px-3 text-on-surface-variant whitespace-nowrap">
                        {new Date(log.delivered_at).toLocaleTimeString(language === 'ar' ? 'ar-EG' : 'en-US')}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded-md font-bold text-[11px] ${
                          log.http_status && log.http_status >= 200 && log.http_status < 300
                            ? 'bg-emerald-500/10 text-emerald-600'
                            : 'bg-red-500/10 text-red-600'
                        }`}>
                          {log.http_status || 'ERR'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-on-surface max-w-xs truncate" dir="ltr">
                        {log.url}
                      </td>
                      <td className="py-2.5 px-3 text-on-surface-variant">
                        #{log.attempt}
                      </td>
                      <td className="py-2.5 px-3 text-on-surface-variant max-w-xs truncate" dir="ltr">
                        {log.response_body || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
