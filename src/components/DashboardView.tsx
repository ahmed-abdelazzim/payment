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
    <main className="max-w-7xl mx-auto px-margin-mobile pt-16 mt-2 space-y-space-md">
      {/* Offline Alert Banner */}
      {!offlineAlertDismissed && offlineDevice && (
        <div className="rounded-lg border border-error bg-error-container/40 p-space-md flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm transition-all duration-150 shadow-sm">
          <div className="flex items-center gap-space-sm">
            <span className="material-symbols-outlined text-error text-xl">warning</span>
            <div>
              <p className="text-body-md font-semibold text-on-error-container">
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
              <p className="text-label-sm text-on-surface-variant">
                {language === 'ar'
                  ? `انتهت مهلة آخر اتصال من بوابة ${offlineDevice.location} · مستوى البطارية ${offlineDevice.batteryLevel}%`
                  : `Last ping timed out from ${offlineDevice.location} · Battery level was ${offlineDevice.batteryLevel}%`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onInspectDevice(offlineDevice)}
              className="px-3 py-1.5 bg-error text-on-error rounded text-label-sm font-semibold hover:opacity-90 active:scale-95 transition-all shadow-sm"
            >
              {language === 'ar' ? 'فحص الجهاز' : 'Inspect Device'}
            </button>
            <button
              onClick={() => setOfflineAlertDismissed(true)}
              className="px-2 py-1.5 text-on-surface-variant hover:bg-surface-container rounded text-label-sm"
            >
              {language === 'ar' ? 'تجاهل' : 'Dismiss'}
            </button>
          </div>
        </div>
      )}

      {/* KPI Metric Cards Grid */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-space-md">
        {/* Card 1: Received Today */}
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-space-md flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-label-sm text-on-surface-variant uppercase tracking-wider">
              {language === 'ar' ? 'إجمالي اليوم · Received Today' : 'Received Today · إجمالي اليوم'}
            </span>
            <span className="p-1 rounded bg-surface-container text-primary">
              <span className="material-symbols-outlined text-base">payments</span>
            </span>
          </div>

          <div className="my-space-sm">
            <div className="flex items-baseline gap-1.5">
              <span className="text-headline-lg font-code-num text-on-surface">
                {totalVolume.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
              <span className="text-label-md font-bold text-on-surface-variant">
                {language === 'ar' ? 'ج.م' : 'EGP'}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between text-label-sm border-t border-outline-variant/50 pt-2 mt-1">
            <div className="flex items-center gap-1 text-primary font-code-num">
              <span className="material-symbols-outlined text-sm">trending_up</span>
              <span>+18.4%</span>
              <span className="text-on-surface-variant">
                {language === 'ar' ? 'مقارنة بالأمس' : 'vs yesterday'}
              </span>
            </div>
            <span className="text-on-surface-variant font-code-num font-medium">
              {transactions.length} {language === 'ar' ? 'معاملة' : 'txns'}
            </span>
          </div>
        </div>

        {/* Card 2: Review Required */}
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-space-md flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-label-sm text-on-surface-variant uppercase tracking-wider">
              {language === 'ar' ? 'قيد المراجعة · Review Required' : 'Review Required · قيد المراجعة'}
            </span>
            <span className="p-1 rounded bg-error-container text-error">
              <span className="material-symbols-outlined text-base">rule</span>
            </span>
          </div>

          <div className="my-space-sm">
            <div className="flex items-baseline gap-2">
              <span className="text-headline-lg font-code-num text-error">
                {pendingReviewCount}
              </span>
              <span className="text-body-md text-on-surface-variant">
                {language === 'ar' ? 'عناصر تتطلب التحقق' : 'items pending verification'}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between text-label-sm border-t border-outline-variant/50 pt-2 mt-1">
            <span className="text-on-surface-variant">
              {language === 'ar' ? 'مطابقة منخفضة / تأخر SMS' : 'Low confidence matching / SMS lag'}
            </span>
            <button
              onClick={() => setFeedFilter('review')}
              className="text-primary font-semibold hover:underline flex items-center gap-0.5"
            >
              <span>{language === 'ar' ? 'المعالجة الآن' : 'Resolve now'}</span>
              <span className="material-symbols-outlined text-xs">arrow_forward</span>
            </button>
          </div>
        </div>

        {/* Card 3: Active Fleet */}
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-space-md flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-label-sm text-on-surface-variant uppercase tracking-wider">
              {language === 'ar' ? 'أجهزة الدفع · Active Devices' : 'Active Devices · أجهزة الدفع'}
            </span>
            <span className="p-1 rounded bg-surface-container text-primary">
              <span className="material-symbols-outlined text-base">point_of_sale</span>
            </span>
          </div>

          <div className="my-space-sm">
            <div className="flex items-baseline gap-1.5">
              <span className="text-headline-lg font-code-num text-on-surface">
                {onlineDevicesCount}
              </span>
              <span className="text-title-md text-on-surface-variant">/ {devices.length}</span>
              <span className="text-label-sm text-primary font-semibold ml-2">
                {devices.length > 0
                  ? Math.round((onlineDevicesCount / devices.length) * 100)
                  : 0}
                % {language === 'ar' ? 'صحة الأسطول' : 'Fleet Health'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 text-label-sm border-t border-outline-variant/50 pt-2 mt-1 text-on-surface-variant">
            <span className="truncate">Vodafone, Orange, e&, InstaPay Rails</span>
          </div>
        </div>
      </section>

      {/* Provider Rail Distribution Bento */}
      <section className="bg-surface-container-lowest rounded-xl border border-outline-variant p-space-md shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-space-sm border-b border-outline-variant gap-2">
          <div>
            <h2 className="text-title-md text-on-surface font-semibold">
              {language === 'ar' ? 'حجم مسارات التسوية والمحافظ' : 'Provider Settlement Rails Volume'}
            </h2>
            <p className="text-label-sm text-on-surface-variant">
              {language === 'ar'
                ? 'إجمالي التدفق المالي عبر شبكات المحافظ الرقمية والمدفوعات المصرية'
                : 'Aggregated direct-to-wallet intake split across Egyptian financial networks'}
            </p>
          </div>

          <div className="flex items-center gap-3 text-label-sm font-code-num text-on-surface-variant">
            <span>
              {language === 'ar' ? 'المستهدف: ' : 'Target: '}
              <strong className="text-on-surface">60,000 EGP</strong>
            </span>
            <span className="text-outline">|</span>
            <span className="text-primary font-semibold">
              {((totalVolume / 60000) * 100).toFixed(1)}% {language === 'ar' ? 'متحقق' : 'Realized'}
            </span>
          </div>
        </div>

        {/* Bars Matrix */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md pt-space-md">
          {rails.length === 0 ? (
            <div className="col-span-full p-6 text-center bg-surface-container-low rounded-xl border border-outline-variant/60 text-on-surface-variant text-body-sm">
              {language === 'ar'
                ? 'لم يتم تهيئة أي مسارات استقبال بعد. يمكنك إضافة محفظة فودافون كاش، إنستاباي، أورنچ، أو إي آند من تبويب المسارات.'
                : 'No receiving rails configured yet. Add your Vodafone Cash, InstaPay, Orange, or e& wallet to monitor capacity.'}
            </div>
          ) : rails.map((rail) => (
            <div
              key={rail.id}
              className="p-space-sm rounded bg-surface-container-low border border-outline-variant"
            >
              <div className="flex justify-between items-center text-label-sm mb-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: rail.color }}
                  ></span>
                  <span className="font-semibold text-on-surface">{rail.name}</span>
                </div>
                <span className="font-code-num text-primary font-bold">
                  {rail.sharePercentage}%
                </span>
              </div>

              <div className="w-full bg-outline-variant/40 rounded-full h-2 mb-2">
                <div
                  className="h-2 rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(rail.sharePercentage, 100)}%`,
                    backgroundColor: rail.color,
                  }}
                ></div>
              </div>

              <div className="flex justify-between text-label-sm text-on-surface-variant font-code-num">
                <span>
                  {rail.volume.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{' '}
                  EGP
                </span>
                <span>
                  {rail.txnsCount} {language === 'ar' ? 'عملية' : 'txns'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Live Incoming Feed Section */}
      <section
        className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm overflow-hidden"
        id="feed"
      >
        {/* Section Header */}
        <div className="p-space-md border-b border-outline-variant flex flex-col md:flex-row md:items-center justify-between gap-space-sm bg-surface-bright">
          <div className="flex items-center gap-space-sm">
            <h2 className="text-headline-sm text-on-surface">
              {language === 'ar' ? 'التدفق المالي اللحظي' : 'Live Incoming Feed'}
            </h2>

            {/* Auto-Sync Pulse */}
            <button
              onClick={() => setAutoSyncEnabled(!autoSyncEnabled)}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container text-primary text-label-sm font-medium hover:bg-surface-container-high transition-colors"
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
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setFeedFilter('all')}
              className={`px-3 py-1 rounded text-label-sm font-semibold shadow-sm active:scale-95 transition-all ${
                feedFilter === 'all'
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container border border-outline-variant'
              }`}
            >
              {language === 'ar' ? `الكل (${transactions.length})` : `All (${transactions.length})`}
            </button>

            <button
              onClick={() => setFeedFilter('confirmed')}
              className={`px-3 py-1 rounded text-label-sm font-semibold active:scale-95 transition-all ${
                feedFilter === 'confirmed'
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container border border-outline-variant'
              }`}
            >
              {language === 'ar' ? `المؤكدة (${confirmedCount})` : `Confirmed (${confirmedCount})`}
            </button>

            <button
              onClick={() => setFeedFilter('review')}
              className={`px-3 py-1 rounded text-label-sm font-semibold flex items-center gap-1 active:scale-95 transition-all ${
                feedFilter === 'review'
                  ? 'bg-error text-on-error'
                  : 'bg-surface-container-low text-error hover:bg-error-container border border-outline-variant'
              }`}
            >
              <span>{language === 'ar' ? `قيد المراجعة (${pendingReviewCount})` : `Review (${pendingReviewCount})`}</span>
              <span className="w-2 h-2 rounded-full bg-error"></span>
            </button>

            <button
              onClick={onOpenLedger}
              title="Advanced Filter"
              className="p-1 rounded text-on-surface-variant hover:bg-surface-container ml-1"
            >
              <span className="material-symbols-outlined text-lg">tune</span>
            </button>
          </div>
        </div>

        {/* Transaction List High Financial Legibility Cards */}
        <div className="divide-y divide-outline-variant">
          {filteredTransactions.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-surface-container-low text-primary flex items-center justify-center mx-auto">
                <span className="material-symbols-outlined text-2xl">receipt_long</span>
              </div>
              <h3 className="text-title-md font-bold text-on-surface">
                {language === 'ar' ? 'لا توجد معاملات في التغذية الحية بعد' : 'No transactions in live feed yet'}
              </h3>
              <p className="text-body-sm text-on-surface-variant max-w-md mx-auto">
                {language === 'ar'
                  ? 'بمجرد استلام أول إشعار أو رسالة SMS على هاتف الاستقبال المتصل، سيتم فحصها وتأكيدها وتحديث الرصيد هنا لحظياً.'
                  : 'Once an SMS or push notification is received on your paired receiving device, it will be instantly reconciled and displayed here.'}
              </p>
            </div>
          ) : (
            filteredTransactions.map((tx) => {
            const isReview = tx.status === 'review_required';

            return (
              <div
                key={tx.id}
                onClick={() => onSelectTransaction(tx)}
                className={`p-space-md transition-colors flex flex-col lg:flex-row lg:items-center justify-between gap-space-sm cursor-pointer ${
                  isReview
                    ? 'bg-error-container/10 hover:bg-error-container/20 border-l-4 border-l-error'
                    : 'hover:bg-surface-container-low'
                }`}
              >
                <div className="flex items-start sm:items-center gap-space-md">
                  {/* Icon indicator */}
                  <div
                    className={`w-10 h-10 rounded flex items-center justify-center shrink-0 border ${
                      isReview
                        ? 'bg-error-container border-error/30 text-error'
                        : tx.provider === 'instapay'
                        ? 'bg-tertiary-container/10 border-tertiary-container/20 text-tertiary-container'
                        : 'bg-primary-container/10 border-primary-container/20 text-primary-container'
                    }`}
                  >
                    <span className="material-symbols-outlined">
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
                        +{tx.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} {tx.currency}
                      </span>

                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-label-sm font-semibold ${
                          tx.provider === 'instapay'
                            ? 'bg-surface-container text-tertiary'
                            : tx.provider === 'orange_cash'
                            ? 'bg-surface-container-high text-secondary'
                            : 'bg-surface-container text-primary'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            tx.provider === 'instapay'
                              ? 'bg-tertiary'
                              : tx.provider === 'orange_cash'
                              ? 'bg-secondary'
                              : 'bg-primary'
                          }`}
                        ></span>
                        {tx.providerLabel}
                      </span>

                      <span
                        className={`text-label-sm ${
                          isReview ? 'text-error font-medium' : 'text-on-surface-variant'
                        }`}
                      >
                        {tx.deviceName}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 mt-0.5 text-body-md text-on-surface-variant">
                      <span className="font-medium text-on-surface font-code-num">
                        {tx.senderName}
                      </span>
                      <span className="font-code-num text-label-md">
                        ({tx.senderPhone})
                      </span>
                      <span className="text-outline">·</span>
                      {isReview ? (
                        <span className="text-label-sm text-error font-medium">
                          {tx.reviewReason}
                        </span>
                      ) : (
                        <span className="text-label-sm text-secondary font-code-num">
                          Ref: #{tx.trxId}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between lg:justify-end gap-space-md border-t lg:border-t-0 pt-2 lg:pt-0 border-outline-variant/60">
                  <span className="text-label-sm font-code-num text-secondary">
                    {tx.timeAgo}
                  </span>

                  {isReview ? (
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-label-sm bg-error-container text-on-error-container border border-error/40 font-bold">
                        <span className="w-2 h-2 rounded-full bg-error animate-pulse"></span>
                        <span>
                          {language === 'ar' ? 'مطلوب التحقق' : 'Review Required'} ({tx.confidenceScore}%)
                        </span>
                      </span>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenReview(tx);
                        }}
                        className="px-2.5 py-1 bg-primary text-on-primary rounded text-label-sm font-semibold active:scale-95 transition-all shadow-sm"
                      >
                        {language === 'ar' ? 'فحص / تأكيد' : 'Verify'}
                      </button>
                    </div>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-label-sm bg-surface-container text-primary border border-primary/20 font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                      <span>{language === 'ar' ? 'مؤكدة' : 'Confirmed'}</span>
                    </span>
                  )}

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectTransaction(tx);
                    }}
                    className="p-1 text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded"
                    title="Transaction Details"
                  >
                    <span className="material-symbols-outlined text-lg">more_vert</span>
                  </button>
                </div>
              </div>
            );
          }))}
        </div>

        {/* Feed Footer Telemetry */}
        <div className="p-space-sm bg-surface-container-low border-t border-outline-variant flex flex-col sm:flex-row items-center justify-between gap-2 text-label-sm text-on-surface-variant">
          <span>
            {language === 'ar'
              ? `عرض أحدث العمليات · تم مزامنة ${transactions.length} عنصر مع دفتر الحسابات العام`
              : `Displaying latest batch · ${transactions.length} items synced with accounting ledger`}
          </span>

          <button
            onClick={onOpenLedger}
            className="text-primary font-semibold hover:underline flex items-center gap-1"
          >
            <span>{language === 'ar' ? 'فتح سجل المطابقة الكامل' : 'Open Full Reconciliation Ledger'}</span>
            <span className="material-symbols-outlined text-sm">open_in_new</span>
          </button>
        </div>
      </section>
    </main>
  );
};
