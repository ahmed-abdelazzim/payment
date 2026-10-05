import React, { useState } from 'react';
import { ProviderRail } from '../types';

interface RailsViewProps {
  rails: ProviderRail[];
  onUpdateRails: (updated: ProviderRail[]) => void;
  onTogglePause?: (railId: string) => void | Promise<void>;
  onOpenAddSource?: () => void;
  language: 'en' | 'ar';
}

export const RailsView: React.FC<RailsViewProps> = ({
  rails,
  onUpdateRails,
  onTogglePause,
  onOpenAddSource,
  language,
}) => {
  const [activeTab, setActiveTab] = useState<'limits' | 'sources'>('limits');
  const [selectedRail, setSelectedRail] = useState<ProviderRail | null>(null);

  const handleTogglePause = async (railId: string) => {
    if (onTogglePause) {
      await onTogglePause(railId);
      return;
    }

    const updated = rails.map((r) =>
      r.id === railId ? { ...r, isPaused: !r.isPaused } : r
    );
    onUpdateRails(updated);
  };

  return (
    <div className="py-6 pb-28 max-w-7xl mx-auto px-4 sm:px-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-outline-variant/80 gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <span className="material-symbols-outlined text-xl">tune</span>
            </div>
            <h1 className="text-headline-md font-bold text-on-surface">
              {language === 'ar' ? 'مسارات التسوية والحدود المالية' : 'Provider Settlement Rails & Limits'}
            </h1>
          </div>
          <p className="text-body-md text-on-surface-variant">
            {language === 'ar'
              ? 'مراقبة سقف السحب والإيداع اليومي والشهري وتحديد المحافظ المفضلة بأمان'
              : 'Regulatory financial ceiling alerts, capacity estimation, and safe multi-wallet switching'}
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 self-start sm:self-auto flex-wrap">
          {onOpenAddSource && (
            <button
              onClick={onOpenAddSource}
              className="px-4 py-2 bg-primary text-on-primary rounded-xl text-label-sm font-bold flex items-center gap-1.5 shadow-xs hover:bg-primary/90 active:scale-95 transition-all cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">add_circle</span>
              <span>{language === 'ar' ? 'إضافة مسار جديد' : 'Add Source'}</span>
            </button>
          )}

          {/* Tab switch */}
          <div className="flex items-center gap-1 bg-surface-container-low p-1 rounded-xl border border-outline-variant">
            <button
              onClick={() => setActiveTab('limits')}
              className={`px-3 py-1.5 rounded-lg text-label-sm font-bold transition-all cursor-pointer ${
                activeTab === 'limits'
                  ? 'bg-primary text-on-primary shadow-xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {language === 'ar' ? 'الحدود والقدرة الاستيعابية' : 'Limits & Capacity'}
            </button>
            <button
              onClick={() => setActiveTab('sources')}
              className={`px-3 py-1.5 rounded-lg text-label-sm font-bold transition-all cursor-pointer ${
                activeTab === 'sources'
                  ? 'bg-primary text-on-primary shadow-xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {language === 'ar' ? 'إدارة عناوين الاستلام' : 'Receiving Addresses'}
            </button>
          </div>
        </div>
      </div>

      {/* Capacity Warning Banner */}
      <div className="p-4 bg-surface-container-low border border-primary/20 rounded-2xl flex items-start gap-3 shadow-xs">
        <span className="material-symbols-outlined text-primary text-2xl shrink-0 mt-0.5">
          verified_user
        </span>
        <div className="text-body-md">
          <h4 className="font-bold text-on-surface">
            {language === 'ar'
              ? 'المطابقة الاستباقية للحدود التنظيمية (البنك المركزي المصري)'
              : 'Regulatory Safeguard: Central Bank of Egypt Mobile Wallet Limits'}
          </h4>
          <p className="text-label-sm text-on-surface-variant mt-1 leading-relaxed">
            {language === 'ar'
              ? 'يقوم النظام بحساب السعة المتبقية لكل محفظة استناداً لتوقيت الحدث الفعلي. يتم إصدار تنبيهات فورية عند وصول أي محفظة إلى 80% و 90% من السقف اليومي أو الشهري لضمان عدم رفض أي تحويل وارد.'
              : 'Remaining capacity is computed from authenticated transaction events. Automated alerts fire at 80% and 90% of daily/monthly ceilings. Pausing a wallet routes new payment intents safely without losing in-flight SMS capture.'}
          </p>
        </div>
      </div>

      {/* Rails Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {rails.length === 0 ? (
          <div className="col-span-full p-12 text-center bg-surface-container-lowest border border-outline-variant rounded-2xl space-y-4 shadow-xs">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto shadow-xs">
              <span className="material-symbols-outlined text-3xl">account_balance_wallet</span>
            </div>
            <h3 className="text-title-md font-bold text-on-surface">
              {language === 'ar' ? 'لم يتم إضافة مسارات استقبال بعد' : 'No receiving sources configured'}
            </h3>
            <p className="text-body-sm text-on-surface-variant max-w-md mx-auto">
              {language === 'ar'
                ? 'أضف محفظة فودافون كاش، إنستاباي IPA، أو محفظة أورنچ/إي آند للبدء بمراقبة الاستقبال والسعة.'
                : 'Add your Vodafone Cash, InstaPay VPA, Orange Cash, or e& Cash receiving wallet.'}
            </p>
            {onOpenAddSource && (
              <button
                onClick={onOpenAddSource}
                className="px-5 py-2.5 bg-primary text-on-primary rounded-xl text-label-md font-bold inline-flex items-center gap-2 shadow-xs active:scale-95 transition-all cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">add_circle</span>
                <span>{language === 'ar' ? 'إضافة أول مسار استقبال' : 'Add First Source'}</span>
              </button>
            )}
          </div>
        ) : (
          rails.map((rail) => {
            const hasDailyUsage = typeof rail.dailyIntake === 'number';
            const hasMonthlyUsage = typeof rail.monthlyIntake === 'number';
            const dailyIntake = rail.dailyIntake ?? 0;
            const monthlyIntake = rail.monthlyIntake ?? 0;
            const dailyPercent = rail.dailyPercentage ?? (hasDailyUsage && rail.dailyLimit > 0
              ? Math.round((dailyIntake / rail.dailyLimit) * 100)
              : 0);
            const monthlyPercent = rail.monthlyPercentage ?? (hasMonthlyUsage && rail.monthlyLimit > 0
              ? Math.round((monthlyIntake / rail.monthlyLimit) * 100)
              : 0);
            const isNearLimit = dailyPercent >= 80;

            return (
              <div
                key={rail.id}
                className={`rounded-2xl border p-5 transition-all shadow-xs heroui-card ${
                  rail.isPaused
                    ? 'bg-surface-container-low border-outline-variant opacity-80'
                    : isNearLimit
                    ? 'bg-error-container/10 border-error/40'
                    : 'bg-surface-container-lowest border-outline-variant hover:border-primary/40'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: rail.color }}
                      ></span>
                      <h3 className="text-title-md font-bold text-on-surface">
                        {rail.name}
                      </h3>
                      {rail.isPaused && (
                        <span className="px-2 py-0.5 rounded-full text-label-xs bg-outline text-white font-semibold">
                          {language === 'ar' ? 'معطلة لطلبات الدفع الجديدة' : 'Paused for Invoices'}
                        </span>
                      )}
                    </div>
                    <p className="text-label-sm font-code-num text-on-surface-variant mt-1 font-medium">
                      {rail.walletNumber}
                    </p>
                  </div>

                  <div className="text-right rtl:text-left">
                    <span className="text-label-xs text-on-surface-variant block">
                      {language === 'ar' ? 'حصة اليوم' : 'Daily Share'}
                    </span>
                    <span className="text-headline-sm font-code-num font-extrabold text-primary">
                      {rail.sharePercentage}%
                    </span>
                  </div>
                </div>

                {/* Daily Limit Bar */}
                <div className="mt-4 space-y-1.5">
                  <div className="flex justify-between text-body-xs">
                    <span className="text-on-surface-variant font-medium">
                      {language === 'ar' ? 'الاستهلاك اليومي:' : 'Daily Capacity:'}
                    </span>
                    <span className="font-code-num font-bold text-on-surface">
                      {hasDailyUsage
                        ? `${dailyIntake.toLocaleString('en-US')} / ${rail.dailyLimit.toLocaleString('en-US')} ج.م (${dailyPercent}%)`
                        : language === 'ar' ? 'لا توجد حركة مؤكدة لليوم بعد' : 'No verified daily activity yet'}
                    </span>
                  </div>

                  <div className="w-full bg-outline-variant/40 rounded-full h-2.5 overflow-hidden">
                    <div
                      className={`h-2.5 rounded-full transition-all duration-500 ${
                        isNearLimit ? 'bg-error' : 'bg-primary'
                      }`}
                      style={{ width: `${Math.min(dailyPercent, 100)}%` }}
                    ></div>
                  </div>
                </div>

                {/* Monthly Limit Bar */}
                <div className="mt-2.5 space-y-1">
                  <div className="flex justify-between text-label-xs">
                    <span className="text-on-surface-variant">
                      {language === 'ar' ? 'استهلاك الشهر:' : 'Monthly Capacity:'}
                    </span>
                    <span className="font-code-num text-on-surface-variant font-medium">
                      {hasMonthlyUsage
                        ? `${monthlyIntake.toLocaleString('en-US')} / ${rail.monthlyLimit.toLocaleString('en-US')} ج.م (${monthlyPercent}%)`
                        : language === 'ar' ? 'لا توجد حركة مؤكدة للشهر بعد' : 'No verified monthly activity yet'}
                    </span>
                  </div>
                </div>

                {/* Actions & Safe Switching */}
                <div className="mt-4 pt-3 border-t border-outline-variant/60 flex items-center justify-between">
                  <span className="text-label-xs text-on-surface-variant font-code-num font-semibold">
                    {rail.txnsCount} {language === 'ar' ? 'معاملة مسجلة' : 'reconciled txns'}
                  </span>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void handleTogglePause(rail.id)}
                      className={`px-3 py-1.5 rounded-xl text-label-xs font-bold active:scale-95 transition-all cursor-pointer ${
                        rail.isPaused
                          ? 'bg-primary text-on-primary shadow-xs'
                          : 'bg-surface-container-high text-on-surface hover:bg-surface-container border border-outline-variant'
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
                      className="p-1.5 rounded-xl text-on-surface-variant hover:bg-surface-container border border-outline-variant cursor-pointer transition-colors"
                      title={language === 'ar' ? 'تعديل سياسة الحدود' : 'Configure Policy'}
                    >
                      <span className="material-symbols-outlined text-base">tune</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Rail Config Modal */}
      {selectedRail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-outline-variant">
              <h3 className="text-title-md font-bold text-on-surface">
                {selectedRail.name} {language === 'ar' ? '— ضبط سياسة السقف والحدود' : '— Financial Policy'}
              </h3>
              <button
                onClick={() => setSelectedRail(null)}
                className="p-1 text-on-surface-variant hover:bg-surface-container rounded-lg cursor-pointer"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-4 text-body-sm text-on-surface">
              <div>
                <label className="text-label-sm font-bold text-on-surface block mb-1.5">
                  {language === 'ar' ? 'سقف الاستقبال اليومي (جنيه مصري):' : 'Daily Intake Cap (EGP):'}
                </label>
                <input
                  type="number"
                  defaultValue={selectedRail.dailyLimit}
                  className="w-full px-3.5 py-2.5 bg-surface-container-lowest border border-outline-variant rounded-xl text-on-surface font-code-num focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="text-label-sm font-bold text-on-surface block mb-1.5">
                  {language === 'ar' ? 'نسبة إطلاق التنبيه الاستباقي (%):' : 'Alert Margin Threshold (%):'}
                </label>
                <input
                  type="number"
                  defaultValue={80}
                  className="w-full px-3.5 py-2.5 bg-surface-container-lowest border border-outline-variant rounded-xl text-on-surface font-code-num focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none"
                />
              </div>

              <div className="p-3 bg-surface-container-low rounded-xl border border-outline-variant text-label-xs text-on-surface-variant">
                {language === 'ar'
                  ? 'التنبيهات ستصل فوراً إلى قنوات تيليجرام والـ Webhook التي تم إعدادها لمساحة العمل قبل وصول المحفظة إلى السقف.'
                  : 'Alerts are delivered through Telegram and Webhooks configured for this workspace before hitting ceilings.'}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-outline-variant">
              <button
                onClick={() => setSelectedRail(null)}
                className="px-4 py-2 bg-primary text-on-primary rounded-xl text-label-sm font-bold shadow-xs active:scale-95 transition-all cursor-pointer"
              >
                {language === 'ar' ? 'حفظ السياسة' : 'Save Policy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
