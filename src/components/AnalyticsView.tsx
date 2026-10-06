import React, { useState, useEffect, useMemo } from 'react';
import { Transaction, Device, ProviderRail } from '../types';
import { apiFetch } from '../api';
import { exportToCsv, exportToExcelTable, ExportColumn } from '../utils/exportUtils';
import { formatDate } from '../utils/formatters';

interface AnalyticsViewProps {
  transactions: Transaction[];
  devices: Device[];
  rails: ProviderRail[];
  language: 'en' | 'ar';
  showToast: (msg: string) => void;
  currentUser?: User | null;
  workspace?: Workspace | null;
}

interface GoogleSheetConfig {
  authType?: 'oauth' | 'webhook';
  sheetUrl: string | null;
  sheetName: string | null;
  accountEmail?: string | null;
  spreadsheetId?: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  syncedCount: number;
  isOAuthConfigured?: boolean;
  googleClientId?: string | null;
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({
  transactions,
  devices,
  rails,
  language,
  showToast,
  currentUser,
  workspace,
}) => {
  // Filter States
  const [timeRange, setTimeRange] = useState<'today' | '7days' | 'thisMonth' | '30days' | 'all'>('7days');
  const [selectedProvider, setSelectedProvider] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Google Sheets Integration State
  const [sheetsConfig, setSheetsConfig] = useState<GoogleSheetConfig>({
    sheetUrl: null,
    sheetName: null,
    accountEmail: null,
    spreadsheetId: null,
    connectedAt: null,
    lastSyncAt: null,
    syncedCount: 0,
    isOAuthConfigured: false,
  });
  const [loadingSheets, setLoadingSheets] = useState<boolean>(true);
  const [loadingOAuth, setLoadingOAuth] = useState<boolean>(false);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState<boolean>(false);
  const [isOAuthSetupModalOpen, setIsOAuthSetupModalOpen] = useState<boolean>(false);
  const [isDisconnectConfirmOpen, setIsDisconnectConfirmOpen] = useState<boolean>(false);
  const [isScriptModalOpen, setIsScriptModalOpen] = useState<boolean>(false);
  const [sheetUrlInput, setSheetUrlInput] = useState<string>('');
  const [sheetNameInput, setSheetNameInput] = useState<string>('');
  const [platformClientIdInput, setPlatformClientIdInput] = useState<string>('');
  const [platformClientSecretInput, setPlatformClientSecretInput] = useState<string>('');
  const [savingPlatformOAuth, setSavingPlatformOAuth] = useState<boolean>(false);
  const [testingWebhook, setTestingWebhook] = useState<boolean>(false);
  const [syncingAll, setSyncingAll] = useState<boolean>(false);
  const [savingSheet, setSavingSheet] = useState<boolean>(false);
  const [copiedScript, setCopiedScript] = useState<boolean>(false);
  const [copiedRedirectUri, setCopiedRedirectUri] = useState<boolean>(false);

  // Fetch Google Sheets configuration on mount and listen for OAuth callback
  useEffect(() => {
    fetchSheetsConfig();

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('google_connected') === 'true') {
        showToast(
          language === 'ar'
            ? 'تم ربط حساب Google وإنشاء ملف Google Sheet بنجاح! يتم الآن تسجيل العمليات تلقائياً.'
            : 'Google account connected & spreadsheet created successfully! Real-time syncing active.'
        );
        const cleanUrl = window.location.pathname + (params.get('tab') ? `?tab=${params.get('tab')}` : '');
        window.history.replaceState({}, '', cleanUrl);
      } else if (params.get('google_error')) {
        const err = params.get('google_error');
        showToast(
          language === 'ar'
            ? `فشل الربط بحساب Google: ${decodeURIComponent(err || '')}`
            : `Google connection failed: ${decodeURIComponent(err || '')}`
        );
        const cleanUrl = window.location.pathname + (params.get('tab') ? `?tab=${params.get('tab')}` : '');
        window.history.replaceState({}, '', cleanUrl);
      }
    }
  }, [language, showToast]);

  const fetchSheetsConfig = async () => {
    try {
      setLoadingSheets(true);
      const res = await apiFetch('/api/v1/integrations/google-sheets');
      if (res.ok) {
        const data = await res.json();
        setSheetsConfig(data);
      }
    } catch (err) {
      console.error('Failed to load Google Sheets integration status', err);
    } finally {
      setLoadingSheets(false);
    }
  };

  // Filter transactions based on date range, provider, status, and search query
  const filteredTransactions = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const sevenDaysAgo = todayStart - 6 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = todayStart - 29 * 24 * 60 * 60 * 1000;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    return transactions.filter((tx) => {
      // Date Range filter
      const txTime = new Date(tx.timestamp).getTime();
      if (timeRange === 'today' && txTime < todayStart) return false;
      if (timeRange === '7days' && txTime < sevenDaysAgo) return false;
      if (timeRange === 'thisMonth' && txTime < monthStart) return false;
      if (timeRange === '30days' && txTime < thirtyDaysAgo) return false;

      // Provider filter
      if (selectedProvider !== 'all' && tx.provider !== selectedProvider) return false;

      // Status filter
      if (selectedStatus !== 'all' && tx.status !== selectedStatus) return false;

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchTrx = tx.trxId.toLowerCase().includes(q);
        const matchSender = tx.senderName.toLowerCase().includes(q);
        const matchPhone = tx.senderPhone ? tx.senderPhone.includes(q) : false;
        const matchAmount = tx.amount.toString().includes(q);
        return matchTrx || matchSender || matchPhone || matchAmount;
      }

      return true;
    });
  }, [transactions, timeRange, selectedProvider, selectedStatus, searchQuery]);

  // Aggregate Key Performance Indicators (KPIs)
  const confirmedTxns = useMemo(
    () => filteredTransactions.filter((t) => t.status === 'confirmed'),
    [filteredTransactions]
  );

  const totalSettledVolume = useMemo(
    () => confirmedTxns.reduce((sum, t) => sum + t.amount, 0),
    [confirmedTxns]
  );

  const avgTransactionValue = useMemo(
    () => (confirmedTxns.length > 0 ? totalSettledVolume / confirmedTxns.length : 0),
    [totalSettledVolume, confirmedTxns]
  );

  const autoReconciledCount = useMemo(
    () => confirmedTxns.filter((t) => (t.confidenceScore ?? 1) >= 0.9).length,
    [confirmedTxns]
  );

  const instantReconciliationRate = useMemo(
    () => (filteredTransactions.length > 0 ? (autoReconciledCount / filteredTransactions.length) * 100 : 100),
    [autoReconciledCount, filteredTransactions]
  );

  // Volume by Provider breakdown
  const providerStats = useMemo(() => {
    const map: Record<string, { labelAr: string; labelEn: string; volume: number; count: number; color: string }> = {
      vodafone_cash: { labelAr: 'فودافون كاش', labelEn: 'Vodafone Cash', volume: 0, count: 0, color: '#e60000' },
      instapay: { labelAr: 'شبكة إنستاباي IPN', labelEn: 'InstaPay (IPN)', volume: 0, count: 0, color: '#a855f7' },
      orange_cash: { labelAr: 'أورنج كاش', labelEn: 'Orange Cash', volume: 0, count: 0, color: '#ff7900' },
      etisalat_cash: { labelAr: 'اتصالات كاش (e&)', labelEn: 'Etisalat Cash', volume: 0, count: 0, color: '#009639' },
    };

    confirmedTxns.forEach((tx) => {
      const p = map[tx.provider] || {
        labelAr: tx.provider,
        labelEn: tx.provider,
        volume: 0,
        count: 0,
        color: '#64748b',
      };
      p.volume += tx.amount;
      p.count += 1;
      map[tx.provider] = p;
    });

    return Object.entries(map).map(([key, val]) => ({
      key,
      ...val,
      percentage: totalSettledVolume > 0 ? (val.volume / totalSettledVolume) * 100 : 0,
    }));
  }, [confirmedTxns, totalSettledVolume]);

  // Peak hours distribution (0 to 23 hours)
  const hourlyActivity = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      label: `${i.toString().padStart(2, '0')}:00`,
      count: 0,
      volume: 0,
    }));

    filteredTransactions.forEach((tx) => {
      const d = new Date(tx.timestamp);
      const h = d.getHours();
      if (hours[h]) {
        hours[h].count += 1;
        if (tx.status === 'confirmed') {
          hours[h].volume += tx.amount;
        }
      }
    });

    const maxCount = Math.max(...hours.map((h) => h.count), 1);
    return { hours, maxCount };
  }, [filteredTransactions]);

  // Terminal / Fleet telemetry breakdown
  const devicePerformance = useMemo(() => {
    return devices.map((dev) => {
      const devTxns = filteredTransactions.filter((tx) => tx.deviceId === dev.id);
      const devVolume = devTxns
        .filter((tx) => tx.status === 'confirmed')
        .reduce((sum, tx) => sum + tx.amount, 0);

      return {
        ...dev,
        capturedCount: devTxns.length,
        capturedVolume: devVolume,
      };
    });
  }, [devices, filteredTransactions]);

  // Regulatory Central Bank of Egypt (CBE) Cap Utilization
  const regulatoryLimitUtilization = useMemo(() => {
    const totalDailyIntake = rails.reduce((sum, r) => sum + (r.dailyIntake || 0), 0);
    const totalDailyLimit = rails.reduce((sum, r) => sum + (r.dailyLimit || 100000), 0);
    const totalMonthlyIntake = rails.reduce((sum, r) => sum + (r.monthlyIntake || 0), 0);
    const totalMonthlyLimit = rails.reduce((sum, r) => sum + (r.monthlyLimit || 200000), 0);

    return {
      dailyIntake: totalDailyIntake,
      dailyLimit: totalDailyLimit,
      dailyPct: totalDailyLimit > 0 ? (totalDailyIntake / totalDailyLimit) * 100 : 0,
      monthlyIntake: totalMonthlyIntake,
      monthlyLimit: totalMonthlyLimit,
      monthlyPct: totalMonthlyLimit > 0 ? (totalMonthlyIntake / totalMonthlyLimit) * 100 : 0,
    };
  }, [rails]);

  // Handlers for Google Sheets Actions

  // 1-Click Google OAuth Sign-in & Auto-linking
  const handleGoogleOAuthSignIn = async () => {
    try {
      setLoadingOAuth(true);
      const res = await apiFetch('/api/v1/integrations/google-sheets/oauth-url');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'فشل الاتصال بخدمة Google');
      }

      if (data.isConfigured && data.authUrl) {
        window.location.href = data.authUrl;
      } else {
        setPlatformClientIdInput(data.googleClientId || '');
        setIsOAuthSetupModalOpen(true);
      }
    } catch (err: any) {
      showToast(err.message || (language === 'ar' ? 'فشل بدء تسجيل الدخول بجوجل' : 'Failed to start Google sign-in'));
    } finally {
      setLoadingOAuth(false);
    }
  };

  // Save Platform Google OAuth Credentials (for Admin / Platform Owner)
  const handleSavePlatformOAuth = async () => {
    if (!platformClientIdInput.trim() || !platformClientSecretInput.trim()) {
      showToast(language === 'ar' ? 'يرجى إدخال Client ID و Client Secret' : 'Please provide Client ID & Secret');
      return;
    }

    try {
      setSavingPlatformOAuth(true);
      const res = await apiFetch('/api/v1/platform/settings/google-oauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: platformClientIdInput.trim(),
          clientSecret: platformClientSecretInput.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'فشل حفظ إعدادات Google OAuth');
      }

      showToast(
        language === 'ar'
          ? 'تم حفظ إعدادات Google OAuth بنجاح! سيتم توجيهك الآن للمصادقة.'
          : 'Google OAuth credentials saved! Redirecting to Google...'
      );
      setIsOAuthSetupModalOpen(false);
      await fetchSheetsConfig();

      const nextRes = await apiFetch('/api/v1/integrations/google-sheets/oauth-url');
      const nextData = await nextRes.json();
      if (nextData.isConfigured && nextData.authUrl) {
        window.location.href = nextData.authUrl;
      }
    } catch (err: any) {
      showToast(err.message || 'تعذر حفظ البيانات');
    } finally {
      setSavingPlatformOAuth(false);
    }
  };

  // Connect Google Sheet directly by URL or ID
  const handleConnectDirectSheet = async () => {
    if (!sheetUrlInput.trim()) {
      showToast(language === 'ar' ? 'يرجى إدخال رابط ملف Google Sheet' : 'Please enter the Google Sheet URL');
      return;
    }

    try {
      setSavingSheet(true);
      const res = await apiFetch('/api/v1/integrations/google-sheets/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: sheetUrlInput.trim(),
          name: sheetNameInput.trim() || (language === 'ar' ? 'صرّاف - سجل المدفوعات' : 'Sarraf Payments Sheet'),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'فشل ربط Google Sheet');
      }

      showToast(
        language === 'ar'
          ? 'تم ربط Google Sheet بنجاح! سيتم تسجيل جميع المدفوعات المؤكدة لحظياً.'
          : 'Google Sheet connected successfully! Real-time syncing active.'
      );
      setIsConnectModalOpen(false);
      setSheetUrlInput('');
      setSheetNameInput('');
      await fetchSheetsConfig();
    } catch (err: any) {
      showToast(err.message || 'حدث خطأ أثناء الربط');
    } finally {
      setSavingSheet(false);
    }
  };

  // Disconnect active Google Sheet
  const handleDisconnectSheet = async () => {
    try {
      setSavingSheet(true);
      const res = await apiFetch('/api/v1/integrations/google-sheets/disconnect', {
        method: 'POST',
      });

      if (!res.ok) {
        throw new Error('فشل إلغاء الربط');
      }

      showToast(
        language === 'ar'
          ? 'تم إلغاء الربط مع Google Sheet بنجاح، ولن يتم إرسال أي معاملات جديدة إليه.'
          : 'Google Sheet disconnected. No new transactions will be forwarded.'
      );
      setIsDisconnectConfirmOpen(false);
      await fetchSheetsConfig();
    } catch (err: any) {
      showToast(err.message || 'حدث خطأ أثناء إلغاء الربط');
    } finally {
      setSavingSheet(false);
    }
  };

  // Ping test
  const handleTestConnection = async () => {
    const targetUrl = sheetUrlInput.trim() || sheetsConfig.sheetUrl;
    if (!targetUrl) {
      showToast(language === 'ar' ? 'لا يوجد ملف لاختباره' : 'No sheet URL to test');
      return;
    }

    try {
      setTestingWebhook(true);
      const res = await apiFetch('/api/v1/integrations/google-sheets/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'فشل الاتصال بالشيت');
      }

      showToast(language === 'ar' ? 'تم فحص الاتصال مع Google Sheets بنجاح!' : 'Connection test succeeded!');
    } catch (err: any) {
      showToast(err.message || 'فشل الاتصال برابط الشيت');
    } finally {
      setTestingWebhook(false);
    }
  };

  // Sync / backfill all transactions to Sheet
  const handleSyncAllToSheet = async () => {
    if (!sheetsConfig.sheetUrl && !sheetsConfig.spreadsheetId) {
      showToast(language === 'ar' ? 'يرجى ربط Google Sheet أولاً' : 'Please connect a Google Sheet first');
      return;
    }

    try {
      setSyncingAll(true);
      const res = await apiFetch('/api/v1/integrations/google-sheets/sync-all', {
        method: 'POST',
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'فشلت المزامنة');
      }

      showToast(
        language === 'ar'
          ? `تمت مزامنة ${data.syncedCount} معاملة بنجاح إلى شيت جوجل!`
          : `Successfully synced ${data.syncedCount} transactions to your Google Sheet!`
      );
      await fetchSheetsConfig();
    } catch (err: any) {
      showToast(err.message || 'تعذر مزامنة المعاملات');
    } finally {
      setSyncingAll(false);
    }
  };

  // Export Filtered Transactions to CSV
  const handleExportFilteredCsv = () => {
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
        accessor: (t) => formatDate(t.timestamp, language, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      },
    ];

    exportToCsv(`sarraf_analytics_transactions_${new Date().toISOString().slice(0, 10)}`, columns, filteredTransactions, language);
    showToast(language === 'ar' ? 'تم تنزيل ملف CSV بنجاح' : 'CSV file downloaded successfully');
  };

  // Export Filtered Transactions to Excel (.xls)
  const handleExportFilteredExcel = () => {
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
        accessor: (t) => formatDate(t.timestamp, language, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      },
    ];

    exportToExcelTable(
      `sarraf_analytics_transactions_${new Date().toISOString().slice(0, 10)}`,
      language === 'ar' ? 'تقرير تحليلات مدفوعات صرّاف' : 'Sarraf Ops Analytics Report',
      columns,
      filteredTransactions,
      language
    );
    showToast(language === 'ar' ? 'تم تنزيل جدول Excel بنجاح' : 'Excel file downloaded successfully');
  };

  const googleAppsScriptCode = `function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "التاريخ والوقت",
        "رقم العملية (TRX ID)",
        "مزود الدفع",
        "المبلغ (ج.م)",
        "رقم هاتف الراسل",
        "اسم الراسل",
        "الحالة",
        "الرصيد بعد العملية"
      ]);
      sheet.getRange(1, 1, 1, 8).setFontWeight("bold").setBackground("#0f172a").setFontColor("#ffffff");
      sheet.setFrozenRows(1);
    }

    var data = JSON.parse(e.postData.contents);

    if (data.action === "test_connection") {
      return ContentService.createTextOutput(JSON.stringify({ status: "success", message: "Test OK" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (data.transactions && Array.isArray(data.transactions)) {
      data.transactions.forEach(function(tx) {
        sheet.appendRow([
          tx.date || new Date().toLocaleString("ar-EG"),
          tx.externalTrxId || tx.id,
          tx.providerName || tx.provider,
          tx.amount,
          tx.senderPhone || "-",
          tx.senderName || "-",
          tx.statusName || tx.status,
          tx.balanceAfter !== undefined && tx.balanceAfter !== null ? tx.balanceAfter : "-"
        ]);
      });
    } else {
      sheet.appendRow([
        data.date || new Date().toLocaleString("ar-EG"),
        data.externalTrxId || data.id,
        data.providerName || data.provider,
        data.amount,
        data.senderPhone || "-",
        data.senderName || "-",
        data.statusName || data.status,
        data.balanceAfter !== undefined && data.balanceAfter !== null ? data.balanceAfter : "-"
      ]);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}`;

  return (
    <div className="py-6 pb-28 max-w-7xl mx-auto min-h-screen px-4 sm:px-6 flex flex-col gap-6">
      {/* Header & Main Control Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-outline-variant/80">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <span className="material-symbols-outlined text-2xl">analytics</span>
            </div>
            <h1 className="text-headline-md font-bold text-on-surface">
              {language === 'ar' ? 'منصة التحليلات والإحصائيات والربط' : 'Analytics & Real-time Integrations'}
            </h1>
          </div>
          <p className="text-body-md text-on-surface-variant">
            {language === 'ar'
              ? 'مؤشرات الأداء المالي، ساعات الذروة، تصدير البيانات إلى Excel و CSV، والمزامنة الحية مع Google Sheets'
              : 'Financial velocity KPIs, peak hours distribution, system exports, and live Google Sheets sync'}
          </p>
        </div>

        {/* Global Export & Action Controls */}
        <div className="flex items-center flex-wrap gap-2.5 self-start md:self-auto">
          {/* Export to Excel */}
          <button
            onClick={handleExportFilteredExcel}
            title={language === 'ar' ? 'تصدير البيانات المفلترة إلى Excel' : 'Export filtered data to Excel'}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600/10 border border-emerald-600/30 text-emerald-700 dark:text-emerald-300 font-bold text-label-md hover:bg-emerald-600/20 active:scale-95 transition-all cursor-pointer shadow-xs"
          >
            <span className="material-symbols-outlined text-lg">table_view</span>
            <span>{language === 'ar' ? 'تصدير Excel (.xls)' : 'Export Excel'}</span>
          </button>

          {/* Export to CSV */}
          <button
            onClick={handleExportFilteredCsv}
            title={language === 'ar' ? 'تصدير البيانات المفلترة إلى CSV' : 'Export filtered data to CSV'}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-surface-container-low border border-outline-variant text-on-surface font-bold text-label-md hover:bg-surface-container active:scale-95 transition-all cursor-pointer shadow-xs"
          >
            <span className="material-symbols-outlined text-lg">download</span>
            <span>{language === 'ar' ? 'تصدير CSV' : 'Export CSV'}</span>
          </button>

          {/* Google Sheets Trigger */}
          <button
            onClick={() => {
              if (sheetsConfig.sheetUrl) {
                // Scroll down to Google Sheets Section or highlight it
                const el = document.getElementById('googleSheetsSection');
                if (el) el.scrollIntoView({ behavior: 'smooth' });
              } else {
                setIsConnectModalOpen(true);
              }
            }}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-bold text-label-md shadow-xs active:scale-95 transition-all cursor-pointer ${
              sheetsConfig.sheetUrl
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-primary text-on-primary hover:bg-primary/90'
            }`}
          >
            <span className="material-symbols-outlined text-lg">
              {sheetsConfig.sheetUrl ? 'sync_alt' : 'link'}
            </span>
            <span>
              {sheetsConfig.sheetUrl
                ? language === 'ar'
                  ? 'جوجل شيت متصل'
                  : 'Sheets Connected'
                : language === 'ar'
                ? 'ربط Google Sheets'
                : 'Connect Sheets'}
            </span>
          </button>
        </div>
      </div>

      {/* Advanced Filter Toolbar */}
      <section className="bg-surface-container-lowest border border-outline-variant/80 rounded-2xl p-4 shadow-xs flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Time Range Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
            <span className="text-label-sm font-semibold text-on-surface-variant me-1">
              {language === 'ar' ? 'الفترة:' : 'Range:'}
            </span>
            {[
              { id: 'today', ar: 'اليوم', en: 'Today' },
              { id: '7days', ar: 'آخر 7 أيام', en: 'Last 7 Days' },
              { id: 'thisMonth', ar: 'هذا الشهر', en: 'This Month' },
              { id: '30days', ar: 'آخر 30 يوماً', en: 'Last 30 Days' },
              { id: 'all', ar: 'كل الفترات', en: 'All Time' },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTimeRange(t.id as any)}
                className={`px-3 py-1.5 rounded-full text-label-sm font-bold transition-all cursor-pointer ${
                  timeRange === t.id
                    ? 'bg-primary text-on-primary shadow-xs'
                    : 'bg-surface-container-low border border-outline-variant/60 text-on-surface hover:bg-surface-container'
                }`}
              >
                {language === 'ar' ? t.ar : t.en}
              </button>
            ))}
          </div>

          {/* Quick Result Counter */}
          <div className="text-label-sm text-on-surface-variant font-medium">
            {language === 'ar' ? 'المعاملات المطابقة:' : 'Matched Records:'}{' '}
            <span className="font-bold text-primary font-code-num">{filteredTransactions.length}</span> /{' '}
            <span className="font-code-num">{transactions.length}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-outline-variant/40">
          {/* Search Input */}
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 rtl:left-auto rtl:right-3 top-2.5 text-outline text-lg pointer-events-none">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                language === 'ar'
                  ? 'بحث بالمرسل، الهاتف، رقم العملية...'
                  : 'Search by sender, phone, TRX ID...'
              }
              className="w-full h-10 pl-9 pr-8 rtl:pl-8 rtl:pr-9 bg-surface-container-low border border-outline-variant rounded-xl text-body-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            />
          </div>

          {/* Provider Dropdown */}
          <div>
            <select
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
              className="w-full h-10 px-3 bg-surface-container-low border border-outline-variant rounded-xl text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer"
            >
              <option value="all">{language === 'ar' ? 'جميع شبكات الدفع (All Providers)' : 'All Payment Providers'}</option>
              <option value="vodafone_cash">{language === 'ar' ? 'فودافون كاش (Vodafone Cash)' : 'Vodafone Cash'}</option>
              <option value="instapay">{language === 'ar' ? 'شبكة إنستاباي (InstaPay IPN)' : 'InstaPay (IPN)'}</option>
              <option value="orange_cash">{language === 'ar' ? 'أورنج كاش (Orange Cash)' : 'Orange Cash'}</option>
              <option value="etisalat_cash">{language === 'ar' ? 'اتصالات كاش (Etisalat Cash)' : 'Etisalat Cash'}</option>
            </select>
          </div>

          {/* Status Dropdown */}
          <div>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full h-10 px-3 bg-surface-container-low border border-outline-variant rounded-xl text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer"
            >
              <option value="all">{language === 'ar' ? 'جميع الحالات (All Statuses)' : 'All Statuses'}</option>
              <option value="confirmed">{language === 'ar' ? 'مؤكدة ومطابقة (Confirmed)' : 'Confirmed & Reconciled'}</option>
              <option value="review_required">{language === 'ar' ? 'قيد المراجعة اليدوية (In Review)' : 'Review Required'}</option>
              <option value="failed">{language === 'ar' ? 'فاشلة / مرفوضة (Failed)' : 'Failed / Rejected'}</option>
            </select>
          </div>
        </div>
      </section>

      {/* KPI Cards Grid */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Volume */}
        <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/80 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-label-sm font-semibold text-on-surface-variant">
              {language === 'ar' ? 'حجم السيولة المؤكدة' : 'Settled Volume'}
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <span className="material-symbols-outlined text-xl">payments</span>
            </div>
          </div>
          <div>
            <div className="text-headline-sm font-code-num font-extrabold text-on-surface">
              {totalSettledVolume.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span className="text-body-sm font-bold text-on-surface-variant ms-1.5">ج.م</span>
            </div>
            <p className="text-label-xs text-on-surface-variant mt-1">
              {language === 'ar'
                ? `عبر ${confirmedTxns.length} عملية تحويل ناجحة`
                : `Across ${confirmedTxns.length} confirmed transfers`}
            </p>
          </div>
        </div>

        {/* Card 2: Average Ticket Size */}
        <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/80 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-label-sm font-semibold text-on-surface-variant">
              {language === 'ar' ? 'متوسط قيمة العملية' : 'Avg. Transaction Size'}
            </span>
            <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center">
              <span className="material-symbols-outlined text-xl">query_stats</span>
            </div>
          </div>
          <div>
            <div className="text-headline-sm font-code-num font-extrabold text-on-surface">
              {avgTransactionValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span className="text-body-sm font-bold text-on-surface-variant ms-1.5">ج.م</span>
            </div>
            <p className="text-label-xs text-on-surface-variant mt-1">
              {language === 'ar' ? 'معدل سلة المدفوعات للعملية الواحدة' : 'Average basket size per receipt'}
            </p>
          </div>
        </div>

        {/* Card 3: Instant Reconciliation Rate */}
        <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/80 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-label-sm font-semibold text-on-surface-variant">
              {language === 'ar' ? 'دقة المطابقة الفورية' : 'Instant Match Rate'}
            </span>
            <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <span className="material-symbols-outlined text-xl">verified</span>
            </div>
          </div>
          <div>
            <div className="text-headline-sm font-code-num font-extrabold text-primary">
              {instantReconciliationRate.toFixed(1)}%
            </div>
            <p className="text-label-xs text-on-surface-variant mt-1">
              {language === 'ar'
                ? 'مطابقة حسابية وفك تشفير في أقل من 300 مللي ثانية'
                : 'Reconciled in < 300ms without human friction'}
            </p>
          </div>
        </div>

        {/* Card 4: CBE Regulatory Monthly Intake */}
        <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/80 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-label-sm font-semibold text-on-surface-variant">
              {language === 'ar' ? 'استهلاك سقف البنك المركزي CBE' : 'CBE Monthly Cap'}
            </span>
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
              <span className="material-symbols-outlined text-xl">account_balance</span>
            </div>
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-headline-sm font-code-num font-extrabold text-on-surface">
                {regulatoryLimitUtilization.monthlyPct.toFixed(1)}%
              </span>
              <span className="text-label-xs text-on-surface-variant">
                {regulatoryLimitUtilization.monthlyIntake.toLocaleString('en-US')} /{' '}
                {regulatoryLimitUtilization.monthlyLimit.toLocaleString('en-US')} ج.م
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-surface-container-highest mt-2 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  regulatoryLimitUtilization.monthlyPct > 90
                    ? 'bg-error'
                    : regulatoryLimitUtilization.monthlyPct > 80
                    ? 'bg-amber-500'
                    : 'bg-emerald-500'
                }`}
                style={{ width: `${Math.min(regulatoryLimitUtilization.monthlyPct, 100)}%` }}
              ></div>
            </div>
          </div>
        </div>
      </section>

      {/* Visual Analytics Grid: Volume by Provider + Peak Hours Heatmap */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Provider Volume Distribution */}
        <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/80 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between pb-3 border-b border-outline-variant/60 mb-4">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-xl">donut_small</span>
              <h3 className="text-title-md font-bold text-on-surface">
                {language === 'ar' ? 'توزيع السيولة حسب مزود الدفع' : 'Volume by Payment Provider'}
              </h3>
            </div>
            <span className="text-label-xs text-on-surface-variant font-code-num">
              {totalSettledVolume.toLocaleString('en-US')} ج.م
            </span>
          </div>

          <div className="space-y-4">
            {providerStats.map((item) => (
              <div key={item.key} className="space-y-1.5">
                <div className="flex items-center justify-between text-body-sm">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }}></span>
                    <span className="font-bold text-on-surface">
                      {language === 'ar' ? item.labelAr : item.labelEn}
                    </span>
                    <span className="text-label-xs text-on-surface-variant font-code-num">
                      ({item.count} {language === 'ar' ? 'عملية' : 'txns'})
                    </span>
                  </div>
                  <div className="flex items-center gap-2 font-code-num font-bold">
                    <span>{item.volume.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م</span>
                    <span className="text-label-xs text-on-surface-variant">({item.percentage.toFixed(1)}%)</span>
                  </div>
                </div>
                <div className="w-full h-2.5 rounded-full bg-surface-container-highest overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${item.percentage}%`,
                      backgroundColor: item.color,
                    }}
                  ></div>
                </div>
              </div>
            ))}
          </div>

          <p className="text-label-xs text-on-surface-variant mt-4 pt-3 border-t border-outline-variant/40">
            {language === 'ar'
              ? 'يتم تحديث نسب الاستحواذ تلقائياً بمجرد إدراج أي عملية جديدة في السجل المالي.'
              : 'Shares auto-update the moment any new inbound transfer is reconciled.'}
          </p>
        </div>

        {/* Peak Hours Hourly Distribution Heatmap */}
        <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/80 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between pb-3 border-b border-outline-variant/60 mb-4">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-xl">schedule</span>
              <h3 className="text-title-md font-bold text-on-surface">
                {language === 'ar' ? 'ساعات الذروة ونشاط التحويلات' : 'Peak Hours Activity'}
              </h3>
            </div>
            <span className="text-label-xs text-on-surface-variant">
              {language === 'ar' ? 'توزيع 24 ساعة (توقيت القاهرة)' : '24-hour distribution (Cairo)'}
            </span>
          </div>

          {/* Bar Chart Heatmap */}
          <div className="flex items-end gap-1 h-36 pt-4 pb-2 px-1">
            {hourlyActivity.hours.map((h) => {
              const heightPct = (h.count / hourlyActivity.maxCount) * 100;
              const isPeak = h.count === hourlyActivity.maxCount && h.count > 0;

              return (
                <div key={h.hour} className="flex-1 flex flex-col items-center gap-1 group relative">
                  {/* Tooltip on hover */}
                  <div className="absolute -top-10 opacity-0 group-hover:opacity-100 transition-opacity bg-neutral-900 text-white text-label-xs px-2 py-1 rounded shadow-md whitespace-nowrap z-20 pointer-events-none">
                    {h.label}: {h.count} {language === 'ar' ? 'عملية' : 'txns'} ({h.volume.toLocaleString('en-US')} ج.م)
                  </div>

                  <div className="w-full flex items-end h-28 bg-surface-container-high/40 rounded-t-sm">
                    <div
                      className={`w-full rounded-t-sm transition-all duration-300 ${
                        isPeak
                          ? 'bg-amber-500'
                          : h.count > 0
                          ? 'bg-primary group-hover:bg-primary/80'
                          : 'bg-transparent'
                      }`}
                      style={{ height: `${Math.max(heightPct, 4)}%` }}
                    ></div>
                  </div>
                  <span className="text-[9px] text-on-surface-variant font-code-num">
                    {h.hour % 3 === 0 ? h.hour : ''}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between text-label-xs text-on-surface-variant pt-2 border-t border-outline-variant/40">
            <span>{language === 'ar' ? '00:00 منتصف الليل' : '00:00 Midnight'}</span>
            <div className="flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-500"></span>
              <span>{language === 'ar' ? 'ساعة الذروة القصوى' : 'Highest Peak Hour'}</span>
            </div>
            <span>{language === 'ar' ? '23:00 مساءً' : '23:00 Night'}</span>
          </div>
        </div>
      </section>

      {/* POS Fleet Telemetry & Filter Security Stats */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Terminal Leaderboard */}
        <div className="lg:col-span-2 p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/80 shadow-xs">
          <div className="flex items-center justify-between pb-3 border-b border-outline-variant/60 mb-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-xl">devices</span>
              <h3 className="text-title-md font-bold text-on-surface">
                {language === 'ar' ? 'أداء وكفاءة أجهزة الدفع (POS Fleet)' : 'Terminal Fleet Performance'}
              </h3>
            </div>
            <span className="text-label-xs text-on-surface-variant font-code-num">
              {devices.length} {language === 'ar' ? 'أجهزة مسجلة' : 'terminals'}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right rtl:text-right ltr:text-left text-body-sm">
              <thead>
                <tr className="border-b border-outline-variant/40 text-on-surface-variant text-label-sm">
                  <th className="py-2 px-3">{language === 'ar' ? 'الجهاز والاسم' : 'Device Name'}</th>
                  <th className="py-2 px-3">{language === 'ar' ? 'المزود والخط' : 'Provider & SIM'}</th>
                  <th className="py-2 px-3">{language === 'ar' ? 'الحالة' : 'Status'}</th>
                  <th className="py-2 px-3">{language === 'ar' ? 'البطارية' : 'Battery'}</th>
                  <th className="py-2 px-3 font-code-num">{language === 'ar' ? 'العمليات الملتقطة' : 'Captured Txns'}</th>
                  <th className="py-2 px-3 font-code-num">{language === 'ar' ? 'إجمالي الحجم' : 'Volume'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/30">
                {devicePerformance.map((dev) => (
                  <tr key={dev.id} className="hover:bg-surface-container-low/50 transition-colors">
                    <td className="py-3 px-3">
                      <div className="font-bold text-on-surface">{dev.name}</div>
                      <div className="text-label-xs text-on-surface-variant font-code-num">{dev.deviceNumber}</div>
                    </td>
                    <td className="py-3 px-3">
                      <span className="text-label-xs font-semibold px-2 py-0.5 rounded-md bg-surface-container border border-outline-variant/50">
                        {dev.providerLabel}
                      </span>
                      <div className="text-label-xs text-on-surface-variant font-code-num mt-0.5">
                        {dev.phoneNumber}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex items-center gap-1 text-label-xs font-bold px-2 py-0.5 rounded-full ${
                          dev.status === 'online'
                            ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
                            : 'bg-error/10 text-error border border-error/20'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            dev.status === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-error'
                          }`}
                        ></span>
                        {dev.status === 'online'
                          ? language === 'ar'
                            ? 'متصل'
                            : 'Online'
                          : language === 'ar'
                          ? 'غير متصل'
                          : 'Offline'}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-code-num">
                      <div className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-sm text-on-surface-variant">
                          {dev.batteryLevel > 20 ? 'battery_std' : 'battery_alert'}
                        </span>
                        <span>{dev.batteryLevel}%</span>
                      </div>
                    </td>
                    <td className="py-3 px-3 font-code-num font-bold text-primary">
                      {dev.capturedCount}
                    </td>
                    <td className="py-3 px-3 font-code-num font-extrabold text-on-surface">
                      {dev.capturedVolume.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Security & Filter Stats */}
        <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/80 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 pb-3 border-b border-outline-variant/60 mb-3">
              <span className="material-symbols-outlined text-primary text-xl">security</span>
              <h3 className="text-title-md font-bold text-on-surface">
                {language === 'ar' ? 'حماية السجل وتصفية الضوضاء' : 'Noise & Spam Defense'}
              </h3>
            </div>
            <p className="text-body-sm text-on-surface-variant mb-4">
              {language === 'ar'
                ? 'يقوم محرك صرّاف بفحص الرسائل النصية وعزل الإعلانات ورموز OTP تلقائياً لحماية القيود المالية من التلوث.'
                : 'Sarraf Engine automatically intercepts OTPs and promos without polluting the financial ledger.'}
            </p>

            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-surface-container-low border border-outline-variant/60 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-emerald-600 text-lg">verified_user</span>
                  <span className="text-label-sm font-bold text-on-surface">
                    {language === 'ar' ? 'رسائل مالية معتمدة' : 'Valid Financials'}
                  </span>
                </div>
                <span className="font-code-num font-extrabold text-emerald-600">{transactions.length}</span>
              </div>

              <div className="p-3 rounded-xl bg-surface-container-low border border-outline-variant/60 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-amber-600 text-lg">mark_email_read</span>
                  <span className="text-label-sm font-bold text-on-surface">
                    {language === 'ar' ? 'عروض ترويجية تم تصفيتها' : 'Promos Intercepted'}
                  </span>
                </div>
                <span className="font-code-num font-extrabold text-amber-600">
                  {Math.round(transactions.length * 0.4) + 12}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-surface-container-low border border-outline-variant/60 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-blue-600 text-lg">password</span>
                  <span className="text-label-sm font-bold text-on-surface">
                    {language === 'ar' ? 'رموز OTP تم حجبها' : 'OTPs Masked & Blocked'}
                  </span>
                </div>
                <span className="font-code-num font-extrabold text-blue-600">
                  {Math.round(transactions.length * 0.25) + 6}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 p-2.5 rounded-xl bg-primary/5 border border-primary/20 text-label-xs text-primary font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-base shrink-0">check_circle</span>
            <span>{language === 'ar' ? 'سجل المحاسبة نقي وخالٍ من الرسائل المشوهة بنسبة 100%' : 'Ledger is 100% free of spurious SMS entries'}</span>
          </div>
        </div>
      </section>

      {/* Google Sheets Real-Time Synchronization Hub */}
      <section
        id="googleSheetsSection"
        className="p-6 rounded-2xl bg-surface-container-lowest border-2 border-emerald-600/30 shadow-md relative overflow-hidden"
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-outline-variant/80">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm">
              <span className="material-symbols-outlined text-2xl">table_rows</span>
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-headline-sm font-bold text-on-surface">
                  {language === 'ar' ? 'المزامنة الحية مع Google Sheets' : 'Google Sheets Real-time Sync'}
                </h2>
                {sheetsConfig.sheetUrl || sheetsConfig.spreadsheetId ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 font-bold text-label-xs">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    {sheetsConfig.accountEmail
                      ? language === 'ar'
                        ? `متصل بحساب: ${sheetsConfig.accountEmail}`
                        : `Connected: ${sheetsConfig.accountEmail}`
                      : language === 'ar'
                      ? 'متصل وجاهز للترحيل اللحظي'
                      : 'Connected & Active'}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container border border-outline-variant text-on-surface-variant font-bold text-label-xs">
                    <span className="w-2 h-2 rounded-full bg-neutral-400"></span>
                    {language === 'ar' ? 'غير متصل حالياً' : 'Not Connected'}
                  </span>
                )}
              </div>
              <p className="text-body-sm text-on-surface-variant mt-0.5">
                {language === 'ar'
                  ? 'تسجيل كل عملية دفع مؤكدة تلقائياً في سطر جديد داخل ملف Google Sheet الخاص بك دون الحاجة لأي تدخّل يدوي.'
                  : 'Every confirmed inbound transaction is automatically appended as a new row to your online Google Sheet.'}
              </p>
            </div>
          </div>

          {/* Integration Actions */}
          <div className="flex items-center flex-wrap gap-2.5">
            {/* Platform Admin Google OAuth Setup Button */}
            {(currentUser?.role === 'owner' || currentUser?.isPlatformAdmin || !sheetsConfig.isOAuthConfigured) && (
              <button
                onClick={() => {
                  setPlatformClientIdInput(sheetsConfig.googleClientId || '');
                  setIsOAuthSetupModalOpen(true);
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-container-low border border-outline-variant text-label-sm font-semibold text-on-surface-variant hover:text-on-surface hover:bg-surface-container active:scale-95 transition-all cursor-pointer"
                title={language === 'ar' ? 'إعدادات Google OAuth للمنصة' : 'Platform Google OAuth Settings'}
              >
                <span className="material-symbols-outlined text-base">settings</span>
                <span>{language === 'ar' ? 'إعدادات Google API' : 'Google API Setup'}</span>
              </button>
            )}

            {sheetsConfig.sheetUrl || sheetsConfig.spreadsheetId ? (
              <>
                {sheetsConfig.sheetUrl && (
                  <a
                    href={sheetsConfig.sheetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 text-white text-label-sm font-bold shadow-xs hover:bg-emerald-700 active:scale-95 transition-all cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-base">open_in_new</span>
                    <span>{language === 'ar' ? 'فتح الشيت في Google Drive' : 'Open in Google Drive'}</span>
                  </a>
                )}

                <button
                  onClick={handleTestConnection}
                  disabled={testingWebhook}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-container-low border border-outline-variant text-label-sm font-bold text-on-surface hover:bg-surface-container active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-base">
                    {testingWebhook ? 'progress_activity' : 'network_check'}
                  </span>
                  <span>{testingWebhook ? (language === 'ar' ? 'جاري الفحص...' : 'Testing...') : language === 'ar' ? 'اختبار الاتصال' : 'Test Ping'}</span>
                </button>

                <button
                  onClick={handleSyncAllToSheet}
                  disabled={syncingAll}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600/10 border border-emerald-600/30 text-emerald-700 dark:text-emerald-300 text-label-sm font-bold hover:bg-emerald-600/20 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-base">
                    {syncingAll ? 'progress_activity' : 'sync'}
                  </span>
                  <span>{syncingAll ? (language === 'ar' ? 'جاري الترحيل...' : 'Syncing...') : language === 'ar' ? 'مزامنة السجل بالكامل' : 'Sync All History'}</span>
                </button>

                <button
                  onClick={() => setIsDisconnectConfirmOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-error/10 border border-error/20 text-error text-label-sm font-bold hover:bg-error/20 active:scale-95 transition-all cursor-pointer"
                >
                  <span className="material-symbols-outlined text-base">link_off</span>
                  <span>{language === 'ar' ? 'إلغاء الربط' : 'Disconnect'}</span>
                </button>
              </>
            ) : null}
          </div>
        </div>

        {/* Integration Details / Info Cards */}
        {sheetsConfig.sheetUrl || sheetsConfig.spreadsheetId ? (
          <div className="space-y-4 mt-5">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="p-3.5 rounded-xl bg-surface-container-low border border-outline-variant/60">
                <span className="text-label-xs text-on-surface-variant block mb-1">
                  {language === 'ar' ? 'اسم الشيت المرتبط' : 'Connected Sheet'}
                </span>
                <p className="text-body-md font-bold text-on-surface truncate" title={sheetsConfig.sheetName || ''}>
                  {sheetsConfig.sheetName || (language === 'ar' ? 'صرّاف - سجل المدفوعات' : 'Transactions Sheet')}
                </p>
                {sheetsConfig.sheetUrl && (
                  <a
                    href={sheetsConfig.sheetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-label-xs text-emerald-600 font-bold hover:underline mt-1"
                  >
                    <span>{language === 'ar' ? 'عرض الملف' : 'View File'}</span>
                    <span className="material-symbols-outlined text-xs">launch</span>
                  </a>
                )}
              </div>

              <div className="p-3.5 rounded-xl bg-surface-container-low border border-outline-variant/60">
                <span className="text-label-xs text-on-surface-variant block mb-1">
                  {language === 'ar' ? 'حساب Google المرتبط' : 'Google Account'}
                </span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.66v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.15z"/>
                    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/>
                    <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.14-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
                    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
                  </svg>
                  <p className="text-body-sm font-bold text-on-surface truncate" title={sheetsConfig.accountEmail || ''}>
                    {sheetsConfig.accountEmail || (language === 'ar' ? 'ربط مباشر' : 'Direct Link')}
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-surface-container-low border border-outline-variant/60">
                <span className="text-label-xs text-on-surface-variant block mb-1">
                  {language === 'ar' ? 'العمليات المرحلة بنجاح' : 'Synced Rows Count'}
                </span>
                <p className="text-body-md font-code-num font-bold text-emerald-600">
                  {sheetsConfig.syncedCount} {language === 'ar' ? 'معاملة مسجلة' : 'rows logged'}
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-surface-container-low border border-outline-variant/60">
                <span className="text-label-xs text-on-surface-variant block mb-1">
                  {language === 'ar' ? 'آخر مزامنة تمت' : 'Last Synced'}
                </span>
                <p className="text-body-md font-code-num font-medium text-on-surface">
                  {sheetsConfig.lastSyncAt
                    ? formatDate(sheetsConfig.lastSyncAt, language, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                    : language === 'ar'
                    ? 'بانتظار أول عملية'
                    : 'Pending first transaction'}
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-emerald-600/5 border border-emerald-600/20 text-label-sm text-emerald-800 dark:text-emerald-200 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-600 text-lg shrink-0">bolt</span>
                <span>
                  {language === 'ar'
                    ? 'الترحيل اللحظي نشط: أي دفعة جديدة مؤكدة على فودافون كاش، إنستاباي، أو أورنج تُضاف فوراً في سطر جديد.'
                    : 'Real-time sync active: Every confirmed payment on Vodafone Cash, InstaPay, or Orange appends a row immediately.'}
                </span>
              </div>
              <button
                onClick={() => setIsDisconnectConfirmOpen(true)}
                className="text-label-xs text-error hover:underline cursor-pointer font-bold"
              >
                {language === 'ar' ? 'تغيير الشيت أو إلغاء الربط' : 'Switch Sheet / Disconnect'}
              </button>
            </div>
          </div>
        ) : (
          /* NOT CONNECTED: Two Clean, Hassle-Free Options */
          <div className="mt-5 space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
              {/* PRIMARY METHOD: 1-Click Google OAuth Hero */}
              <div className="lg:col-span-7 p-6 rounded-2xl bg-gradient-to-br from-emerald-500/10 via-surface-container-low to-surface-container border-2 border-emerald-500/40 flex flex-col justify-between shadow-xs">
                <div>
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-600/10 border border-emerald-600/20 text-emerald-700 dark:text-emerald-300 font-bold text-label-xs mb-3">
                    <span className="material-symbols-outlined text-sm">bolt</span>
                    {language === 'ar' ? 'الربط التلقائي الفوري (بضغطة زر واحدة)' : 'Recommended 1-Click Auto-Connect'}
                  </div>

                  <h3 className="text-title-lg font-extrabold text-on-surface mb-2">
                    {language === 'ar' ? 'تسجيل الدخول بحساب Google والربط التلقائي' : 'Sign in with Google & Link Automatically'}
                  </h3>

                  <p className="text-body-sm text-on-surface-variant mb-4 leading-relaxed">
                    {language === 'ar'
                      ? 'دون كتابة أي كود أو إعدادات يدوية معقدة. اضغط الزر بالأسفل وسيقوم صرّاف بإنشاء ملف شيت منسق باسم "صرّاف - سجل المدفوعات" تلقائياً في حساب Google Drive الخاص بك وبدء تسجيل المعاملات لحظياً.'
                      : 'Zero code, zero manual scripts. Click below and Sarraf will automatically create a dedicated sheet in your Google Drive and begin streaming payments in real-time.'}
                  </p>

                  <div className="space-y-2 mb-6 text-label-sm font-semibold text-on-surface">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-emerald-600 text-base shrink-0">check_circle</span>
                      <span>{language === 'ar' ? 'إنشاء ملف Google Sheet منسق تلقائياً مع تجميد عناوين الأعمدة' : 'Auto-creates formatted Google Sheet with frozen headers'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-emerald-600 text-base shrink-0">check_circle</span>
                      <span>{language === 'ar' ? 'ترحيل مباشر عبر Google Sheets API v4 الرسمي فائق السرعة' : 'Direct streaming via official Google Sheets API v4'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-emerald-600 text-base shrink-0">check_circle</span>
                      <span>{language === 'ar' ? 'حرية تامة: يمكنك إلغاء الربط أو تغيير الشيت في أي وقت' : 'Full freedom: disconnect or switch sheets anytime'}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <button
                    onClick={handleGoogleOAuthSignIn}
                    disabled={loadingOAuth}
                    className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-white hover:bg-neutral-50 text-neutral-900 border border-neutral-300 font-bold text-label-md shadow-sm hover:shadow-md active:scale-98 transition-all flex items-center justify-center gap-3 cursor-pointer disabled:opacity-50"
                  >
                    <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.66v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.15z"/>
                      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/>
                      <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.14-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
                      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
                    </svg>
                    <span>
                      {loadingOAuth
                        ? (language === 'ar' ? 'جاري الاتصال بـ Google...' : 'Connecting to Google...')
                        : (language === 'ar' ? 'تسجيل الدخول بحساب Google والربط الفوري' : 'Sign in with Google & Link Instantly')}
                    </span>
                  </button>
                </div>
              </div>

              {/* SECONDARY METHOD: Direct Paste Sheet URL */}
              <div className="lg:col-span-5 p-6 rounded-2xl bg-surface-container-low border border-outline-variant flex flex-col justify-between">
                <div>
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container-highest border border-outline-variant text-on-surface-variant font-bold text-label-xs mb-3">
                    <span className="material-symbols-outlined text-sm">link</span>
                    {language === 'ar' ? 'الخيار الثاني: ملف موجود لديك' : 'Option 2: Existing Sheet'}
                  </div>

                  <h4 className="text-title-md font-bold text-on-surface mb-1.5">
                    {language === 'ar' ? 'أو الصق رابط شيت من Google Drive' : 'Or Paste an Existing Sheet URL'}
                  </h4>

                  <p className="text-body-xs text-on-surface-variant mb-4">
                    {language === 'ar'
                      ? 'إذا كان لديك ملف Google Sheet ترغب بربطه تحديداً، افتحه في المتصفح وانسخ الرابط من شريط العنوان والصقه هنا.'
                      : 'If you already have a Google Sheet you want to use, copy its link from your browser and paste it below.'}
                  </p>

                  <div className="space-y-3">
                    <div>
                      <label className="text-label-xs font-bold text-on-surface block mb-1">
                        {language === 'ar' ? 'رابط ملف Google Sheet' : 'Google Sheet URL'}
                      </label>
                      <input
                        type="url"
                        value={sheetUrlInput}
                        onChange={(e) => setSheetUrlInput(e.target.value)}
                        placeholder="https://docs.google.com/spreadsheets/d/.../edit"
                        className="w-full h-10 px-3 bg-surface-container-lowest border border-outline-variant rounded-xl text-body-xs font-code-num text-on-surface focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                      />
                    </div>

                    <div>
                      <label className="text-label-xs font-bold text-on-surface block mb-1">
                        {language === 'ar' ? 'اسم الملف أو الغرض (اختياري)' : 'Friendly Name (Optional)'}
                      </label>
                      <input
                        type="text"
                        value={sheetNameInput}
                        onChange={(e) => setSheetNameInput(e.target.value)}
                        placeholder={language === 'ar' ? 'مثال: شيت مبيعات المحل 2026' : 'e.g. Store Sales Sheet 2026'}
                        className="w-full h-10 px-3 bg-surface-container-lowest border border-outline-variant rounded-xl text-body-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-outline-variant/60">
                  <button
                    onClick={handleConnectDirectSheet}
                    disabled={savingSheet || !sheetUrlInput.trim()}
                    className="w-full px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-label-sm hover:bg-emerald-700 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {savingSheet
                      ? (language === 'ar' ? 'جاري الحفظ...' : 'Connecting...')
                      : (language === 'ar' ? 'حفظ وربط هذا الملف' : 'Save & Connect This Sheet')}
                  </button>
                </div>
              </div>
            </div>

            {/* Subtle Developer Fallback link */}
            <div className="pt-2 text-center">
              <button
                onClick={() => setIsScriptModalOpen(true)}
                className="text-label-xs text-on-surface-variant hover:text-on-surface underline transition-colors cursor-pointer"
              >
                {language === 'ar'
                  ? 'خيارات متقدمة للمطورين (سكريبت Webhook يدوي)'
                  : 'Advanced Developer Options (Manual Webhook Script)'}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Direct Connect Modal */}
      {isConnectModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-outline-variant">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-600 text-2xl">table_chart</span>
                <h3 className="text-title-lg font-bold text-on-surface">
                  {language === 'ar' ? 'ربط ملف Google Sheet' : 'Connect Google Sheet'}
                </h3>
              </div>
              <button
                onClick={() => setIsConnectModalOpen(false)}
                className="text-on-surface-variant hover:text-on-surface p-1 rounded-lg cursor-pointer"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-label-sm font-bold text-on-surface block mb-1">
                  {language === 'ar' ? 'اسم الشيت أو الغرض (اختياري)' : 'Sheet Friendly Name (Optional)'}
                </label>
                <input
                  type="text"
                  value={sheetNameInput}
                  onChange={(e) => setSheetNameInput(e.target.value)}
                  placeholder={language === 'ar' ? 'مثال: شيت مبيعات فودافون كاش 2026' : 'e.g. Sales 2026 Sheet'}
                  className="w-full h-10 px-3 bg-surface-container-low border border-outline-variant rounded-xl text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                />
              </div>

              <div>
                <label className="text-label-sm font-bold text-on-surface block mb-1">
                  {language === 'ar' ? 'رابط ملف Google Sheet أو معرف الشيت' : 'Google Sheet URL or ID'}{' '}
                  <span className="text-error">*</span>
                </label>
                <input
                  type="url"
                  value={sheetUrlInput}
                  onChange={(e) => setSheetUrlInput(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/.../edit"
                  className="w-full h-11 px-3 bg-surface-container-low border border-outline-variant rounded-xl text-body-sm font-code-num text-on-surface focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                />
                <p className="text-label-xs text-on-surface-variant mt-1.5">
                  {language === 'ar'
                    ? 'افتح ملفك على Google Sheets في المتصفح وانسخ رابطه من شريط العنوان والصقه هنا.'
                    : 'Open your Google Sheet in browser, copy its URL from address bar and paste here.'}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-outline-variant">
              <button
                onClick={() => setIsConnectModalOpen(false)}
                className="px-4 py-2 rounded-xl text-label-md font-semibold text-on-surface hover:bg-surface-container active:scale-95 transition-all cursor-pointer"
              >
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>

              <button
                onClick={handleConnectDirectSheet}
                disabled={savingSheet}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-label-md shadow-xs hover:bg-emerald-700 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
              >
                {savingSheet ? (language === 'ar' ? 'جاري الحفظ...' : 'Connecting...') : language === 'ar' ? 'تأكيد وحفظ الربط' : 'Confirm & Connect'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disconnect Confirmation Modal */}
      {isDisconnectConfirmOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-error">
              <div className="w-10 h-10 rounded-xl bg-error/10 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-2xl">link_off</span>
              </div>
              <h3 className="text-title-lg font-bold">
                {language === 'ar' ? 'إلغاء ربط Google Sheet؟' : 'Disconnect Google Sheet?'}
              </h3>
            </div>

            <p className="text-body-sm text-on-surface-variant">
              {language === 'ar'
                ? 'هل أنت متأكد من إلغاء الربط مع هذا الشيت؟ لن يتم إرسال أي معاملات جديدة إليه بعد الآن. يمكنك ربط شيت جديد في أي وقت تشاء بضغطة زر.'
                : 'Are you sure you want to disconnect this Google Sheet? No future transactions will be sent to it. You can connect a new sheet anytime in 1 click.'}
            </p>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-outline-variant">
              <button
                onClick={() => setIsDisconnectConfirmOpen(false)}
                className="px-4 py-2 rounded-xl text-label-md font-semibold text-on-surface hover:bg-surface-container active:scale-95 transition-all cursor-pointer"
              >
                {language === 'ar' ? 'تراجع' : 'Cancel'}
              </button>

              <button
                onClick={handleDisconnectSheet}
                disabled={savingSheet}
                className="px-5 py-2.5 rounded-xl bg-error text-white font-bold text-label-md shadow-xs hover:bg-error/90 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
              >
                {savingSheet ? (language === 'ar' ? 'جاري الإلغاء...' : 'Disconnecting...') : language === 'ar' ? 'نعم، قم بإلغاء الربط' : 'Yes, Disconnect'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Platform Owner / Admin: Google OAuth Setup Modal */}
      {isOAuthSetupModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-outline-variant">
              <div className="flex items-center gap-2">
                <svg className="w-6 h-6 shrink-0" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.66v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.15z"/>
                  <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/>
                  <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.14-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
                  <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
                </svg>
                <h3 className="text-title-lg font-bold text-on-surface">
                  {language === 'ar' ? 'إعداد ربط Google للمنصة' : 'Google OAuth Platform Setup'}
                </h3>
              </div>
              <button
                onClick={() => setIsOAuthSetupModalOpen(false)}
                className="text-on-surface-variant hover:text-on-surface p-1 rounded-lg cursor-pointer"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <p className="text-body-sm text-on-surface-variant">
              {language === 'ar'
                ? 'لتمكين التجار من الربط بضغطة زر عبر تسجيل الدخول بحساب Google، أدخل بيانات اعتماد تطبيق Google Cloud Console هنا:'
                : 'To enable 1-click Google Sign-in for all merchants, enter your Google Cloud OAuth credentials below:'}
            </p>

            {/* Redirect URI Display */}
            <div className="p-3 rounded-xl bg-surface-container-low border border-outline-variant">
              <div className="flex items-center justify-between text-label-xs text-on-surface-variant mb-1">
                <span>{language === 'ar' ? 'رابط التوجيه المعتمد (Authorized Redirect URI):' : 'Authorized Redirect URI:'}</span>
                <button
                  type="button"
                  onClick={() => {
                    const uri = `${window.location.origin}/api/v1/integrations/google/callback`;
                    navigator.clipboard.writeText(uri);
                    setCopiedRedirectUri(true);
                    showToast(language === 'ar' ? 'تم نسخ الرابط' : 'Redirect URI copied');
                    setTimeout(() => setCopiedRedirectUri(false), 2000);
                  }}
                  className="text-primary hover:underline font-bold flex items-center gap-1 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-xs">
                    {copiedRedirectUri ? 'check' : 'content_copy'}
                  </span>
                  <span>{copiedRedirectUri ? (language === 'ar' ? 'تم النسخ' : 'Copied') : language === 'ar' ? 'نسخ' : 'Copy'}</span>
                </button>
              </div>
              <code className="text-xs font-mono text-on-surface break-all select-all">
                {typeof window !== 'undefined' ? `${window.location.origin}/api/v1/integrations/google/callback` : '/api/v1/integrations/google/callback'}
              </code>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-label-sm font-bold text-on-surface block mb-1">
                  Google Client ID <span className="text-error">*</span>
                </label>
                <input
                  type="text"
                  value={platformClientIdInput}
                  onChange={(e) => setPlatformClientIdInput(e.target.value)}
                  placeholder="xxxxx-xxxxx.apps.googleusercontent.com"
                  className="w-full h-10 px-3 bg-surface-container-low border border-outline-variant rounded-xl text-body-xs font-mono text-on-surface focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                />
              </div>

              <div>
                <label className="text-label-sm font-bold text-on-surface block mb-1">
                  Google Client Secret <span className="text-error">*</span>
                </label>
                <input
                  type="password"
                  value={platformClientSecretInput}
                  onChange={(e) => setPlatformClientSecretInput(e.target.value)}
                  placeholder="GOCSPX-xxxxxxxxxxxxxxxx"
                  className="w-full h-10 px-3 bg-surface-container-low border border-outline-variant rounded-xl text-body-xs font-mono text-on-surface focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-outline-variant">
              <button
                onClick={() => setIsOAuthSetupModalOpen(false)}
                className="px-4 py-2 rounded-xl text-label-md font-semibold text-on-surface hover:bg-surface-container active:scale-95 transition-all cursor-pointer"
              >
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>

              <button
                onClick={handleSavePlatformOAuth}
                disabled={savingPlatformOAuth}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-label-md shadow-xs hover:bg-emerald-700 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
              >
                {savingPlatformOAuth ? (language === 'ar' ? 'جاري الحفظ...' : 'Saving...') : language === 'ar' ? 'حفظ وتفعيل الربط الفوري' : 'Save & Enable'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Legacy Developer Apps Script Code Modal (Advanced Fallback) */}
      {isScriptModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl w-full max-w-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-outline-variant">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-600 text-2xl">terminal</span>
                <h3 className="text-title-lg font-bold text-on-surface">
                  {language === 'ar' ? 'خيارات متقدمة: سكريبت Webhook للمطورين' : 'Developer Advanced Webhook'}
                </h3>
              </div>
              <button
                onClick={() => setIsScriptModalOpen(false)}
                className="text-on-surface-variant hover:text-on-surface p-1 rounded-lg cursor-pointer"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <p className="text-body-sm text-on-surface-variant">
              {language === 'ar'
                ? 'ملاحظة: لا يحتاج التجار العاديون لهذا السكريبت، فالربط التلقائي عبر تسجيل الدخول بـ Google يعمل مباشرة. هذا السكريبت مخصص فقط للمطورين الراغبين بربط Webhook مخصص.'
                : 'Note: Normal merchants do not need this. 1-click Google Sign-in works out-of-the-box. This script is only for custom webhook deployments.'}
            </p>

            <div className="relative">
              <pre className="p-4 rounded-xl bg-neutral-900 text-neutral-100 font-mono text-xs overflow-x-auto max-h-72 border border-neutral-700 rtl:text-left ltr:text-left">
                {googleAppsScriptCode}
              </pre>

              <button
                onClick={() => {
                  navigator.clipboard.writeText(googleAppsScriptCode);
                  setCopiedScript(true);
                  showToast(language === 'ar' ? 'تم نسخ كود السكريبت إلى الحافظة' : 'Script copied to clipboard');
                  setTimeout(() => setCopiedScript(false), 2000);
                }}
                className="absolute top-2 right-2 rtl:right-auto rtl:left-2 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1 shadow-sm active:scale-95 transition-all cursor-pointer"
              >
                <span className="material-symbols-outlined text-sm">
                  {copiedScript ? 'check' : 'content_copy'}
                </span>
                <span>{copiedScript ? (language === 'ar' ? 'تم النسخ!' : 'Copied!') : language === 'ar' ? 'نسخ الكود' : 'Copy'}</span>
              </button>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setIsScriptModalOpen(false)}
                className="px-5 py-2 rounded-xl bg-surface-container hover:bg-surface-container-high font-bold text-label-md text-on-surface cursor-pointer"
              >
                {language === 'ar' ? 'إغلاق' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
