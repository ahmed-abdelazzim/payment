import React, { useState, useMemo } from 'react';
import { Transaction } from '../types';

interface LedgerViewProps {
  transactions: Transaction[];
  selectedTransaction: Transaction | null;
  onSelectTransaction: (tx: Transaction | null) => void;
  onOpenReview: (tx: Transaction) => void;
  onConfirmTransaction: (tx: Transaction) => void;
  language: 'en' | 'ar';
}

export const LedgerView: React.FC<LedgerViewProps> = ({
  transactions,
  selectedTransaction,
  onSelectTransaction,
  onOpenReview,
  onConfirmTransaction,
  language,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'confirmed' | 'review_required' | 'failed'>('all');
  const [providerFilter, setProviderFilter] = useState<string>('all');
  const [isDetailDrawerOpen, setIsDetailDrawerOpen] = useState(true);

  // Compute settled total for confirmed items
  const settledTotal = useMemo(() => {
    return transactions
      .filter((t) => t.status === 'confirmed')
      .reduce((sum, t) => sum + t.amount, 0);
  }, [transactions]);

  // Counts for tabs
  const confirmedCount = transactions.filter((t) => t.status === 'confirmed').length;
  const reviewCount = transactions.filter((t) => t.status === 'review_required').length;
  const failedCount = transactions.filter((t) => t.status === 'failed').length;

  // Filter transactions based on search and selected tabs
  const filteredList = useMemo(() => {
    return transactions.filter((tx) => {
      // Status filter
      if (statusFilter !== 'all' && tx.status !== statusFilter) {
        return false;
      }
      // Provider filter
      if (providerFilter !== 'all' && tx.provider !== providerFilter) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesSender = tx.senderName.toLowerCase().includes(q);
        const matchesPhone = tx.senderPhone.toLowerCase().includes(q);
        const matchesTrx = tx.trxId.toLowerCase().includes(q);
        const matchesAmount = tx.amount.toString().includes(q);
        const matchesDevice = tx.deviceName.toLowerCase().includes(q);
        return matchesSender || matchesPhone || matchesTrx || matchesAmount || matchesDevice;
      }
      return true;
    });
  }, [transactions, statusFilter, providerFilter, searchQuery]);

  // Active detail transaction (default to selected or first confirmed)
  const activeDetailTx = selectedTransaction || transactions[0];

  return (
    <div className="pt-12 pb-28 max-w-2xl mx-auto min-h-screen px-margin-mobile flex flex-col gap-space-md">
      {/* Top Operational Bar: Search, Date & Quick Triggers */}
      <section className="mt-space-md flex flex-col gap-space-sm">
        {/* Search Input */}
        <div className="relative flex items-center">
          <span
            className="material-symbols-outlined absolute left-3 text-outline text-title-md pointer-events-none"
            data-icon="search"
          >
            search
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              language === 'ar'
                ? 'البحث بالمرسل، الهاتف (010...)، رقم العملية، أو المبلغ'
                : 'Search by sender, phone (010...), TRX ID, or amount'
            }
            className="w-full h-9 pl-9 pr-8 bg-surface-container-lowest border border-outline-variant rounded-lg text-body-md text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all shadow-none"
          />
          {searchQuery ? (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 text-outline-variant hover:text-on-surface p-1"
              aria-label="Clear search"
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          ) : (
            <button
              className="absolute right-2 text-outline-variant hover:text-on-surface"
              type="button"
              aria-label="Voice input"
            >
              <span className="material-symbols-outlined text-title-md" data-icon="mic">
                mic
              </span>
            </button>
          )}
        </div>

        {/* Date & Telemetry Bar */}
        <div className="flex items-center justify-between gap-space-sm bg-surface-container-lowest border border-outline-variant p-space-xs px-space-sm rounded-lg">
          <button className="flex items-center gap-1.5 text-on-surface hover:text-primary transition-colors">
            <span className="material-symbols-outlined text-body-md text-primary" data-icon="calendar_today">
              calendar_today
            </span>
            <span className="text-label-md font-semibold">
              {language === 'ar' ? 'اليوم (توقيت القاهرة)' : 'Today (Africa/Cairo)'}
            </span>
            <span className="material-symbols-outlined text-body-md" data-icon="expand_more">
              expand_more
            </span>
          </button>

          <div className="flex items-center gap-space-xs text-code-num font-code-num text-label-sm text-on-surface-variant">
            <span className="inline-block w-2 h-2 rounded-full bg-primary"></span>
            <span>
              EGP{' '}
              {settledTotal.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{' '}
              {language === 'ar' ? 'تسوية' : 'Settled'}
            </span>
          </div>
        </div>
      </section>

      {/* Sticky Horizontal Filter Chips */}
      <div className="sticky top-12 z-30 -mx-margin-mobile px-margin-mobile py-space-xs bg-background/95 backdrop-blur-sm flex items-center gap-1.5 overflow-x-auto no-scrollbar border-b border-outline-variant/50">
        {/* Tab: All */}
        <button
          onClick={() => setStatusFilter('all')}
          className={`whitespace-nowrap px-2.5 py-1 rounded text-label-sm font-semibold flex items-center gap-1 active:scale-95 transition-all ${
            statusFilter === 'all'
              ? 'bg-primary text-on-primary'
              : 'bg-surface-container-lowest border border-outline-variant text-on-surface hover:bg-surface-container'
          }`}
        >
          <span>{language === 'ar' ? 'الكل' : 'All'}</span>
          <span
            className={`px-1 py-0.2 rounded text-code-num font-code-num ${
              statusFilter === 'all'
                ? 'bg-primary-container text-on-primary-container'
                : 'text-outline'
            }`}
          >
            {transactions.length}
          </span>
        </button>

        {/* Tab: Confirmed */}
        <button
          onClick={() => setStatusFilter('confirmed')}
          className={`whitespace-nowrap px-2.5 py-1 rounded text-label-sm font-semibold flex items-center gap-1 active:scale-95 transition-all ${
            statusFilter === 'confirmed'
              ? 'bg-primary text-on-primary'
              : 'bg-surface-container-lowest border border-outline-variant text-on-surface hover:bg-surface-container'
          }`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
          <span>{language === 'ar' ? 'مؤكدة' : 'Confirmed'}</span>
          <span className="text-outline font-code-num">({confirmedCount})</span>
        </button>

        {/* Tab: Review Required */}
        <button
          onClick={() => setStatusFilter('review_required')}
          className={`whitespace-nowrap px-2.5 py-1 rounded text-label-sm font-semibold flex items-center gap-1 active:scale-95 transition-all ${
            statusFilter === 'review_required'
              ? 'bg-error text-on-error'
              : 'bg-surface-container-high text-on-primary-fixed border border-primary-fixed'
          }`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-error animate-ping"></span>
          <span>{language === 'ar' ? 'قيد المراجعة' : 'Review Required'}</span>
          <span className="text-primary font-code-num">({reviewCount})</span>
        </button>

        {/* Tab: Failed */}
        <button
          onClick={() => setStatusFilter('failed')}
          className={`whitespace-nowrap px-2.5 py-1 rounded text-label-sm font-semibold flex items-center gap-1 active:scale-95 transition-all ${
            statusFilter === 'failed'
              ? 'bg-secondary text-white'
              : 'bg-surface-container-lowest border border-outline-variant text-on-surface-variant hover:bg-surface-container'
          }`}
        >
          <span>{language === 'ar' ? 'فشلت' : 'Failed'}</span>
          <span className="text-outline font-code-num">({failedCount})</span>
        </button>

        <div className="h-4 w-px bg-outline-variant mx-0.5"></div>

        {/* Provider Dropdown Selector */}
        <select
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.target.value)}
          className="whitespace-nowrap px-2.5 py-1 rounded bg-surface-container-lowest border border-outline-variant text-on-surface text-label-sm cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="all">{language === 'ar' ? 'جميع المزودين' : 'All Providers'}</option>
          <option value="vodafone_cash">Vodafone Cash</option>
          <option value="instapay">InstaPay (IPN)</option>
          <option value="orange_cash">Orange Cash</option>
          <option value="etisalat_cash">e& Cash</option>
        </select>
      </div>

      {/* High-Density Financial Transaction Items */}
      <div className="flex flex-col gap-space-sm" role="list">
        {filteredList.length === 0 ? (
          <div className="p-10 text-center bg-surface-container-lowest border border-outline-variant rounded-2xl space-y-3">
            <div className="w-12 h-12 rounded-full bg-surface-container-low text-primary flex items-center justify-center mx-auto">
              <span className="material-symbols-outlined text-2xl">receipt_long</span>
            </div>
            <h3 className="text-title-md font-bold text-on-surface">
              {language === 'ar' ? 'لا توجد معاملات بعد' : 'No transactions recorded yet'}
            </h3>
            <p className="text-body-sm text-on-surface-variant max-w-sm mx-auto">
              {language === 'ar'
                ? 'ستظهر هنا كافة المعاملات المؤكدة وقيد المراجعة فور وصول الرسائل إلى أجهزتك المتصلة.'
                : 'Incoming payments will appear here in real-time as soon as SMS/notifications are captured and verified.'}
            </p>
          </div>
        ) : (
          filteredList.map((tx) => {
          const isSelected = activeDetailTx?.id === tx.id;
          const isConfirmed = tx.status === 'confirmed';
          const isReview = tx.status === 'review_required';
          const isFailed = tx.status === 'failed';

          return (
            <article
              key={tx.id}
              onClick={() => {
                onSelectTransaction(tx);
                setIsDetailDrawerOpen(true);
              }}
              className={`border rounded-lg p-space-sm shadow-none transition-colors cursor-pointer ${
                isReview
                  ? 'bg-surface-container-low border-primary-container/40 border-l-4 border-l-primary-container'
                  : isFailed
                  ? 'bg-surface-container-lowest border-outline-variant border-l-4 border-l-error'
                  : isSelected
                  ? 'bg-surface-container-lowest border-primary border-l-4 border-l-primary ring-1 ring-primary/20'
                  : 'bg-surface-container-lowest border-outline-variant hover:border-primary border-l-4 border-l-primary'
              }`}
              role="listitem"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-space-xs">
                  <span
                    className={`text-title-md font-bold font-code-num ${
                      isFailed ? 'text-outline line-through' : 'text-on-surface'
                    }`}
                  >
                    +{tx.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                  <span className="text-label-sm text-on-surface-variant">EGP</span>

                  {isConfirmed && (
                    <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-label-sm bg-surface-container text-primary font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mr-1"></span>
                      {language === 'ar' ? 'مؤكدة' : 'Confirmed'}
                    </span>
                  )}

                  {isReview && (
                    <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-label-sm bg-surface-container-high text-primary-container font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary-container mr-1 animate-pulse"></span>
                      {language === 'ar' ? 'مطلوب مراجعة' : 'Review Required'}
                    </span>
                  )}

                  {isFailed && (
                    <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-label-sm bg-error-container text-on-error-container font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-error mr-1"></span>
                      {language === 'ar' ? 'فشلت / ملغاة' : 'Failed / Cancelled'}
                    </span>
                  )}
                </div>

                <span className="text-label-sm font-code-num text-on-surface-variant">
                  {tx.timestamp}
                </span>
              </div>

              <div className="mt-1 flex items-center justify-between text-body-md text-on-surface">
                <div className="flex items-center gap-1 font-medium">
                  <span className="text-primary font-semibold">{tx.providerLabel}</span>
                  <span className="text-outline-variant">·</span>
                  <span className={isReview ? 'text-on-surface-variant italic' : ''}>
                    {tx.senderName}
                  </span>
                </div>
                <span className="text-code-num font-code-num text-label-md text-on-surface-variant">
                  {tx.senderPhone}
                </span>
              </div>

              {isReview && tx.reviewReason && (
                <p className="text-label-sm text-secondary mt-0.5">
                  {tx.reviewReason}
                </p>
              )}

              {/* Action buttons for Review items */}
              {isReview ? (
                <div className="mt-2 pt-1.5 border-t border-outline-variant flex items-center justify-between">
                  <div className="flex items-center gap-1 text-label-sm text-on-surface-variant font-code-num">
                    <span
                      className="material-symbols-outlined text-label-sm text-outline"
                      data-icon="point_of_sale"
                    >
                      point_of_sale
                    </span>
                    <span>{tx.deviceId}</span>
                  </div>

                  <div className="flex items-center gap-space-xs">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onConfirmTransaction(tx);
                      }}
                      className="h-7 px-2.5 rounded bg-primary text-on-primary text-label-sm font-semibold flex items-center gap-1 hover:bg-primary-container active:scale-95 transition-all"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-label-sm" data-icon="check">
                        check
                      </span>
                      <span>{language === 'ar' ? 'تأكيد ✓' : 'Confirm ✓'}</span>
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenReview(tx);
                      }}
                      className="h-7 px-2.5 rounded bg-surface-container-lowest border border-outline-variant text-on-surface text-label-sm font-semibold flex items-center gap-1 hover:bg-surface-container-high active:scale-95 transition-all"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-label-sm" data-icon="visibility">
                        visibility
                      </span>
                      <span>{language === 'ar' ? 'فحص' : 'Inspect'}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-1.5 pt-1.5 border-t border-outline-variant/60 flex items-center justify-between text-label-sm text-on-surface-variant">
                  <span className={`font-code-num ${isFailed ? 'text-error' : ''}`}>
                    {tx.trxId}
                  </span>
                  <div className="flex items-center gap-1">
                    <span
                      className="material-symbols-outlined text-label-sm text-outline"
                      data-icon="point_of_sale"
                    >
                      point_of_sale
                    </span>
                    <span className="font-code-num">{tx.deviceId}</span>
                  </div>
                </div>
              )}
            </article>
          );
        }))}
      </div>

      {/* Interactive Detail Drawer/Sheet Preview: Transaction Detail Drill-Down */}
      {activeDetailTx && (
        <aside
          id="detailDrawer"
          className={`fixed inset-x-0 bottom-12 z-40 max-w-lg mx-auto bg-surface-container-lowest border-t border-x border-outline-variant rounded-t-xl shadow-2xl transition-transform duration-300 transform ${
            isDetailDrawerOpen ? 'translate-y-0' : 'translate-y-[calc(100%-2.5rem)]'
          }`}
        >
          {/* Grab handle bar */}
          <div
            className="w-full flex justify-center pt-2 pb-1 cursor-pointer select-none"
            onClick={() => setIsDetailDrawerOpen(!isDetailDrawerOpen)}
            title="Click to toggle drawer"
          >
            <div className="w-12 h-1 bg-outline-variant rounded-full"></div>
          </div>

          {/* Sheet Header */}
          <div className="px-margin-mobile pb-space-sm pt-1 border-b border-outline-variant flex items-center justify-between">
            <div>
              <span className="text-label-sm text-outline uppercase tracking-wider">
                {language === 'ar' ? 'تفاصيل المعاملة والتدقيق' : 'Transaction Detail'}
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-headline-md font-bold text-on-surface font-code-num">
                  {activeDetailTx.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
                <span className="text-title-md font-medium text-on-surface-variant">
                  {activeDetailTx.currency}
                </span>
              </div>
            </div>

            <div className="flex flex-col items-end gap-1">
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-label-sm font-semibold ${
                  activeDetailTx.status === 'confirmed'
                    ? 'bg-surface-container text-primary'
                    : activeDetailTx.status === 'review_required'
                    ? 'bg-error-container text-on-error-container'
                    : 'bg-surface-container-high text-secondary'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full mr-1 ${
                    activeDetailTx.status === 'confirmed'
                      ? 'bg-primary'
                      : activeDetailTx.status === 'review_required'
                      ? 'bg-error'
                      : 'bg-secondary'
                  }`}
                ></span>
                {activeDetailTx.status === 'confirmed'
                  ? language === 'ar'
                    ? 'مؤكدة'
                    : 'Confirmed'
                  : activeDetailTx.status === 'review_required'
                  ? language === 'ar'
                    ? 'قيد المراجعة'
                    : 'Review Required'
                  : language === 'ar'
                  ? 'فشلت'
                  : 'Failed'}
              </span>
              <span className="text-label-sm text-secondary font-code-num">
                {activeDetailTx.trxId}
              </span>
            </div>
          </div>

          {/* Sheet Content Body: Audit Timeline */}
          <div className="p-margin-mobile space-y-3 max-h-56 overflow-y-auto">
            <div className="flex items-center justify-between text-body-md">
              <span className="text-on-surface-variant">
                {language === 'ar' ? 'مسار المزود:' : 'Provider Rail:'}
              </span>
              <span className="font-semibold text-primary">
                {activeDetailTx.providerLabel} (
                {activeDetailTx.provider === 'instapay'
                  ? 'Egypt IPN Network'
                  : activeDetailTx.provider === 'vodafone_cash'
                  ? 'Vodafone Egypt'
                  : activeDetailTx.provider === 'orange_cash'
                  ? 'Orange Egypt'
                  : 'e& Egypt'}
                )
              </span>
            </div>

            {/* Audit Timeline Steps */}
            <div className="relative pl-5 space-y-2 border-l-2 border-surface-container text-body-md">
              {activeDetailTx.auditTimeline && activeDetailTx.auditTimeline.length > 0 ? (
                activeDetailTx.auditTimeline.map((step, idx) => (
                  <div key={idx} className="relative">
                    <span className="absolute -left-[25px] top-1 w-2.5 h-2.5 rounded-full bg-primary ring-4 ring-surface-container-lowest"></span>
                    <p className="text-on-surface font-medium leading-tight">{step.title}</p>
                    <p className="text-label-sm text-outline font-code-num">
                      {step.time} · {step.detail}
                    </p>
                  </div>
                ))
              ) : (
                <>
                  <div className="relative">
                    <span className="absolute -left-[25px] top-1 w-2.5 h-2.5 rounded-full bg-primary ring-4 ring-surface-container-lowest"></span>
                    <p className="text-on-surface font-medium leading-tight">
                      Notification captured by {activeDetailTx.deviceId}
                    </p>
                    <p className="text-label-sm text-outline font-code-num">
                      {activeDetailTx.timestamp}:02 · Agent Latency 112ms
                    </p>
                  </div>
                  <div className="relative">
                    <span className="absolute -left-[25px] top-1 w-2.5 h-2.5 rounded-full bg-primary ring-4 ring-surface-container-lowest"></span>
                    <p className="text-on-surface font-medium leading-tight">
                      Parsed with {activeDetailTx.confidenceScore || 99}% confidence
                    </p>
                    <p className="text-label-sm text-outline font-code-num">
                      {activeDetailTx.timestamp}:04 · Regex Engine #4 ({activeDetailTx.senderName})
                    </p>
                  </div>
                  <div className="relative">
                    <span className="absolute -left-[25px] top-1 w-2.5 h-2.5 rounded-full bg-primary ring-4 ring-surface-container-lowest"></span>
                    <p className="text-on-surface font-medium leading-tight">
                      Telegram alert delivered
                    </p>
                    <p className="text-label-sm text-outline font-code-num">
                      {activeDetailTx.timestamp}:05 · Channel: #cairo-vault-bot
                    </p>
                  </div>
                  <div className="relative">
                    <span className="absolute -left-[25px] top-1 w-2.5 h-2.5 rounded-full bg-primary ring-4 ring-surface-container-lowest"></span>
                    <p className="text-on-surface font-medium leading-tight">
                      Webhook acknowledged (HTTP 200)
                    </p>
                    <p className="text-label-sm text-outline font-code-num">
                      {activeDetailTx.timestamp}:06 · Endpoint: /api/v1/ledger/ingest
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Sheet Footer Quick Action */}
          <div className="px-margin-mobile py-2 bg-surface-container-low border-t border-outline-variant flex items-center justify-between text-label-sm">
            <span className="text-on-surface-variant font-code-num">
              Signature: {activeDetailTx.signature || '7c88b9...e2a'}
            </span>
            <button
              onClick={() => setIsDetailDrawerOpen(false)}
              className="text-primary font-semibold hover:underline flex items-center gap-0.5"
              type="button"
            >
              <span>{language === 'ar' ? 'إغلاق اللوحة' : 'Dismiss Drawer'}</span>
              <span className="material-symbols-outlined text-label-sm" data-icon="close">
                close
              </span>
            </button>
          </div>
        </aside>
      )}
    </div>
  );
};
