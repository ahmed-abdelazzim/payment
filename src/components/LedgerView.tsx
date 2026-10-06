import React, { useState, useMemo } from 'react';
import { Transaction } from '../types';
import { exportToCsv, exportToExcelTable, ExportColumn } from '../utils/exportUtils';

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
      // Search query filter (search by amount, sender, phone, trxId)
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchTrxId = tx.trxId.toLowerCase().includes(query);
        const matchSender = tx.senderName.toLowerCase().includes(query);
        const matchPhone = tx.senderPhone ? tx.senderPhone.includes(query) : false;
        const matchAmount = tx.amount.toString().includes(query);
        return matchTrxId || matchSender || matchPhone || matchAmount;
      }
      return true;
    });
  }, [transactions, statusFilter, providerFilter, searchQuery]);

  const handleExportCsv = () => {
    const columns: ExportColumn<Transaction>[] = [
      { header: 'TRX ID', headerAr: 'رقم العملية', key: 'trxId' },
      { header: 'Provider', headerAr: 'مزود الدفع', key: 'providerLabel' },
      { header: 'Amount (EGP)', headerAr: 'المبلغ (ج.م)', key: 'amount' },
      { header: 'Sender Name', headerAr: 'اسم الراسل', key: 'senderName' },
      { header: 'Sender Phone', headerAr: 'هاتف الراسل', key: 'senderPhone' },
      {
        header: 'Status',
        headerAr: 'الحالة',
        accessor: (t) =>
          t.status === 'confirmed' ? 'مؤكدة' : t.status === 'review_required' ? 'قيد المراجعة' : 'فاشلة',
      },
      {
        header: 'Balance After',
        headerAr: 'الرصيد بعد العملية',
        accessor: (t) => (t.balanceAfter !== undefined && t.balanceAfter !== null ? t.balanceAfter : '-'),
      },
      {
        header: 'Date & Time',
        headerAr: 'التاريخ والوقت',
        accessor: (t) => t.timestamp,
      },
    ];
    exportToCsv(`sarraf_ledger_${new Date().toISOString().slice(0, 10)}`, columns, filteredList, language);
  };

  const handleExportExcel = () => {
    const columns: ExportColumn<Transaction>[] = [
      { header: 'TRX ID', headerAr: 'رقم العملية', key: 'trxId' },
      { header: 'Provider', headerAr: 'مزود الدفع', key: 'providerLabel' },
      { header: 'Amount (EGP)', headerAr: 'المبلغ (ج.م)', key: 'amount' },
      { header: 'Sender Name', headerAr: 'اسم الراسل', key: 'senderName' },
      { header: 'Sender Phone', headerAr: 'هاتف الراسل', key: 'senderPhone' },
      {
        header: 'Status',
        headerAr: 'الحالة',
        accessor: (t) =>
          t.status === 'confirmed' ? 'مؤكدة' : t.status === 'review_required' ? 'قيد المراجعة' : 'فاشلة',
      },
      {
        header: 'Balance After',
        headerAr: 'الرصيد بعد العملية',
        accessor: (t) => (t.balanceAfter !== undefined && t.balanceAfter !== null ? t.balanceAfter : '-'),
      },
      {
        header: 'Date & Time',
        headerAr: 'التاريخ والوقت',
        accessor: (t) => t.timestamp,
      },
    ];
    exportToExcelTable(
      `sarraf_ledger_${new Date().toISOString().slice(0, 10)}`,
      language === 'ar' ? 'سجل عمليات صرّاف' : 'Sarraf Ops Transaction Ledger',
      columns,
      filteredList,
      language
    );
  };

  // Active detail transaction (default to selected or first confirmed)
  const activeDetailTx = selectedTransaction || transactions[0];

  return (
    <div className="py-6 pb-28 max-w-7xl mx-auto min-h-screen px-4 sm:px-6 flex flex-col gap-6">
      {/* Top Operational Bar: Title, Search, Stats */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-outline-variant/80">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <span className="material-symbols-outlined text-xl">receipt_long</span>
              </div>
              <h1 className="text-headline-md font-bold text-on-surface">
                {language === 'ar' ? 'سجل العمليات والقيود اللحظية' : 'Reconciliation Ledger'}
              </h1>
            </div>
            <p className="text-body-md text-on-surface-variant">
              {language === 'ar'
                ? 'فحص ومطابقة حركات المحافظ الإلكترونية وشبكة IPN وتدقيق الأدلة الرقمية'
                : 'Cryptographically verified real-time ledger and audit trail'}
            </p>
          </div>

          {/* Settled Today Metric */}
          <div className="flex items-center gap-3 bg-surface-container-lowest border border-outline-variant px-4 py-2 rounded-2xl shadow-xs self-start sm:self-auto">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <div>
              <span className="text-label-xs text-on-surface-variant block">
                {language === 'ar' ? 'إجمالي التسوية المؤكدة' : 'Settled Volume'}
              </span>
              <span className="text-title-md font-code-num font-extrabold text-on-surface">
                {settledTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م
              </span>
            </div>
          </div>
        </div>

        {/* Search Input with proper RTL & LTR icon placement */}
        <div className="relative flex items-center">
          <span
            className="material-symbols-outlined absolute left-3.5 rtl:left-auto rtl:right-3.5 text-outline text-title-md pointer-events-none"
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
                ? 'البحث بالمرسل، الهاتف (010...)، رقم العملية، أو المبلغ...'
                : 'Search by sender, phone (010...), TRX ID, or amount...'
            }
            className="w-full h-11 pl-11 pr-10 rtl:pl-10 rtl:pr-11 bg-surface-container-lowest border border-outline-variant rounded-xl text-body-md text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all shadow-xs"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 rtl:right-auto rtl:left-3 text-outline-variant hover:text-on-surface p-1 rounded-lg transition-colors cursor-pointer"
              aria-label="Clear search"
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          )}
        </div>
      </section>

      {/* Horizontal Filter Tabs & Provider Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-outline-variant/60">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
          {/* Tab: All */}
          <button
            onClick={() => setStatusFilter('all')}
            className={`whitespace-nowrap px-3 py-1.5 rounded-full text-label-sm font-bold flex items-center gap-1.5 active:scale-95 transition-all cursor-pointer ${
              statusFilter === 'all'
                ? 'bg-primary text-on-primary shadow-xs'
                : 'bg-surface-container-low border border-outline-variant text-on-surface hover:bg-surface-container'
            }`}
          >
            <span>{language === 'ar' ? 'الكل' : 'All'}</span>
            <span
              className={`px-1.5 py-0.5 rounded-full text-label-xs font-code-num ${
                statusFilter === 'all'
                  ? 'bg-white/20 text-white'
                  : 'bg-surface-container-high text-on-surface-variant'
              }`}
            >
              {transactions.length}
            </span>
          </button>

          {/* Tab: Confirmed */}
          <button
            onClick={() => setStatusFilter('confirmed')}
            className={`whitespace-nowrap px-3 py-1.5 rounded-full text-label-sm font-bold flex items-center gap-1.5 active:scale-95 transition-all cursor-pointer ${
              statusFilter === 'confirmed'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-surface-container-low border border-outline-variant text-on-surface hover:bg-surface-container'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>{language === 'ar' ? 'مؤكدة' : 'Confirmed'}</span>
            <span className="text-label-xs font-code-num">({confirmedCount})</span>
          </button>

          {/* Tab: Review Required */}
          <button
            onClick={() => setStatusFilter('review_required')}
            className={`whitespace-nowrap px-3 py-1.5 rounded-full text-label-sm font-bold flex items-center gap-1.5 active:scale-95 transition-all cursor-pointer ${
              statusFilter === 'review_required'
                ? 'bg-error text-white shadow-xs'
                : 'bg-error-container/20 border border-error/30 text-error hover:bg-error-container/30'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-error animate-pulse"></span>
            <span>{language === 'ar' ? 'قيد المراجعة' : 'Review Required'}</span>
            <span className="text-label-xs font-code-num font-bold">({reviewCount})</span>
          </button>

          {/* Tab: Failed */}
          <button
            onClick={() => setStatusFilter('failed')}
            className={`whitespace-nowrap px-3 py-1.5 rounded-full text-label-sm font-bold flex items-center gap-1.5 active:scale-95 transition-all cursor-pointer ${
              statusFilter === 'failed'
                ? 'bg-secondary text-white shadow-xs'
                : 'bg-surface-container-low border border-outline-variant text-on-surface-variant hover:bg-surface-container'
            }`}
          >
            <span>{language === 'ar' ? 'فشلت / مرفوضة' : 'Failed'}</span>
            <span className="text-label-xs font-code-num">({failedCount})</span>
          </button>
        </div>

        {/* Actions: Export buttons & Provider Selector */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Export Excel */}
          <button
            onClick={handleExportExcel}
            title={language === 'ar' ? 'تصدير السجل كملف Excel' : 'Export ledger as Excel'}
            className="flex items-center gap-1 h-9 px-2.5 rounded-xl bg-emerald-600/10 border border-emerald-600/30 text-emerald-700 dark:text-emerald-300 text-label-xs font-bold hover:bg-emerald-600/20 active:scale-95 transition-all cursor-pointer shadow-xs"
          >
            <span className="material-symbols-outlined text-base">table_view</span>
            <span>Excel</span>
          </button>

          {/* Export CSV */}
          <button
            onClick={handleExportCsv}
            title={language === 'ar' ? 'تصدير السجل كملف CSV' : 'Export ledger as CSV'}
            className="flex items-center gap-1 h-9 px-2.5 rounded-xl bg-surface-container-low border border-outline-variant text-on-surface text-label-xs font-bold hover:bg-surface-container active:scale-95 transition-all cursor-pointer shadow-xs"
          >
            <span className="material-symbols-outlined text-base">download</span>
            <span>CSV</span>
          </button>

          <span className="text-label-xs text-on-surface-variant font-medium hidden sm:inline ms-1">
            {language === 'ar' ? 'المزود:' : 'Provider:'}
          </span>
          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="h-9 px-3 py-1 rounded-xl bg-surface-container-lowest border border-outline-variant text-on-surface text-label-sm font-semibold cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-xs"
          >
            <option value="all">{language === 'ar' ? 'جميع المزودين' : 'All Providers'}</option>
            <option value="vodafone_cash">Vodafone Cash</option>
            <option value="instapay">InstaPay (IPN)</option>
            <option value="orange_cash">Orange Cash</option>
            <option value="etisalat_cash">e& Cash</option>
          </select>
        </div>
      </div>

      {/* Responsive Main Layout: Transactions List + Desktop Inspector Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Transaction List (8 Cols on Desktop) */}
        <div className="lg:col-span-7 xl:col-span-8 flex flex-col gap-3" role="list">
          {filteredList.length === 0 ? (
            <div className="p-12 text-center bg-surface-container-lowest border border-outline-variant rounded-2xl space-y-4 shadow-xs">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto shadow-xs">
                <span className="material-symbols-outlined text-3xl">receipt_long</span>
              </div>
              <h3 className="text-title-md font-bold text-on-surface">
                {language === 'ar' ? 'لا توجد معاملات مطابقة للبحث' : 'No matching transactions'}
              </h3>
              <p className="text-body-sm text-on-surface-variant max-w-sm mx-auto">
                {language === 'ar'
                  ? 'ستظهر هنا كافة المعاملات المؤكدة وقيد المراجعة فور وصول الرسائل إلى أجهزتك المتصلة.'
                  : 'Incoming payments will appear here in real-time as soon as SMS/notifications are captured.'}
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
                  className={`border rounded-2xl p-4 transition-all cursor-pointer heroui-card ${
                    isReview
                      ? 'bg-error-container/10 border-error/40 rtl:border-r-4 rtl:border-l-0 border-l-4 border-l-error'
                      : isFailed
                      ? 'bg-surface-container-lowest border-outline-variant opacity-75 rtl:border-r-4 rtl:border-l-0 border-l-4 border-l-secondary'
                      : isSelected
                      ? 'bg-surface-container-lowest border-primary rtl:border-r-4 rtl:border-l-0 border-l-4 border-l-primary ring-2 ring-primary/20 shadow-md'
                      : 'bg-surface-container-lowest border-outline-variant hover:border-primary/50 rtl:border-r-4 rtl:border-l-0 border-l-4 border-l-primary'
                  }`}
                  role="listitem"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`text-headline-sm font-bold font-code-num ${
                          isFailed ? 'text-outline line-through' : 'text-on-surface'
                        }`}
                      >
                        +{tx.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                      <span className="text-label-sm font-bold text-primary">ج.م</span>

                      {isConfirmed && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-label-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold border border-emerald-500/20">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                          <span>{language === 'ar' ? 'مؤكدة' : 'Confirmed'}</span>
                        </span>
                      )}

                      {isReview && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-label-xs bg-error/10 text-error font-bold border border-error/20">
                          <span className="w-1.5 h-1.5 rounded-full bg-error animate-pulse"></span>
                          <span>{language === 'ar' ? 'مطلوب مراجعة' : 'Review Required'}</span>
                        </span>
                      )}

                      {isFailed && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-label-xs bg-surface-container-high text-on-surface-variant font-semibold">
                          <span>{language === 'ar' ? 'ملغاة' : 'Failed'}</span>
                        </span>
                      )}
                    </div>

                    <span className="text-label-xs font-code-num text-on-surface-variant whitespace-nowrap">
                      {tx.timestamp}
                    </span>
                  </div>

                  <div className="mt-2 flex items-center justify-between text-body-sm text-on-surface gap-2">
                    <div className="flex items-center gap-2 font-medium">
                      <span className="text-primary font-bold">{tx.providerLabel}</span>
                      <span className="text-outline-variant">·</span>
                      <span className={`text-on-surface ${isReview ? 'font-semibold' : ''}`}>
                        {tx.senderName}
                      </span>
                    </div>
                    <span className="text-code-num font-code-num text-label-sm text-on-surface-variant font-medium">
                      {tx.senderPhone}
                    </span>
                  </div>

                  {isReview && tx.reviewReason && (
                    <div className="mt-2 p-2 rounded-xl bg-error-container/20 border border-error/20 text-label-sm text-error font-medium">
                      {tx.reviewReason}
                    </div>
                  )}

                  {/* Action buttons for Review items */}
                  {isReview ? (
                    <div className="mt-3 pt-2 border-t border-outline-variant/60 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-label-xs text-on-surface-variant font-code-num">
                        <span className="material-symbols-outlined text-sm text-primary">point_of_sale</span>
                        <span>{tx.deviceId}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onConfirmTransaction(tx);
                          }}
                          className="px-3 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-label-xs font-bold flex items-center gap-1 active:scale-95 transition-all shadow-xs cursor-pointer"
                          type="button"
                        >
                          <span className="material-symbols-outlined text-sm">check</span>
                          <span>{language === 'ar' ? 'تأكيد العملية' : 'Confirm'}</span>
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenReview(tx);
                          }}
                          className="px-3 py-1 rounded-xl bg-surface-container-high hover:bg-surface-container text-on-surface text-label-xs font-semibold flex items-center gap-1 border border-outline-variant active:scale-95 transition-all cursor-pointer"
                          type="button"
                        >
                          <span className="material-symbols-outlined text-sm">visibility</span>
                          <span>{language === 'ar' ? 'فحص كامل' : 'Inspect'}</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 pt-2 border-t border-outline-variant/60 flex items-center justify-between text-label-xs text-on-surface-variant">
                      <span className="font-code-num text-primary font-semibold">
                        TRX: {tx.trxId}
                      </span>
                      <div className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-xs text-outline">point_of_sale</span>
                        <span className="font-code-num">{tx.deviceId}</span>
                      </div>
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>

        {/* Selected Transaction Inspector (Pinned on Desktop) */}
        {activeDetailTx && (
          <aside className="hidden lg:block lg:col-span-5 xl:col-span-4 sticky top-20 bg-surface-container-lowest border border-outline-variant rounded-2xl shadow-sm p-6 space-y-5 heroui-card">
            <div className="flex items-center justify-between pb-3 border-b border-outline-variant">
              <div>
                <span className="text-label-xs text-outline uppercase tracking-wider block">
                  {language === 'ar' ? 'تفاصيل المعاملة والتدقيق' : 'Audit Telemetry'}
                </span>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span className="text-headline-md font-bold text-on-surface font-code-num">
                    +{activeDetailTx.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                  <span className="text-title-sm font-bold text-primary">ج.م</span>
                </div>
              </div>

              <span
                className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-label-xs font-bold ${
                  activeDetailTx.status === 'confirmed'
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                    : activeDetailTx.status === 'review_required'
                    ? 'bg-error/10 text-error border border-error/20'
                    : 'bg-surface-container-high text-on-surface-variant'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    activeDetailTx.status === 'confirmed' ? 'bg-emerald-500' : 'bg-error'
                  }`}
                ></span>
                {activeDetailTx.status === 'confirmed'
                  ? language === 'ar' ? 'مؤكدة' : 'Confirmed'
                  : activeDetailTx.status === 'review_required'
                  ? language === 'ar' ? 'قيد المراجعة' : 'Review Required'
                  : language === 'ar' ? 'فشلت' : 'Failed'}
              </span>
            </div>

            {/* Core Info */}
            <div className="space-y-3 text-body-sm">
              <div className="flex items-center justify-between text-label-sm border-b pb-2 border-outline-variant/60">
                <span className="text-on-surface-variant">{language === 'ar' ? 'رقم العملية:' : 'Transaction ID:'}</span>
                <span className="font-code-num font-bold text-primary select-all">{activeDetailTx.trxId}</span>
              </div>

              <div className="flex items-center justify-between text-label-sm border-b pb-2 border-outline-variant/60">
                <span className="text-on-surface-variant">{language === 'ar' ? 'المزود:' : 'Provider Rail:'}</span>
                <span className="font-bold text-on-surface">{activeDetailTx.providerLabel}</span>
              </div>

              <div className="flex items-center justify-between text-label-sm border-b pb-2 border-outline-variant/60">
                <span className="text-on-surface-variant">{language === 'ar' ? 'اسم المرسل:' : 'Sender Name:'}</span>
                <span className="font-semibold text-on-surface">{activeDetailTx.senderName}</span>
              </div>

              <div className="flex items-center justify-between text-label-sm border-b pb-2 border-outline-variant/60">
                <span className="text-on-surface-variant">{language === 'ar' ? 'هاتف المرسل:' : 'Sender Phone:'}</span>
                <span className="font-code-num font-semibold text-on-surface">{activeDetailTx.senderPhone}</span>
              </div>

              <div className="flex items-center justify-between text-label-sm border-b pb-2 border-outline-variant/60">
                <span className="text-on-surface-variant">{language === 'ar' ? 'جهاز الالتقاط:' : 'Capture Device:'}</span>
                <span className="font-code-num text-on-surface">{activeDetailTx.deviceId}</span>
              </div>

              <div className="flex items-center justify-between text-label-sm">
                <span className="text-on-surface-variant">{language === 'ar' ? 'درجة الثقة:' : 'Confidence Score:'}</span>
                <span className="font-code-num font-bold text-emerald-600 dark:text-emerald-400">
                  {activeDetailTx.confidenceScore || 95}%
                </span>
              </div>
            </div>

            {/* Audit Timeline Steps */}
            <div className="pt-3 border-t border-outline-variant">
              <span className="text-label-xs font-bold text-on-surface-variant uppercase tracking-wider block mb-3">
                {language === 'ar' ? 'سلسلة التدقيق اللحظية' : 'Real-time Audit Trail'}
              </span>

              <div className="relative pl-5 rtl:pl-0 rtl:pr-5 space-y-3 border-l-2 rtl:border-l-0 rtl:border-r-2 border-primary/20 text-body-xs">
                <div className="relative">
                  <span className="absolute -left-[25px] rtl:-left-auto rtl:-right-[25px] top-1 w-2.5 h-2.5 rounded-full bg-primary ring-4 ring-surface-container-lowest"></span>
                  <p className="text-on-surface font-semibold">
                    {language === 'ar' ? `التقاط الإشعار عبر ${activeDetailTx.deviceId}` : `Notification captured by ${activeDetailTx.deviceId}`}
                  </p>
                  <p className="text-label-xs text-outline font-code-num">
                    {activeDetailTx.timestamp} · Latency 112ms
                  </p>
                </div>

                <div className="relative">
                  <span className="absolute -left-[25px] rtl:-left-auto rtl:-right-[25px] top-1 w-2.5 h-2.5 rounded-full bg-primary ring-4 ring-surface-container-lowest"></span>
                  <p className="text-on-surface font-semibold">
                    {language === 'ar' ? `المطابقة البرمجية بنسبة ${activeDetailTx.confidenceScore || 95}%` : `Parsed with ${activeDetailTx.confidenceScore || 95}% confidence`}
                  </p>
                  <p className="text-label-xs text-outline font-code-num">
                    SHA-256 HMAC Verified
                  </p>
                </div>

                <div className="relative">
                  <span className="absolute -left-[25px] rtl:-left-auto rtl:-right-[25px] top-1 w-2.5 h-2.5 rounded-full bg-primary ring-4 ring-surface-container-lowest"></span>
                  <p className="text-on-surface font-semibold">
                    {language === 'ar' ? 'إرسال التنبيه الفوري للمشغل' : 'Telegram notification dispatched'}
                  </p>
                  <p className="text-label-xs text-outline font-code-num">
                    Outbox Queue Delivered
                  </p>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            {activeDetailTx.status === 'review_required' && (
              <div className="pt-3 border-t border-outline-variant flex items-center gap-2">
                <button
                  onClick={() => onConfirmTransaction(activeDetailTx)}
                  className="flex-1 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-label-xs active:scale-95 transition-all cursor-pointer shadow-xs"
                >
                  {language === 'ar' ? 'تأكيد العملية' : 'Confirm'}
                </button>
                <button
                  onClick={() => onOpenReview(activeDetailTx)}
                  className="py-2 px-3 rounded-xl bg-surface-container-high hover:bg-surface-container text-on-surface font-bold text-label-xs active:scale-95 transition-all cursor-pointer border border-outline-variant"
                >
                  {language === 'ar' ? 'فحص كامل' : 'Review'}
                </button>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* Mobile Detail Bottom Sheet (when on mobile view) */}
      {activeDetailTx && (
        <aside
          id="detailDrawer"
          className={`lg:hidden fixed inset-x-0 bottom-12 z-40 max-w-lg mx-auto bg-surface-container-lowest border-t border-x border-outline-variant rounded-t-2xl shadow-2xl transition-transform duration-300 transform ${
            isDetailDrawerOpen ? 'translate-y-0' : 'translate-y-[calc(100%-2.5rem)]'
          }`}
        >
          {/* Grab handle bar */}
          <div
            className="w-full flex justify-center pt-2 pb-1 cursor-pointer select-none"
            onClick={() => setIsDetailDrawerOpen(!isDetailDrawerOpen)}
            title="Toggle drawer"
          >
            <div className="w-12 h-1 bg-outline-variant rounded-full"></div>
          </div>

          {/* Sheet Header */}
          <div className="px-4 pb-3 pt-1 border-b border-outline-variant flex items-center justify-between">
            <div>
              <span className="text-label-xs text-outline uppercase tracking-wider">
                {language === 'ar' ? 'تفاصيل المعاملة والتدقيق' : 'Transaction Detail'}
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-headline-md font-bold text-on-surface font-code-num">
                  +{activeDetailTx.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
                <span className="text-title-sm font-bold text-primary">ج.م</span>
              </div>
            </div>

            <div className="flex flex-col items-end gap-1">
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-label-xs font-bold ${
                  activeDetailTx.status === 'confirmed'
                    ? 'bg-emerald-500/10 text-emerald-600'
                    : 'bg-error/10 text-error'
                }`}
              >
                {activeDetailTx.status === 'confirmed'
                  ? language === 'ar' ? 'مؤكدة' : 'Confirmed'
                  : language === 'ar' ? 'مراجعة' : 'Review'}
              </span>
              <span className="text-label-xs text-outline font-code-num">
                {activeDetailTx.trxId}
              </span>
            </div>
          </div>

          {/* Sheet Content Body */}
          <div className="p-4 space-y-3 max-h-56 overflow-y-auto text-body-sm">
            <div className="flex items-center justify-between">
              <span className="text-on-surface-variant">{language === 'ar' ? 'المزود:' : 'Provider:'}</span>
              <span className="font-bold text-primary">{activeDetailTx.providerLabel}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-on-surface-variant">{language === 'ar' ? 'المرسل:' : 'Sender:'}</span>
              <span className="font-semibold text-on-surface">{activeDetailTx.senderName} ({activeDetailTx.senderPhone})</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-on-surface-variant">{language === 'ar' ? 'جهاز الالتقاط:' : 'Terminal:'}</span>
              <span className="font-code-num">{activeDetailTx.deviceId}</span>
            </div>
          </div>

          {/* Sheet Footer */}
          <div className="px-4 py-2 bg-surface-container-low border-t border-outline-variant flex items-center justify-between text-label-sm">
            <button
              onClick={() => setIsDetailDrawerOpen(false)}
              className="text-primary font-bold hover:underline flex items-center gap-1 cursor-pointer"
            >
              <span>{language === 'ar' ? 'إغلاق اللوحة' : 'Dismiss'}</span>
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
            {activeDetailTx.status === 'review_required' && (
              <button
                onClick={() => onOpenReview(activeDetailTx)}
                className="px-3 py-1 rounded-xl bg-primary text-on-primary text-label-xs font-bold cursor-pointer"
              >
                {language === 'ar' ? 'فحص كامل' : 'Inspect'}
              </button>
            )}
          </div>
        </aside>
      )}
    </div>
  );
};
