import React, { useState, useEffect, useRef, useCallback } from 'react';

interface PaymentRailOption {
  provider: 'vodafone_cash' | 'instapay' | 'orange_cash' | 'etisalat_cash';
  providerLabel: string;
  providerLabelAr: string;
  walletNumber: string;
  instapayAddress?: string | null;
  instructionsAr: string;
}

interface SessionData {
  id: string;
  orderId: string;
  amount: number;
  amountMinor: number;
  currency: string;
  customerName?: string | null;
  customerPhone?: string | null;
  mode: 'live' | 'test';
  status: 'pending' | 'confirmed' | 'expired' | 'failed';
  returnUrl?: string | null;
  expiresAt: string;
  confirmedAt?: string | null;
  merchantName: string;
  merchantNameAr: string;
  rails: PaymentRailOption[];
  metadata?: Record<string, any> | null;
}

interface HostedCheckoutViewProps {
  sessionId: string;
  onNavigateHome?: () => void;
}

export const HostedCheckoutView: React.FC<HostedCheckoutViewProps> = ({ sessionId }) => {
  const [session, setSession] = useState<SessionData | null>(null);
  const [selectedRail, setSelectedRail] = useState<PaymentRailOption | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<'number' | 'amount' | null>(null);
  const [senderPhoneInput, setSenderPhoneInput] = useState<string>('');
  const [transferRefInput, setTransferRefInput] = useState<string>('');
  const [isClaiming, setIsClaiming] = useState<boolean>(false);
  const [claimFeedback, setClaimFeedback] = useState<string | null>(null);
  const [redirectCountdown, setRedirectCountdown] = useState<number>(5);
  const [language, setLanguage] = useState<'ar' | 'en'>('ar');
  const [showQr, setShowQr] = useState<boolean>(false);

  const pollIntervalRef = useRef<any>(null);

  // Fetch Session Details
  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
      if (!res.ok) {
        throw new Error('تعذر العثور على جلسة الدفع أو أنها منتهية الصلاحية.');
      }
      const data: SessionData = await res.json();
      setSession(data);
      if (data.rails && data.rails.length > 0 && !selectedRail) {
        setSelectedRail(data.rails[0]);
      }
      setIsLoading(false);

      if (data.status === 'confirmed') {
        notifyParentFrame(data);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'حدث خطأ أثناء تحميل جلسة الدفع');
      setIsLoading(false);
    }
  }, [sessionId, selectedRail]);

  // Initial load
  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  // Status Polling every 2.5 seconds when pending
  useEffect(() => {
    if (!session || session.status !== 'pending') return;

    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/checkout/sessions/${encodeURIComponent(sessionId)}/status`);
        if (res.ok) {
          const statusData = await res.json();
          if (statusData.status === 'confirmed') {
            clearInterval(pollIntervalRef.current);
            setSession((prev) => (prev ? { ...prev, status: 'confirmed', confirmedAt: statusData.confirmedAt } : null));
            notifyParentFrame({ ...session, status: 'confirmed' });
          } else if (statusData.status === 'expired' || statusData.status === 'failed') {
            clearInterval(pollIntervalRef.current);
            setSession((prev) => (prev ? { ...prev, status: statusData.status } : null));
          }
        }
      } catch {}
    }, 2500);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [session, sessionId]);

  // Handle postMessage to parent window when embedded in iframe / SDK
  const notifyParentFrame = (data: any) => {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        {
          type: 'SARRAF_PAYMENT_SUCCESS',
          payload: {
            sessionId: data.id,
            orderId: data.orderId,
            amount: data.amount,
            status: 'confirmed',
          },
        },
        '*'
      );
    }
  };

  // Redirect countdown when confirmed
  useEffect(() => {
    if (session?.status !== 'confirmed' || !session?.returnUrl) return;

    const timer = setInterval(() => {
      setRedirectCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          window.location.href = session.returnUrl!;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [session?.status, session?.returnUrl]);

  const copyToClipboard = (text: string, field: 'number' | 'amount') => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2500);
  };

  const handleClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!senderPhoneInput && !transferRefInput) return;

    setIsClaiming(true);
    setClaimFeedback(null);
    try {
      const res = await fetch(`/api/v1/checkout/sessions/${encodeURIComponent(sessionId)}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderPhone: senderPhoneInput,
          transferRef: transferRefInput,
        }),
      });
      const data = await res.json();
      if (data.matched) {
        setSession(data.session);
        notifyParentFrame(data.session);
      } else {
        setClaimFeedback(language === 'ar' ? 'تم تسجيل البيانات، وجاري التحقق آلياً من وصول التحويل...' : 'Details noted, monitoring for incoming transfer...');
      }
    } catch {
      setClaimFeedback(language === 'ar' ? 'تعذر إرسال البيانات حالياً، يرجى المحاولة مرة أخرى.' : 'Unable to submit details, please retry.');
    } finally {
      setIsClaiming(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6" dir={language === 'ar' ? 'rtl' : 'ltr'}>
        <div className="w-16 h-16 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center animate-pulse mb-4">
          <span className="material-symbols-outlined text-blue-400 text-3xl">account_balance_wallet</span>
        </div>
        <p className="text-slate-400 font-medium text-sm animate-pulse">
          {language === 'ar' ? 'جاري تجهيز بوابة الدفع الآمنة...' : 'Securing payment gateway...'}
        </p>
      </div>
    );
  }

  if (errorMessage || !session) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6" dir={language === 'ar' ? 'rtl' : 'ltr'}>
        <div className="max-w-md w-full p-8 rounded-3xl bg-slate-900 border border-red-500/30 text-center shadow-2xl">
          <div className="w-16 h-16 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center mx-auto mb-4 border border-red-500/20">
            <span className="material-symbols-outlined text-3xl">error</span>
          </div>
          <h2 className="text-xl font-bold mb-2">{language === 'ar' ? 'عفواً، تعذر تحميل جلسة الدفع' : 'Payment Session Error'}</h2>
          <p className="text-slate-400 text-sm mb-6">{errorMessage}</p>
          <a
            href="/"
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold transition-all"
          >
            <span className="material-symbols-outlined text-sm">home</span>
            {language === 'ar' ? 'العودة للرئيسية' : 'Return Home'}
          </a>
        </div>
      </div>
    );
  }

  // SUCCESS / CONFIRMED SCREEN
  if (session.status === 'confirmed') {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4 sm:p-6" dir={language === 'ar' ? 'rtl' : 'ltr'}>
        <div className="max-w-md w-full bg-slate-900/90 backdrop-blur-xl border border-emerald-500/40 rounded-3xl p-6 sm:p-8 text-center shadow-2xl relative overflow-hidden animate-scale-up">
          {/* Top glow */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-20 bg-emerald-500/20 blur-3xl pointer-events-none rounded-full" />

          {/* Success Checkmark */}
          <div className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center mx-auto mb-6 text-emerald-400 shadow-[0_0_30px_rgba(16,185,129,0.3)] animate-bounce">
            <span className="material-symbols-outlined text-5xl font-bold">check_circle</span>
          </div>

          <h2 className="text-2xl font-black text-white mb-2">
            {language === 'ar' ? 'تم تأكيد الدفع بنجاح! 🎉' : 'Payment Confirmed! 🎉'}
          </h2>
          <p className="text-slate-400 text-sm mb-6">
            {language === 'ar'
              ? `تم استلام وتحقق عملية السداد لصالح ${session.merchantNameAr || session.merchantName} بنجاح.`
              : `Your payment to ${session.merchantName} has been successfully verified.`}
          </p>

          {/* Receipt Snapshot */}
          <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 text-right rtl:text-right ltr:text-left mb-6 space-y-2.5">
            <div className="flex justify-between items-center text-xs text-slate-400">
              <span>{language === 'ar' ? 'رقم الطلب' : 'Order ID'}</span>
              <span className="font-mono text-slate-200 font-bold">{session.orderId}</span>
            </div>
            <div className="flex justify-between items-center text-xs text-slate-400">
              <span>{language === 'ar' ? 'المبلغ المسدد' : 'Amount Paid'}</span>
              <span className="font-bold text-emerald-400 text-sm">{session.amount.toFixed(2)} ج.م</span>
            </div>
            <div className="flex justify-between items-center text-xs text-slate-400">
              <span>{language === 'ar' ? 'توقيت التأكيد' : 'Timestamp'}</span>
              <span className="text-slate-300 font-mono text-[11px]">{new Date().toLocaleTimeString(language === 'ar' ? 'ar-EG' : 'en-US')}</span>
            </div>
            <div className="flex justify-between items-center text-xs text-slate-400 border-t border-slate-800/80 pt-2">
              <span>{language === 'ar' ? 'طريقة التحقق' : 'Verification'}</span>
              <span className="text-emerald-400 font-medium flex items-center gap-1">
                <span className="material-symbols-outlined text-xs">verified</span>
                {language === 'ar' ? 'فوري وآلي عبر صرّاف' : 'Automated Sarraf Engine'}
              </span>
            </div>
          </div>

          {session.returnUrl ? (
            <div className="space-y-3">
              <a
                href={session.returnUrl}
                className="w-full flex items-center justify-center gap-2 py-3.5 px-6 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-all shadow-lg shadow-emerald-600/30 cursor-pointer"
              >
                <span>{language === 'ar' ? 'العودة لمتجر التاجر الآن' : 'Return to Merchant'}</span>
                <span className="material-symbols-outlined text-sm">arrow_forward</span>
              </a>
              <p className="text-xs text-slate-500 font-medium">
                {language === 'ar'
                  ? `سيتم تحويلك تلقائياً خلال ${redirectCountdown} ثوانٍ...`
                  : `Redirecting automatically in ${redirectCountdown}s...`}
              </p>
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              {language === 'ar' ? 'يمكنك إغلاق هذه النافذة بأمان.' : 'You may now safely close this window.'}
            </p>
          )}
        </div>
      </div>
    );
  }

  // EXPIRED SCREEN
  if (session.status === 'expired') {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6" dir={language === 'ar' ? 'rtl' : 'ltr'}>
        <div className="max-w-md w-full p-8 rounded-3xl bg-slate-900 border border-amber-500/30 text-center shadow-2xl">
          <div className="w-16 h-16 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center mx-auto mb-4 border border-amber-500/20">
            <span className="material-symbols-outlined text-3xl">timer_off</span>
          </div>
          <h2 className="text-xl font-bold mb-2">{language === 'ar' ? 'انتهت صلاحية جلسة الدفع' : 'Payment Session Expired'}</h2>
          <p className="text-slate-400 text-sm mb-6">
            {language === 'ar'
              ? 'تجاوزت هذه الجلسة مهلة الدفع المحددة (30 دقيقة). يرجى العودة لمتجر التاجر وإعادة المحاولة.'
              : 'This payment session has timed out. Please return to the merchant store and place a new order.'}
          </p>
          {session.returnUrl && (
            <a
              href={session.returnUrl}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold transition-all"
            >
              {language === 'ar' ? 'العودة للمتجر' : 'Return to Store'}
            </a>
          )}
        </div>
      </div>
    );
  }

  // ACTIVE PAYMENT SCREEN
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 sm:p-6 font-sans selection:bg-blue-600 selection:text-white" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <div className="max-w-md w-full mx-auto space-y-4">
        {/* Brand Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-600/30">
              <span className="material-symbols-outlined text-xl">account_balance_wallet</span>
            </div>
            <div>
              <h1 className="text-sm font-black text-white leading-tight">
                {session.merchantNameAr || session.merchantName}
              </h1>
              <p className="text-[11px] text-slate-400 flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {language === 'ar' ? 'بوابة دفع صرّاف الآلية' : 'Powered by Sarraf Gateway'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {session.mode === 'test' && (
              <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[10px] font-bold uppercase tracking-wider">
                Sandbox Test
              </span>
            )}
            <button
              onClick={() => setLanguage((l) => (l === 'ar' ? 'en' : 'ar'))}
              className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-semibold text-slate-400 hover:text-slate-200"
            >
              {language === 'ar' ? 'English' : 'عربي'}
            </button>
          </div>
        </div>

        {/* Payment Link Info Banner (if accessed via Payment Link) */}
        {session.metadata?.title && (
          <div className="p-4 rounded-3xl bg-blue-600/15 border border-blue-500/30 text-right rtl:text-right ltr:text-left space-y-1 animate-fade-in">
            <div className="flex items-center justify-between">
              <span className="text-sm font-black text-white">{session.metadata.title}</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300">
                {language === 'ar' ? 'فاتورة دفع مباشر' : 'Direct Payment Link'}
              </span>
            </div>
            {session.metadata.description && (
              <p className="text-xs text-slate-300 leading-relaxed">{session.metadata.description}</p>
            )}
          </div>
        )}

        {/* Amount Hero Card */}
        <div className="p-5 rounded-3xl bg-gradient-to-b from-slate-900 to-slate-900/60 border border-slate-800 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/10 rounded-full blur-2xl pointer-events-none" />

          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-400">
              {language === 'ar' ? 'المبلغ المطلوب سداده' : 'Total Amount Due'}
            </span>
            <span className="text-xs font-mono text-slate-500 bg-slate-950 px-2 py-0.5 rounded-md border border-slate-800">
              {session.orderId}
            </span>
          </div>

          <div className="flex items-baseline justify-between">
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl sm:text-4xl font-black text-white tracking-tight">
                {session.amount.toFixed(2)}
              </span>
              <span className="text-sm font-bold text-blue-400">ج.م</span>
            </div>

            <button
              onClick={() => copyToClipboard(session.amount.toString(), 'amount')}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition-all cursor-pointer"
            >
              <span className="material-symbols-outlined text-xs">
                {copiedField === 'amount' ? 'check' : 'content_copy'}
              </span>
              <span>{copiedField === 'amount' ? (language === 'ar' ? 'تم النسخ!' : 'Copied!') : (language === 'ar' ? 'نسخ المبلغ' : 'Copy Amount')}</span>
            </button>
          </div>
        </div>

        {/* Payment Rails Selector */}
        {session.rails && session.rails.length > 0 ? (
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 block px-1">
              {language === 'ar' ? 'اختر طريقة التحويل المناسبة لك:' : 'Select Payment Method:'}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {session.rails.map((rail, idx) => {
                const isSelected = selectedRail?.provider === rail.provider;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSelectedRail(rail)}
                    className={`p-3 rounded-2xl border text-right rtl:text-right ltr:text-left transition-all cursor-pointer flex flex-col justify-between ${
                      isSelected
                        ? 'bg-blue-600/15 border-blue-500 shadow-md shadow-blue-500/10'
                        : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <span className={`material-symbols-outlined text-lg ${isSelected ? 'text-blue-400' : 'text-slate-400'}`}>
                        {rail.provider === 'instapay' ? 'send_to_mobile' : 'phone_android'}
                      </span>
                      {isSelected && (
                        <span className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
                      )}
                    </div>
                    <span className="text-xs font-bold text-white block truncate">
                      {language === 'ar' ? rail.providerLabelAr : rail.providerLabel}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
            {language === 'ar' ? 'لم يقم التاجر بتفعيل أي محفظة استقبال بعد.' : 'No receiving payment rails active.'}
          </div>
        )}

        {/* Selected Rail Payment Details Box */}
        {selectedRail && (
          <div className="p-5 rounded-3xl bg-slate-900 border border-slate-800 space-y-4 shadow-xl animate-fade-in">
            {/* Wallet / Address Number Card */}
            <div>
              <span className="text-xs text-slate-400 font-medium block mb-1.5">
                {selectedRail.provider === 'instapay'
                  ? (language === 'ar' ? 'عنوان الدفع / رقم إنستاباي للمتجر:' : 'Merchant InstaPay Address / Mobile:')
                  : (language === 'ar' ? 'رقم المحفظة الإلكترونية للتحويل:' : 'Send Payment to Wallet Number:')}
              </span>
              <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-950 border border-slate-800/80">
                <span className="text-lg font-mono font-bold text-blue-400 tracking-wider" dir="ltr">
                  {selectedRail.walletNumber}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowQr(!showQr)}
                    className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-all cursor-pointer"
                    title={language === 'ar' ? 'عرض رمز QR' : 'Show QR'}
                  >
                    <span className="material-symbols-outlined text-sm">qr_code_2</span>
                  </button>
                  <button
                    onClick={() => copyToClipboard(selectedRail.walletNumber, 'number')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all shadow-md shadow-blue-600/20 cursor-pointer active:scale-95"
                  >
                    <span className="material-symbols-outlined text-xs">
                      {copiedField === 'number' ? 'check' : 'content_copy'}
                    </span>
                    <span>{copiedField === 'number' ? (language === 'ar' ? 'تم النسخ!' : 'Copied!') : (language === 'ar' ? 'نسخ الرقم' : 'Copy')}</span>
                  </button>
                </div>
              </div>

              {showQr && (
                <div className="mt-3 p-4 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col items-center justify-center space-y-2 animate-fade-in">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(selectedRail.walletNumber)}`}
                    alt="Wallet QR Code"
                    className="w-36 h-36 rounded-xl bg-white p-2 shadow-md"
                  />
                  <span className="text-[11px] text-slate-400">
                    {language === 'ar' ? 'امسح الرمز بكاميرا التطبيق البنكي أو المحفظة' : 'Scan with banking or wallet app'}
                  </span>
                </div>
              )}
            </div>

            {/* Instruction Steps */}
            <div className="p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800/60 text-xs text-slate-300 space-y-2">
              <div className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 font-bold flex items-center justify-center shrink-0 text-[11px]">1</span>
                <span>
                  {language === 'ar'
                    ? `افتح تطبيق المحفظة أو إنستاباي على هاتفك.`
                    : 'Open your wallet or banking app on your mobile phone.'}
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 font-bold flex items-center justify-center shrink-0 text-[11px]">2</span>
                <span>
                  {language === 'ar'
                    ? `قم بتحويل مبلغ ${session.amount.toFixed(2)} ج.م إلى الرقم الموضح أعلاه.`
                    : `Transfer exact amount of ${session.amount.toFixed(2)} EGP to the number above.`}
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 font-bold flex items-center justify-center shrink-0 text-[11px]">3</span>
                <span>
                  {language === 'ar'
                    ? `انتظر ثوانٍ معدودة، وسيقوم النظام بتأكيد طلبك وتحديث الصفحة تلقائياً فور التحويل.`
                    : 'Wait a few seconds, the system will detect your transfer and auto-confirm your order!'}
                </span>
              </div>
            </div>

            {/* Live Polling Radar */}
            <div className="flex items-center justify-center gap-3 py-2 text-xs text-slate-400 font-medium">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
              </span>
              <span>
                {language === 'ar'
                  ? 'جاري مراقبة الشبكة والتحقق من وصول تحويلك تلقائياً...'
                  : 'Listening for incoming transfer confirmation...'}
              </span>
            </div>
          </div>
        )}

        {/* Expedite / Manual Claim Collapsible */}
        <div className="p-4 rounded-3xl bg-slate-900/60 border border-slate-800/80 text-xs">
          <form onSubmit={handleClaim} className="space-y-2.5">
            <span className="font-bold text-slate-300 block">
              {language === 'ar' ? 'هل قمت بالتحويل بالفعل؟' : 'Already transferred?'}
            </span>
            <p className="text-[11px] text-slate-400">
              {language === 'ar'
                ? 'يمكنك إدخال رقم هاتفك المحول منه أو رقم العملية لتسريع المطابقة الفورية:'
                : 'Enter sender mobile or transaction ID to expedite matching:'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                value={senderPhoneInput}
                onChange={(e) => setSenderPhoneInput(e.target.value)}
                placeholder={language === 'ar' ? 'رقم هاتفك المحول منه (مثال: 010...)' : 'Sender mobile number'}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
              />
              <input
                type="text"
                value={transferRefInput}
                onChange={(e) => setTransferRefInput(e.target.value)}
                placeholder={language === 'ar' ? 'رقم المعاملة بالرسالة (اختياري)' : 'Transaction ID (Optional)'}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
              />
            </div>
            <button
              type="submit"
              disabled={isClaiming || (!senderPhoneInput && !transferRefInput)}
              className="w-full py-2 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 font-semibold text-xs transition-all cursor-pointer"
            >
              {isClaiming
                ? (language === 'ar' ? 'جاري التحقق...' : 'Checking...')
                : (language === 'ar' ? 'تحقق الآن من السداد' : 'Verify My Transfer')}
            </button>
            {claimFeedback && (
              <p className="text-[11px] text-blue-400 font-medium text-center">{claimFeedback}</p>
            )}
          </form>
        </div>
      </div>

      {/* Footer Branding */}
      <footer className="pt-6 pb-2 text-center text-xs text-slate-600 font-medium">
        <p>Sarraf Ops Payment Gateway · بنية دفع آمنة ومشفرة</p>
      </footer>
    </div>
  );
};
