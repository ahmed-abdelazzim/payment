import React, { useState } from 'react';
import { ProviderType, ProviderRail } from '../types';

interface AddSourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSourceAdded: (source: ProviderRail) => void;
  language: 'en' | 'ar';
}

export const AddSourceModal: React.FC<AddSourceModalProps> = ({
  isOpen,
  onClose,
  onSourceAdded,
  language,
}) => {
  const [provider, setProvider] = useState<ProviderType>('vodafone_cash');
  const [friendlyName, setFriendlyName] = useState('');
  const [walletNumber, setWalletNumber] = useState('');
  const [dailyLimit, setDailyLimit] = useState<number>(60000);
  const [monthlyLimit, setMonthlyLimit] = useState<number>(200000);
  const [setAsDefault, setSetAsDefault] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleProviderChange = (newProvider: ProviderType) => {
    setProvider(newProvider);
    // Do NOT auto-fill consumer sending limits (120k/400k) for InstaPay.
    // Merchant receiving limits depend on commercial bank registration.
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/v1/sources', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('sarraf_session_token') || ''}`,
        },
        body: JSON.stringify({
          provider,
          friendlyName,
          walletNumber,
          dailyLimit: Number(dailyLimit),
          monthlyLimit: Number(monthlyLimit),
          setAsDefault,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to add payment source');
      }

      const colorMap: Record<ProviderType, string> = {
        vodafone_cash: '#1e3a8a',
        instapay: '#00285e',
        orange_cash: '#565e74',
        etisalat_cash: '#00236f',
      };

      onSourceAdded({
        id: provider,
        name: friendlyName,
        sharePercentage: 100,
        volume: 0,
        target: dailyLimit,
        txnsCount: 0,
        color: colorMap[provider],
        walletNumber,
        dailyLimit,
        monthlyLimit,
        isPaused: false,
      });

      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-5 animate-in fade-in zoom-in-95">
        <div className="flex items-center justify-between pb-3 border-b border-outline-variant">
          <div className="flex items-center gap-2 text-primary">
            <span className="material-symbols-outlined text-2xl">account_balance_wallet</span>
            <h3 className="text-title-md font-bold text-on-surface">
              {language === 'ar' ? 'إضافة مسار استقبال / محفظة جديدة' : 'Add Receiving Payment Source'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-on-surface-variant hover:bg-surface-container"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-error-container/20 text-error text-body-sm flex items-center gap-2">
            <span className="material-symbols-outlined text-base">error</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-label-md text-on-surface font-medium mb-1">
              {language === 'ar' ? 'نوع الشبكة المالية أو المحفظة' : 'Provider / Network Rail'}
            </label>
            <select
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value as ProviderType)}
              className="w-full px-3.5 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-body-md focus:ring-2 focus:ring-primary focus:outline-none"
            >
              <option value="vodafone_cash">Vodafone Cash (فودافون كاش)</option>
              <option value="instapay">InstaPay IPN (شبكة المدفوعات اللحظية)</option>
              <option value="orange_cash">Orange Cash (أورنچ كاش)</option>
              <option value="etisalat_cash">e& Cash / Etisalat (إي آند كاش)</option>
            </select>
          </div>

          <div>
            <label className="block text-label-md text-on-surface font-medium mb-1">
              {language === 'ar' ? 'الاسم التعريفي للخط' : 'Friendly Line Name'}
            </label>
            <input
              type="text"
              required
              value={friendlyName}
              onChange={(e) => setFriendlyName(e.target.value)}
              placeholder={language === 'ar' ? 'محفظة مبيعات الكاشير الرئيسي' : 'Main Cashier Receiving Wallet'}
              className="w-full px-3.5 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-body-md focus:ring-2 focus:ring-primary focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-label-md text-on-surface font-medium mb-1">
              {provider === 'instapay'
                ? language === 'ar'
                  ? 'عنوان الدفع اللحظي (IPA / VPA أو رقم الحساب)'
                  : 'InstaPay VPA Handle (e.g. name@instapay)'
                : language === 'ar'
                ? 'رقم هاتف المحفظة (MSISDN)'
                : 'Wallet Mobile Number (MSISDN)'}
            </label>
            <input
              type="text"
              required
              value={walletNumber}
              onChange={(e) => setWalletNumber(e.target.value)}
              placeholder={provider === 'instapay' ? 'merchant@instapay' : '01019283921'}
              className="w-full px-3.5 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest font-code-num text-on-surface text-body-md focus:ring-2 focus:ring-primary focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-label-md text-on-surface font-medium mb-1">
                {language === 'ar' ? 'الحد اليومي (ج.م)' : 'Daily Turnover Cap (EGP)'}
              </label>
              <input
                type="number"
                required
                value={dailyLimit}
                onChange={(e) => setDailyLimit(Number(e.target.value))}
                className="w-full px-3.5 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest font-code-num text-on-surface text-body-md focus:ring-2 focus:ring-primary focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-label-md text-on-surface font-medium mb-1">
                {language === 'ar' ? 'الحد الشهري (ج.م)' : 'Monthly Turnover Cap (EGP)'}
              </label>
              <input
                type="number"
                required
                value={monthlyLimit}
                onChange={(e) => setMonthlyLimit(Number(e.target.value))}
                className="w-full px-3.5 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest font-code-num text-on-surface text-body-md focus:ring-2 focus:ring-primary focus:outline-none"
              />
            </div>
          </div>

          {provider === 'instapay' && (
            <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/60 text-label-xs text-on-surface-variant flex items-start gap-2">
              <span className="material-symbols-outlined text-base text-primary mt-0.5">verified_user</span>
              <span>
                {language === 'ar'
                  ? 'تنبيه تنظيمي: حدود استقبال إنستاباي للشركات والتجار تختلف تماماً عن حدود الإرسال الفردية (70 ألف للعملية / 120 ألف يومياً). يرجى إدخال سقف الاستقبال المعتمد لحسابك التجاري لدى البنك.'
                  : 'Regulatory Notice: Merchant receiving limits for InstaPay are separate from individual sending caps (70k/tx, 120k/day). Enter your bank-approved commercial receiving ceiling.'}
              </span>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="setDef"
              checked={setAsDefault}
              onChange={(e) => setSetAsDefault(e.target.checked)}
              className="w-4 h-4 text-primary rounded border-outline-variant focus:ring-primary"
            />
            <label htmlFor="setDef" className="text-label-md text-on-surface cursor-pointer select-none">
              {language === 'ar'
                ? 'تعيين هذا الخط كعنوان افتراضي لإصدار الفواتير الجديدة'
                : 'Set as default receiving destination for upcoming invoices'}
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-label-md font-semibold text-on-surface-variant hover:bg-surface-container"
            >
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 rounded-lg bg-primary text-on-primary text-label-md font-semibold hover:bg-primary/90 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <span className="material-symbols-outlined animate-spin text-base">progress_activity</span>
              ) : (
                <span className="material-symbols-outlined text-base">add_circle</span>
              )}
              <span>{language === 'ar' ? 'حفظ المسار' : 'Add Payment Source'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
