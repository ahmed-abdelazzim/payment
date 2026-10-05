import React, { useState } from 'react';
import { Transaction, Device, ProviderRail } from '../types';

interface DashboardViewProps {
  transactions: Transaction[];
  devices: Device[];
  rails: ProviderRail[];
  onSelectTransaction: (tx: Transaction) => void;
  onOpenReview: (tx: Transaction) => void;
  onInspectDevice: (device: Device) => void;
  onOpenLedger: () => void;
  language: 'en' | 'ar';
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  transactions,
  devices,
  rails,
  onSelectTransaction,
  onOpenReview,
  onInspectDevice,
  onOpenLedger,
  language,
}) => {
  const [feedFilter, setFeedFilter] = useState<'all' | 'confirmed' | 'review'>('all');
  const [offlineAlertDismissed, setOfflineAlertDismissed] = useState(false);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);

  // Compute live aggregates from transactions
  const totalVolume = transactions
    .filter((t) => t.status !== 'failed')
    .reduce((sum, t) => sum + t.amount, 0);

  const pendingReviewCount = transactions.filter((t) => t.status === 'review_required').length;
  const confirmedCount = transactions.filter((t) => t.status === 'confirmed').length;

  const onlineDevicesCount = devices.filter((d) => d.status === 'online').length;
  const offlineDevice = devices.find((d) => d.status === 'offline');

  // Filter feed items
  const filteredTransactions = transactions.filter((tx) => {
    if (feedFilter === 'confirmed') return tx.status === 'confirmed';
    if (feedFilter === 'review') return tx.status === 'review_required';
    return true;
  });

  return (
    <main className="py-6 max-w-7xl mx-auto px-4 sm:px-6 space-y-6">
      {/* Offline Alert Banner */}
      {!offlineAlertDismissed && offlineDevice && (
        <div className="rounded-2xl border border-error/40 bg-error-container/20 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all shadow-xs heroui-card">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-error/10 text-error flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-2xl">warning</span>
            </div>
            <div>
              <p className="text-body-md font-bold text-on-error-container">
                {language === 'ar' ? (
                  <>
                    جهاز الدفع {offlineDevice.deviceNumber} ({offlineDevice.providerLabel} ·{' '}
                    <span className="font-code-num text-code-num">
                      {offlineDevice.phoneNumber.replace(/(\d{3})\d{5}(\d{3})/, '$1•••••$2')}
                    </span>
                    ) متوقف عن الاتصال منذ {offlineDevice.offlineDuration || '14 min'}.
                  </>
                ) : (
                  <>
                    Payment Device {offlineDevice.deviceNumber} ({offlineDevice.providerLabel} ·{' '}
                    <span className="font-code-num text-code-num">
                      {offlineDevice.phoneNumber.replace(/(\d{3})\d{5}(\d{3})/, '$1•••••$2')}
                    </span>
                    ) has been offline for {offlineDevice.offlineDuration || '14 min'}.
                  </>
                )}
              </p>
              <p className="text-label-sm text-on-surface-variant mt-0.5">
                {language === 'ar'
                  ? `انتهت مهلة آخر اتصال من بوابة ${offlineDevice.location} · مستوى البطارية ${offlineDevice.batteryLevel}%`
                  : `Last ping timed out from ${offlineDevice.location} · Battery level was ${offlineDevice.batteryLevel}%`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => onInspectDevice(offlineDevice)}
              className="px-4 py-2 bg-error text-white rounded-xl text-label-sm font-bold hover:bg-error/90 active:scale-95 transition-all shadow-xs cursor-pointer"
            >
              {language === 'ar' ? 'فحص الجهاز' : 'Inspect Device'}
            </button>
            <button
              onClick={() => setOfflineAlertDismissed(true)}
              className="px-3 py-2 text-on-surface-variant hover:bg-surface-container rounded-xl text-label-sm font-semibold transition-colors cursor-pointer"
            >
              {language === 'ar' ? 'تجاهل' : 'Dismiss'}
            </button>
          </div>
        </div>
      )}

      {/* KPI Metric Cards Grid */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Card 1: Received Today */}
        <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant p-5 flex flex-col justify-between shadow-xs heroui-card">
          <div className="flex items-center justify-between">
            <span className="text-label-xs font-bold text-on-surface-variant uppercase tracking-wider">
              {language === 'ar' ? 'إجمالي التحويلات اليوم' : 'Received Today'}
            </span>
            <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <span className="material-symbols-outlined text-lg">payments</span>
            </div>
          </div>

          <div className="my-3">
            <div className="flex items-baseline gap-1.5">
              <span className="text-headline-lg font-code-num font-extrabold text-on-surface">
                {totalVolume.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
              <span className="text-title-sm font-bold text-primary">
                {language === 'ar' ? 'ج.م' : 'EGP'}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between text-label-sm border-t border-outline-variant/60 pt-3">
            <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-bold font-code-num">
              <span className="material-symbols-outlined text-sm">trending_up</span>
              <span>+18.4%</span>
              <span className="text-on-surface-variant font-normal">
                {language === 'ar' ? 'مقارنة بالأمس' : 'vs yesterday'}
              </span>
            </div>
            <span className="text-on-surface-variant font-code-num font-semibold">
              {transactions.length} {language === 'ar' ? 'معاملة' : 'txns'}
            </span>
          </div>
        </div>

        {/* Card 2: Review Required */}
        <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant p-5 flex flex-col justify-between shadow-xs heroui-card">
          <div className="flex items-center justify-between">
            <span className="text-label-xs font-bold text-on-surface-variant uppercase tracking-wider">
              {language === 'ar' ? 'حركات تحتاج مراجعة' : 'Review Required'}
            </span>
            <div className="w-9 h-9 rounded-xl bg-error/10 text-error flex items-center justify-center">
              <span className="material-symbols-outlined text-lg">rule</span>
            </div>
          </div>

          <div className="my-3">
            <div className="flex items-baseline gap-2">
              <span className="text-headline-lg font-code-num font-extrabold text-error">
                {pendingReviewCount}
              </span>
              <span className="text-body-sm text-on-surface-variant font-medium">
                {language === 'ar' ? 'عمليات معلقة للتحقق' : 'items pending verification'}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between text-label-sm border-t border-outline-variant/60 pt-3">
            <span className="text-on-surface-variant text-label-xs">
              {language === 'ar' ? 'تأخر رسائل / فروق أرصدة' : 'Low confidence / SMS lag'}
            </span>
            <button
              onClick={() => setFeedFilter('review')}
              className="text-primary font-bold hover:underline flex items-center gap-0.5 cursor-pointer text-label-xs"
            >
              <span>{language === 'ar' ? 'المعالجة الآن' : 'Resolve now'}</span>
              <span className="material-symbols-outlined text-xs">arrow_forward</span>
            </button>
          </div>
        </div>

        {/* Card 3: Active Fleet */}
        <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant p-5 flex flex-col justify-between shadow-xs heroui-card">
          <div className="flex items-center justify-between">
            <span className="text-label-xs font-bold text-on-surface-variant uppercase tracking-wider">
              {language === 'ar' ? 'أسطول الأجهزة النشطة' : 'Active Fleet'}
            </span>
            <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <span className="material-symbols-outlined text-lg">point_of_sale</span>
            </div>
          </div>

          <div className="my-3">
            <div className="flex items-baseline gap-2">
              <span className="text-headline-lg font-code-num font-extrabold text-on-surface">
                {onlineDevicesCount}
              </span>
              <span className="text-title-sm text-on-surface-variant">/ {devices.length}</span>
              <span className="text-label-xs text-emerald-600 dark:text-emerald-400 font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 ml-2">
                {devices.length > 0
                  ? Math.round((onlineDevicesCount / devices.length) * 100)
                  : 0}
                % {language === 'ar' ? 'صحة الأجهزة' : 'Fleet Health'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 text-label-xs border-t border-outline-variant/60 pt-3 text-on-surface-variant">
            <span className="truncate">فودافون كاش، إنستاباي، أورنچ كاش، إي آند</span>
          </div>
        </div>
      </section>

      {/* Provider Rail Distribution Bento */}
      <section className="bg-surface-container-lowest rounded-2xl border border-outline-variant p-5 shadow-xs heroui-card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-outline-variant/80 gap-3">
          <div>
            <h2 className="text-title-md text-on-surface font-bold">
              {language === 'ar' ? 'حجم التدفق عبر مسارات الاستقبال' : 'Receiving Rails Intake Volume'}
            </h2>
            <p className="text-label-sm text-on-surface-variant mt-0.5">
              {language === 'ar'
                ? 'إجمالي التدفق المالي وسعة المحافظ بالنسبة لحدود البنك المركزي'
                : 'Aggregated direct-to-wallet intake split across financial networks'}
            </p>
          </div>

          <div className="flex items-center gap-3 text-label-sm font-code-num text-on-surface-variant bg-surface-container-low px-3 py-1.5 rounded-xl border border-outline-variant/60">
            <span>
              {language === 'ar' ? 'السقف المالي: ' : 'Daily Target: '}
              <strong className="text-on-surface">60,000 ج.م</strong>
            </span>
            <span className="text-outline/40">|</span>
            <span className="text-primary font-bold">
              {((totalVolume / 60000) * 100).toFixed(1)}% {language === 'ar' ? 'مستغل' : 'Used'}
            </span>
          </div>
        </div>

        {/* Bars Matrix */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4">
          {rails.length === 0 ? (
            <div className="col-span-full p-8 text-center bg-surface-container-low rounded-2xl border border-outline-variant/60 text-on-surface-variant text-body-sm space-y-2">
              <span className="material-symbols-outlined text-3xl text-primary block">account_balance_wallet</span>
              <p>
                {language === 'ar'
                  ? 'لم يتم تهيئة أي مسارات استقبال بعد. أضف محفظة من صفحة المسارات لبدء مراقبة الحدود المالية.'
                  : 'No receiving rails configured yet. Add a wallet from the Rails tab to monitor capacity.'}
              </p>
            </div>
          ) : (
            rails.map((rail) => (
              <div
                key={rail.id}
                className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/80 hover:border-primary/40 transition-colors"
              >
                <div className="flex justify-between items-center text-label-sm mb-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: rail.color }}
                    ></span>
                    <span className="font-bold text-on-surface">{rail.name}</span>
                  </div>
                  <span className="font-code-num text-primary font-bold">
                    {rail.sharePercentage}%
                  </span>
                </div>

                <div className="w-full bg-outline-variant/40 rounded-full h-2 mb-2.5 overflow-hidden">
                  <div
                    className="h-2 rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(rail.sharePercentage, 100)}%`,
                      backgroundColor: rail.color,
                    }}
                  ></div>
                </div>

                <div className="flex justify-between text-label-xs text-on-surface-variant font-code-num font-medium">
                  <span>
                    {rail.volume.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    ج.م
                  </span>
                  <span>
                    {rail.txnsCount} {language === 'ar' ? 'عملية' : 'txns'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Live Incoming Feed Section */}
      <section
        className="bg-surface-container-lowest rounded-2xl border border-outline-variant shadow-xs overflow-hidden heroui-card"
        id="feed"
      >
        {/* Section Header */}
        <div className="p-4 sm:p-5 border-b border-outline-variant flex flex-col md:flex-row md:items-center justify-between gap-3 bg-surface-container-lowest">
          <div className="flex items-center gap-3">
            <h2 className="text-headline-sm font-bold text-on-surface">
              {language === 'ar' ? 'التدفق المالي اللحظي' : 'Live Incoming Feed'}
            </h2>

            {/* Auto-Sync Pulse */}
            <button
              onClick={() => setAutoSyncEnabled(!autoSyncEnabled)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-label-xs font-bold hover:bg-primary/20 transition-colors cursor-pointer"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full bg-primary ${
                  autoSyncEnabled ? 'animate-ping' : ''
                }`}
              ></span>
              <span>
                {autoSyncEnabled
                  ? language === 'ar'
                    ? 'المزامنة التلقائية نشطة'
                    : 'Auto-sync active'
                  : language === 'ar'
                  ? 'المزامنة متوقفة'
                  : 'Auto-sync paused'}
              </span>
            </button>
          </div>

          {/* Filter Chips */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setFeedFilter('all')}
              className={`px-3 py-1 rounded-full text-label-xs font-bold shadow-xs active:scale-95 transition-all cursor-pointer ${
                feedFilter === 'all'
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container border border-outline-variant'
              }`}
            >
              {language === 'ar' ? `الكل (${transactions.length})` : `All (${transactions.length})`}
            </button>

            <button
              onClick={() => setFeedFilter('confirmed')}
              className={`px-3 py-1 rounded-full text-label-xs font-bold active:scale-95 transition-all cursor-pointer ${
                feedFilter === 'confirmed'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container border border-outline-variant'
              }`}
            >
              {language === 'ar' ? `المؤكدة (${confirmedCount})` : `Confirmed (${confirmedCount})`}
            </button>

            <button
              onClick={() => setFeedFilter('review')}
              className={`px-3 py-1 rounded-full text-label-xs font-bold flex items-center gap-1.5 active:scale-95 transition-all cursor-pointer ${
                feedFilter === 'review'
                  ? 'bg-error text-white shadow-xs'
                  : 'bg-error-container/20 text-error hover:bg-error-container/30 border border-error/30'
              }`}
            >
              <span>{language === 'ar' ? `قيد المراجعة (${pendingReviewCount})` : `Review (${pendingReviewCount})`}</span>
              <span className="w-1.5 h-1.5 rounded-full bg-error animate-pulse"></span>
            </button>

            <button
              onClick={onOpenLedger}
              title="Advanced Filter"
              className="p-1.5 rounded-xl text-on-surface-variant hover:bg-surface-container transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-lg">tune</span>
            </button>
          </div>
        </div>

        {/* Transaction List */}
        <div className="divide-y divide-outline-variant/60">
          {filteredTransactions.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-surface-container-low text-primary flex items-center justify-center mx-auto shadow-xs">
                <span className="material-symbols-outlined text-2xl">receipt_long</span>
              </div>
              <h3 className="text-title-md font-bold text-on-surface">
                {language === 'ar' ? 'لا توجد معاملات في التغذية الحية بعد' : 'No transactions in live feed yet'}
              </h3>
              <p className="text-body-sm text-on-surface-variant max-w-md mx-auto">
                {language === 'ar'
                  ? 'بمجرد استلام أول إشعار أو رسالة SMS على هاتف الاستقبال المتصل، سيتم فحصها وتأكيدها وتحديث الرصيد هنا لحظياً.'
                  : 'Once an SMS or push notification is received on your paired device, it will be instantly reconciled and displayed here.'}
              </p>
            </div>
          ) : (
            filteredTransactions.map((tx) => {
              const isReview = tx.status === 'review_required';

              return (
                <div
                  key={tx.id}
                  onClick={() => onSelectTransaction(tx)}
                  className={`p-4 sm:p-5 transition-colors flex flex-col lg:flex-row lg:items-center justify-between gap-3 cursor-pointer ${
                    isReview
                      ? 'bg-error-container/10 hover:bg-error-container/20 rtl:border-r-4 rtl:border-l-0 border-l-4 border-l-error'
                      : 'hover:bg-surface-container-low/70'
                  }`}
                >
                  <div className="flex items-start sm:items-center gap-3">
                    {/* Icon indicator */}
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border shadow-xs ${
                        isReview
                          ? 'bg-error-container border-error/30 text-error'
                          : tx.provider === 'instapay'
                          ? 'bg-primary/10 border-primary/20 text-primary'
                          : 'bg-surface-container border-outline-variant text-primary'
                      }`}
                    >
                      <span className="material-symbols-outlined text-xl">
                        {isReview
                          ? 'notification_important'
                          : tx.provider === 'instapay'
                          ? 'sync_alt'
                          : tx.provider === 'etisalat_cash'
                          ? 'phone_android'
                          : 'account_balance_wallet'}
                      </span>
                    </div>

                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`text-title-md font-code-num font-bold ${
                            isReview ? 'text-error' : 'text-on-surface'
                          }`}
                        >
                          +{tx.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م
                        </span>

                        <span
                          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-label-xs font-bold bg-surface-container text-on-surface border border-outline-variant/60"
                        >
                          {tx.providerLabel}
                        </span>

                        <span
                          className={`text-label-xs ${
                            isReview ? 'text-error font-medium' : 'text-on-surface-variant'
                          }`}
                        >
                          {tx.deviceName}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 mt-1 text-body-sm text-on-surface-variant">
                        <span className="font-semibold text-on-surface">
                          {tx.senderName}
                        </span>
                        <span className="font-code-num text-label-sm">
                          ({tx.senderPhone})
                        </span>
                        <span className="text-outline/40">·</span>
                        {isReview ? (
                          <span className="text-label-xs text-error font-bold">
                            {tx.reviewReason}
                          </span>
                        ) : (
                          <span className="text-label-xs text-primary font-code-num">
                            #{tx.trxId}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between lg:justify-end gap-3 border-t lg:border-t-0 pt-2 lg:pt-0 border-outline-variant/60">
                    <span className="text-label-xs font-code-num text-on-surface-variant">
                      {tx.timeAgo}
                    </span>

                    {isReview ? (
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-label-xs bg-error-container text-error border border-error/40 font-bold">
                          <span className="w-1.5 h-1.5 rounded-full bg-error animate-pulse"></span>
                          <span>
                            {language === 'ar' ? 'مطلوب التحقق' : 'Review Required'}
                          </span>
                        </span>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenReview(tx);
                          }}
                          className="px-3 py-1 bg-primary text-on-primary rounded-xl text-label-xs font-bold active:scale-95 transition-all shadow-xs cursor-pointer"
                        >
                          {language === 'ar' ? 'فحص / تأكيد' : 'Verify'}
                        </button>
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-label-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                        <span>{language === 'ar' ? 'مؤكدة' : 'Confirmed'}</span>
                      </span>
                    )}

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectTransaction(tx);
                      }}
                      className="p-1 text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-lg transition-colors cursor-pointer"
                      title="Transaction Details"
                    >
                      <span className="material-symbols-outlined text-lg">chevron_right</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Feed Footer Telemetry */}
        <div className="p-4 bg-surface-container-low border-t border-outline-variant flex flex-col sm:flex-row items-center justify-between gap-2 text-label-sm text-on-surface-variant">
          <span>
            {language === 'ar'
              ? `عرض أحدث العمليات · تم مزامنة ${transactions.length} عنصر مع دفتر القيود`
              : `Displaying latest batch · ${transactions.length} items synced with accounting ledger`}
          </span>

          <button
            onClick={onOpenLedger}
            className="text-primary font-bold hover:underline flex items-center gap-1 cursor-pointer"
          >
            <span>{language === 'ar' ? 'فتح سجل المطابقة الكامل' : 'Open Full Reconciliation Ledger'}</span>
            <span className="material-symbols-outlined text-sm">open_in_new</span>
          </button>
        </div>
      </section>
    </main>
  );
};
