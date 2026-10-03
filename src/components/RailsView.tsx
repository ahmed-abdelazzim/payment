import React, { useState } from 'react';
import { ProviderRail } from '../types';

interface RailsViewProps {
  rails: ProviderRail[];
  onUpdateRails: (updated: ProviderRail[]) => void;
  onOpenAddSource?: () => void;
  language: 'en' | 'ar';
}

export const RailsView: React.FC<RailsViewProps> = ({
  rails,
  onUpdateRails,
  onOpenAddSource,
  language,
}) => {
  const [activeTab, setActiveTab] = useState<'limits' | 'sources'>('limits');
  const [selectedRail, setSelectedRail] = useState<ProviderRail | null>(null);

  const handleTogglePause = (railId: string) => {
    const updated = rails.map((r) =>
      r.id === railId ? { ...r, isPaused: !r.isPaused } : r
    );
    onUpdateRails(updated);
  };

  return (
    <div className="pt-16 pb-28 max-w-5xl mx-auto px-margin-mobile flex flex-col gap-space-md">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-space-sm border-b border-outline-variant gap-2">
        <div>
          <h1 className="text-headline-md font-bold text-on-surface">
            {language === 'ar' ? 'مسارات التسوية والحدود المالية (القسم 4A)' : 'Provider Settlement Rails & Limits (Section 4A)'}
          </h1>
          <p className="text-body-md text-on-surface-variant">
            {language === 'ar'
              ? 'مراقبة سقف السحب والإيداع اليومي والشهري وتحديد المحافظ المفضلة بأمان'
              : 'Regulatory financial ceiling alerts, capacity estimation, and safe multi-wallet switching'}
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          {onOpenAddSource && (
            <button
              onClick={onOpenAddSource}
              className="px-3.5 py-1.5 bg-primary text-on-primary rounded-lg text-label-sm font-semibold flex items-center gap-1 shadow-xs active:scale-95 transition-all"
            >
              <span className="material-symbols-outlined text-sm">add_circle</span>
              <span>{language === 'ar' ? 'إضافة مسار جديد' : 'Add Source'}</span>
            </button>
          )}

          {/* Tab switch */}
          <div className="flex items-center gap-1 bg-surface-container-low p-1 rounded-lg border border-outline-variant">
            <button
              onClick={() => setActiveTab('limits')}
              className={`px-3 py-1 rounded text-label-sm font-semibold transition-all ${
                activeTab === 'limits'
                  ? 'bg-primary text-on-primary shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {language === 'ar' ? 'الحدود والقدرة الاستيعابية' : 'Limits & Capacity'}
            </button>
            <button
              onClick={() => setActiveTab('sources')}
              className={`px-3 py-1 rounded text-label-sm font-semibold transition-all ${
                activeTab === 'sources'
                  ? 'bg-primary text-on-primary shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {language === 'ar' ? 'إدارة عناوين الاستلام' : 'Receiving Addresses'}
            </button>
          </div>
        </div>
      </div>

      {/* Capacity Warning Banner (Section 4A Rule) */}
      <div className="p-space-md bg-surface-container-low border border-primary/30 rounded-xl flex items-start gap-space-sm">
        <span className="material-symbols-outlined text-primary text-xl mt-0.5">
          verified_user
        </span>
        <div className="text-body-md">
          <h4 className="font-semibold text-on-surface">
            {language === 'ar'
              ? 'المطابقة الاستباقية للحدود التنظيمية (البنك المركزي المصري)'
              : 'Regulatory Safeguard: Central Bank of Egypt Mobile Wallet Limits'}
          </h4>
          <p className="text-label-sm text-on-surface-variant mt-0.5">
            {language === 'ar'
              ? 'يقوم النظام بحساب السعة المتبقية لكل محفظة استناداً لتوقيت الحدث الفعلي وليس وقت استلام الطلب. يتم إصدار تنبيهات فورية عند وصول أي محفظة إلى 80% و 90% من السقف اليومي أو الشهري.'
              : 'Remaining capacity is computed from authenticated transaction events. Automated alerts fire at 80% and 90% of daily/monthly ceilings. Pausing a wallet routes new payment intents safely without losing in-flight SMS capture.'}
          </p>
        </div>
      </div>

      {/* Rails Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
        {rails.length === 0 ? (
          <div className="col-span-full p-10 text-center bg-surface-container-lowest border border-outline-variant rounded-2xl space-y-3">
            <div className="w-12 h-12 rounded-full bg-surface-container-low text-primary flex items-center justify-center mx-auto">
              <span className="material-symbols-outlined text-2xl">account_balance_wallet</span>
            </div>
            <h3 className="text-title-md font-bold text-on-surface">
              {language === 'ar' ? 'لم يتم إضافة مسارات استقبال بعد' : 'No receiving sources configured'}
            </h3>
            <p className="text-body-sm text-on-surface-variant max-w-sm mx-auto">
              {language === 'ar'
                ? 'أضف محفظة فودافون كاش، إنستاباي IPA، أو محفظة أورنچ/إي آند للبدء بمراقبة الاستقبال والسعة.'
                : 'Add your Vodafone Cash, InstaPay VPA, Orange Cash, or e& Cash receiving wallet.'}
            </p>
            {onOpenAddSource && (
              <button
                onClick={onOpenAddSource}
                className="px-4 py-2 bg-primary text-on-primary rounded-lg text-label-md font-semibold inline-flex items-center gap-1.5 shadow-sm active:scale-95 transition-all"
              >
                <span className="material-symbols-outlined text-base">add_circle</span>
                <span>{language === 'ar' ? 'إضافة أول مسار استقبال' : 'Add First Source'}</span>
              </button>
            )}
          </div>
        ) : (
          rails.map((rail) => {
          const dailyPercent = Math.round((rail.volume / rail.dailyLimit) * 100);
          const isNearLimit = dailyPercent >= 80;

          return (
            <div
              key={rail.id}
              className={`rounded-xl border p-space-md transition-all shadow-sm ${
                rail.isPaused
                  ? 'bg-surface-container-low border-outline-variant opacity-80'
                  : isNearLimit
                  ? 'bg-error-container/20 border-error/50'
                  : 'bg-surface-container-lowest border-outline-variant hover:border-primary'
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: rail.color }}
                    ></span>
                    <h3 className="text-title-md font-bold text-on-surface">
                      {rail.name}
                    </h3>
                    {rail.isPaused && (
                      <span className="px-2 py-0.5 rounded text-label-sm bg-outline text-white font-semibold">
                        {language === 'ar' ? 'معطلة لطلبات الدفع الجديدة' : 'Paused for New Instructions'}
                      </span>
                    )}
                  </div>
                  <p className="text-label-sm font-code-num text-on-surface-variant mt-0.5">
                    {rail.walletNumber}
                  </p>
                </div>

                <div className="text-right">
                  <span className="text-label-sm text-on-surface-variant block">
                    {language === 'ar' ? 'حصة اليوم' : 'Daily Share'}
                  </span>
                  <span className="text-headline-sm font-code-num font-bold text-primary">
                    {rail.sharePercentage}%
                  </span>
                </div>
              </div>

              {/* Daily Limit Bar */}
              <div className="mt-space-md space-y-1">
                <div className="flex justify-between text-label-sm">
                  <span className="text-on-surface-variant">
                    {language === 'ar' ? 'الاستهلاك اليومي:' : 'Daily Capacity Usage:'}
                  </span>
                  <span className="font-code-num font-semibold text-on-surface">
                    {rail.volume.toLocaleString('en-US')} / {rail.dailyLimit.toLocaleString('en-US')} EGP ({dailyPercent}%)
                  </span>
                </div>

                <div className="w-full bg-outline-variant/40 rounded-full h-2.5">
                  <div
                    className={`h-2.5 rounded-full transition-all duration-500 ${
                      isNearLimit ? 'bg-error' : 'bg-primary'
                    }`}
                    style={{ width: `${Math.min(dailyPercent, 100)}%` }}
                  ></div>
                </div>
              </div>

              {/* Monthly Limit Bar */}
              <div className="mt-space-sm space-y-1">
                <div className="flex justify-between text-label-sm">
                  <span className="text-on-surface-variant">
                    {language === 'ar' ? 'السقف الشهري المقدر:' : 'Estimated Monthly Turnover:'}
                  </span>
                  <span className="font-code-num text-on-surface-variant">
                    {(rail.volume * 2.8).toLocaleString('en-US', { maximumFractionDigits: 0 })} / {rail.monthlyLimit.toLocaleString('en-US')} EGP
                  </span>
                </div>
              </div>

              {/* Actions & Safe Switching */}
              <div className="mt-space-md pt-space-sm border-t border-outline-variant/60 flex items-center justify-between">
                <span className="text-label-sm text-on-surface-variant font-code-num">
                  {rail.txnsCount} {language === 'ar' ? 'معاملة مسجلة' : 'reconciled txns'}
                </span>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleTogglePause(rail.id)}
                    className={`px-3 py-1 rounded text-label-sm font-semibold active:scale-95 transition-all ${
                      rail.isPaused
                        ? 'bg-primary text-on-primary'
                        : 'bg-surface-container-low text-on-surface-variant border border-outline-variant hover:bg-surface-container'
                    }`}
                  >
                    {rail.isPaused
                      ? language === 'ar'
                        ? 'تفعيل للتعليمات الجديدة'
                        : 'Resume for Invoices'
                      : language === 'ar'
                      ? 'إيقاف مؤقت للتعليمات'
                      : 'Pause for New Invoices'}
                  </button>

                  <button
                    onClick={() => setSelectedRail(rail)}
                    className="p-1 rounded text-on-surface-variant hover:bg-surface-container"
                    title="Configure Policy"
                  >
                    <span className="material-symbols-outlined text-lg">tune</span>
                  </button>
                </div>
              </div>
            </div>
          );
        }))}
      </div>

      {/* Rail Config Modal */}
      {selectedRail && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest border border-outline-variant rounded-xl max-w-md w-full p-space-lg shadow-2xl">
            <div className="flex items-center justify-between pb-space-sm border-b border-outline-variant">
              <h3 className="text-title-md font-bold text-on-surface">
                {selectedRail.name} {language === 'ar' ? 'سياسة الحدود' : 'Financial Policy'}
              </h3>
              <button
                onClick={() => setSelectedRail(null)}
                className="p-1 text-on-surface-variant hover:bg-surface-container rounded"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="py-space-md space-y-3 text-body-md text-on-surface">
              <div>
                <label className="text-label-sm text-outline block mb-1">
                  Daily Intake Cap (EGP):
                </label>
                <input
                  type="number"
                  defaultValue={selectedRail.dailyLimit}
                  className="w-full h-9 px-3 bg-surface-container-low border border-outline-variant rounded text-on-surface font-code-num focus:ring-1 focus:ring-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="text-label-sm text-outline block mb-1">
                  Alert Margin Threshold (%):
                </label>
                <input
                  type="number"
                  defaultValue={80}
                  className="w-full h-9 px-3 bg-surface-container-low border border-outline-variant rounded text-on-surface font-code-num focus:ring-1 focus:ring-primary focus:outline-none"
                />
              </div>

              <div className="p-space-sm bg-surface-container-low rounded border border-outline-variant text-label-sm text-on-surface-variant">
                Alerts are delivered via Telegram (#cairo-vault-bot) and Webhook endpoint (\`/api/v1/ledger/alerts\`).
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-space-sm border-t border-outline-variant">
              <button
                onClick={() => setSelectedRail(null)}
                className="px-4 py-2 bg-primary text-on-primary rounded text-label-md font-semibold"
              >
                Save Policy
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
