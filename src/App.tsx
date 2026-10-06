/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { Transaction, Device, ProviderRail, User, Workspace } from './types';
import { useAuth } from './hooks/useAuth';
import { useTelemetry } from './hooks/useTelemetry';
import { safeStorage } from './utils/storage';
import { formatDate } from './utils/formatters';

import { Header } from './components/Header';
import { DashboardView } from './components/DashboardView';
import { LedgerView } from './components/LedgerView';
import { DevicesView } from './components/DevicesView';
import { RailsView } from './components/RailsView';
import { NavigationDrawer } from './components/NavigationDrawer';
import { BottomNavBar } from './components/BottomNavBar';
import { ReviewModal } from './components/ReviewModal';
import { OnboardingGuideModal } from './components/OnboardingGuideModal';
import { PairingModal } from './components/PairingModal';
import { AddSourceModal } from './components/AddSourceModal';
import { AnalyticsView } from './components/AnalyticsView';
import { AuthView } from './components/AuthView';
import { ViewLoadingSkeleton } from './components/ViewLoadingSkeleton';
import { apiFetch } from './api';

// Code-split heavy or secondary views to reduce the initial JS bundle size
const LandingPageView = React.lazy(() =>
  import('./components/LandingPageView').then((m) => ({ default: m.LandingPageView }))
);
const PlatformDashboardView = React.lazy(() =>
  import('./components/PlatformDashboardView').then((m) => ({ default: m.PlatformDashboardView }))
);
const SettingsView = React.lazy(() =>
  import('./components/SettingsView').then((m) => ({ default: m.SettingsView }))
);
const SubscriptionsView = React.lazy(() =>
  import('./components/SubscriptionsView').then((m) => ({ default: m.SubscriptionsView }))
);
const AuditLogsView = React.lazy(() =>
  import('./components/AuditLogsView').then((m) => ({ default: m.AuditLogsView }))
);
const VerifyEmailView = React.lazy(() =>
  import('./components/VerifyEmailView').then((m) => ({ default: m.VerifyEmailView }))
);
const InviteAcceptView = React.lazy(() =>
  import('./components/InviteAcceptView').then((m) => ({ default: m.InviteAcceptView }))
);

export default function App() {
  // Public Routing State
  const [currentPath, setCurrentPath] = useState<string>(() => window.location.pathname || '/');

  // Authentication State
  const {
    hasSession,
    setHasSession,
    currentUser,
    setCurrentUser,
    workspace,
    setWorkspace,
    userWorkspaces,
    isAuthLoading,
    handleLogout: authLogout,
    handleSwitchWorkspace: authSwitchWorkspace,
  } = useAuth();

  // Navigation & Language
  const [currentTab, setCurrentTab] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get('tab');
      if (tabParam) return tabParam;
    }
    return 'dashboard';
  });
  const [language, setLanguage] = useState<'en' | 'ar'>('ar');

  // Modals & Drawers state
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState<boolean>(false);
  const [isPairingOpen, setIsPairingOpen] = useState<boolean>(false);
  const [isAddSourceOpen, setIsAddSourceOpen] = useState<boolean>(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [reviewingTransaction, setReviewingTransaction] = useState<Transaction | null>(null);

  // Toast notification state
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(msg);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 3500);
  }, []);

  // Theme State
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = safeStorage.getItem('sarraf_theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
      root.setAttribute('data-theme', 'dark');
    } else {
      root.classList.remove('dark');
      root.classList.add('light');
      root.setAttribute('data-theme', 'light');
    }
    safeStorage.setItem('sarraf_theme', theme);
  }, [theme]);

  const handleToggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  // Synchronize document dir and lang attributes
  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
    html.setAttribute('lang', language);
  }, [language]);

  // Handle browser popstate history navigation
  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname || '/');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = useCallback((path: string) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path.split('?')[0]);
  }, []);

  // Onboarding modal auto-show logic (at most once per tenant unless opened manually)
  const onboardingAutoShownRef = useRef<Set<string>>(new Set());
  const onboardingKey = (orgId?: string) => `sarraf_onboarding_dismissed_${orgId || 'default'}`;

  const dismissOnboarding = useCallback(() => {
    setIsOnboardingOpen(false);
    safeStorage.setItem(onboardingKey(workspace?.id), '1');
  }, [workspace?.id]);

  // Telemetry Polling Hook
  const {
    transactions,
    setTransactions,
    devices,
    setDevices,
    rails,
    setRails,
    currentSub,
    refreshBackendData,
    clearTelemetry,
  } = useTelemetry({
    enabled: Boolean(hasSession && currentUser && workspace),
    onDeviceListFetched: (fetchedDevices) => {
      if (fetchedDevices.length === 0 && workspace?.id) {
        const dismissed = safeStorage.getItem(onboardingKey(workspace.id)) === '1';
        if (!dismissed && !onboardingAutoShownRef.current.has(workspace.id)) {
          onboardingAutoShownRef.current.add(workspace.id);
          setIsOnboardingOpen(true);
        }
      }
    },
  });

  const handleToggleLanguage = () => {
    setLanguage((prev) => (prev === 'en' ? 'ar' : 'en'));
  };

  const handleAuthSuccess = (user: User, org: Workspace) => {
    setHasSession(true);
    setCurrentUser(user);
    setWorkspace(org);
    navigate('/app');
    refreshBackendData();
    showToast(
      language === 'ar'
        ? `مرحباً بك، ${user.fullName} (${org.nameAr || org.name})`
        : `Welcome back, ${user.fullName} (${org.name})`
    );
  };

  const handleLogout = async () => {
    await authLogout();
    clearTelemetry();
    setIsDrawerOpen(false);
    navigate('/');
    showToast(language === 'ar' ? 'تم تسجيل الخروج بنجاح' : 'Logged out successfully');
  };

  const actionErrorMessage = async (res: Response | null, fallbackAr: string, fallbackEn: string) => {
    let serverMessage = '';
    if (res) {
      const data = await res.json().catch(() => ({}));
      serverMessage = data?.message || '';
    }
    return serverMessage || (language === 'ar' ? fallbackAr : fallbackEn);
  };

  // Financial Ledger Review Actions
  const handleApproveTransaction = async (tx: Transaction) => {
    let res: Response | null = null;
    try {
      res = await apiFetch(`/api/v1/transactions/${tx.id}/approve`, { method: 'POST' });
    } catch {}
    if (res?.ok) {
      await refreshBackendData();
      setReviewingTransaction(null);
      showToast(
        language === 'ar'
          ? `تم اعتماد العملية ${tx.trxId} رسمياً وتحديث رصيد الدفتر`
          : `Transaction ${tx.trxId} approved & recorded to audit log.`
      );
      return;
    }
    showToast(
      await actionErrorMessage(
        res,
        'تعذر اعتماد العملية. لم يتم تغيير أي شيء، حاول مرة أخرى.',
        'Could not approve the transaction. Nothing was changed, please retry.'
      )
    );
  };

  const handleRejectTransaction = async (tx: Transaction) => {
    let res: Response | null = null;
    try {
      res = await apiFetch(`/api/v1/transactions/${tx.id}/reject`, { method: 'POST' });
    } catch {}
    if (res?.ok) {
      await refreshBackendData();
      setReviewingTransaction(null);
      showToast(
        language === 'ar'
          ? `تم رفض العملية ${tx.trxId} كرسالة غير موثوقة وتوثيق ذلك في سجل الأمان`
          : `Transaction ${tx.trxId} flagged as rejected & logged.`
      );
      return;
    }
    showToast(
      await actionErrorMessage(
        res,
        'تعذر رفض العملية. لم يتم تغيير أي شيء، حاول مرة أخرى.',
        'Could not reject the transaction. Nothing was changed, please retry.'
      )
    );
  };

  const handleToggleDeviceStatus = async (deviceId: string) => {
    let res: Response | null = null;
    try {
      res = await apiFetch(`/api/v1/devices/${deviceId}/toggle`, { method: 'POST' });
    } catch {}
    if (res?.ok) {
      await refreshBackendData();
      return;
    }
    showToast(
      await actionErrorMessage(
        res,
        'تعذر تغيير حالة الجهاز. حاول مرة أخرى.',
        'Could not change the device status. Please retry.'
      )
    );
  };

  const handleToggleRailPause = async (sourceId: string) => {
    try {
      const res = await apiFetch(`/api/v1/sources/${sourceId}/toggle-pause`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Unable to update source status');
      }
      await refreshBackendData();
    } catch (err: any) {
      showToast(
        language === 'ar'
          ? err.message || 'تعذر تحديث حالة مصدر الاستقبال.'
          : err.message || 'Unable to update the receiving source.'
      );
    }
  };

  const handleSwitchWorkspace = async () => {
    if (userWorkspaces.length > 1) {
      const nextOrg = userWorkspaces.find((w) => w.id !== workspace?.id) || userWorkspaces[0];
      const updated = await authSwitchWorkspace(nextOrg.id);
      if (updated) {
        refreshBackendData();
        showToast(
          language === 'ar'
            ? `تم التبديل إلى: ${updated.nameAr || updated.name}`
            : `Switched to workspace: ${updated.name}`
        );
      }
    } else {
      showToast(
        language === 'ar'
          ? 'لديك مساحة عمل واحدة فقط مسجلة حالياً.'
          : 'You are currently in your primary workspace.'
      );
    }
  };

  // 1. Initial Authentication Loading State
  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-surface-container-lowest flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <span className="material-symbols-outlined text-4xl text-primary animate-spin">
            progress_activity
          </span>
          <span className="text-label-md font-semibold text-on-surface-variant">
            Sarraf Ops
          </span>
        </div>
      </div>
    );
  }

  // 2. Public Marketing Landing Page at '/'
  if (currentPath === '/') {
    return (
      <Suspense fallback={<ViewLoadingSkeleton />}>
        <LandingPageView
          language={language}
          onToggleLanguage={handleToggleLanguage}
          onNavigate={navigate}
          isLoggedIn={Boolean(hasSession && currentUser && workspace)}
          theme={theme}
          onToggleTheme={handleToggleTheme}
        />
      </Suspense>
    );
  }

  // 3. Public Auth Pages (/login, /signup)
  if (currentPath === '/login' || currentPath === '/signup') {
    if (hasSession && currentUser && workspace) {
      navigate('/app');
    } else {
      return (
        <AuthView
          initialTab={currentPath === '/signup' ? 'signup' : 'login'}
          onSuccess={handleAuthSuccess}
          language={language}
          onToggleLanguage={handleToggleLanguage}
          onNavigateHome={() => navigate('/')}
          theme={theme}
          onToggleTheme={handleToggleTheme}
        />
      );
    }
  }

  // 4. Public Email Verification
  if (currentPath === '/verify-email') {
    return (
      <Suspense fallback={<ViewLoadingSkeleton />}>
        <VerifyEmailView
          language={language}
          onNavigateHome={() => navigate('/')}
          onNavigateLogin={() => navigate('/login')}
          onNavigateApp={() => {
            navigate('/app');
            refreshBackendData();
          }}
        />
      </Suspense>
    );
  }

  // 5. Public Team Member Invite Acceptance
  if (currentPath.startsWith('/invite/')) {
    const inviteToken = currentPath.replace('/invite/', '').split('/')[0];
    return (
      <Suspense fallback={<ViewLoadingSkeleton />}>
        <InviteAcceptView
          token={inviteToken}
          language={language}
          onSuccess={handleAuthSuccess}
          onNavigateHome={() => navigate('/')}
          onNavigateLogin={() => navigate('/login')}
        />
      </Suspense>
    );
  }

  // 6. Protected Client Dashboard at '/app' (and any other authenticated view)
  if (!hasSession || !currentUser || !workspace) {
    return (
      <AuthView
        initialTab="login"
        onSuccess={handleAuthSuccess}
        language={language}
        onToggleLanguage={handleToggleLanguage}
        onNavigateHome={() => navigate('/')}
        theme={theme}
        onToggleTheme={handleToggleTheme}
      />
    );
  }

  const devicesOnlineCount = devices.filter((d) => d.status === 'online').length;
  const hasOfflineDevices = devices.some((d) => d.status === 'offline');

  return (
    <div className="min-h-screen bg-background text-on-surface antialiased flex flex-col font-sans selection:bg-surface-container-highest selection:text-primary">
      {/* TopAppBar */}
      <Header
        workspace={workspace}
        currentUser={currentUser}
        devicesOnlineCount={devicesOnlineCount}
        totalDevicesCount={devices.length}
        language={language}
        onToggleLanguage={handleToggleLanguage}
        onToggleDrawer={() => setIsDrawerOpen(true)}
        onOpenOnboarding={() => setIsOnboardingOpen(true)}
        onOpenSubscriptions={() => setCurrentTab('subscriptions')}
        onNavigateHome={() => navigate('/')}
        currentTab={currentTab}
        theme={theme}
        onToggleTheme={handleToggleTheme}
      />

      {/* Trial Active Banner */}
      {currentSub?.status === 'trial' && (
        currentSub.hoursRemaining !== undefined && currentSub.hoursRemaining <= 48 ? (
          <div className="bg-amber-500/10 border-b border-amber-500/30 text-on-surface px-4 py-2.5 text-label-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 max-w-7xl mx-auto w-full">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-600 text-lg shrink-0">timer</span>
              <div>
                <span className="font-bold text-amber-800 dark:text-amber-200">
                  {language === 'ar' ? 'تجربتك المجانية قربت تخلص' : 'Your Free Trial is Ending Soon'}
                </span>
                <span className="text-on-surface-variant text-xs ms-2">
                  {language === 'ar'
                    ? `(باقٍ ${currentSub.hoursRemaining} ساعة). نتمنى صرّاف يكون ساعدك تتابع تحويلاتك بشكل أوضح. اختار الباقة المناسبة قبل انتهاء التجربة عشان تستمر متابعة الرسائل الجديدة بدون توقف.`
                    : `(${currentSub.hoursRemaining} hours left). We hope Sarraf helped you monitor payments. Select a plan before expiration to continue uninterrupted.`}
                </span>
              </div>
            </div>
            <button
              onClick={() => setCurrentTab('subscriptions')}
              className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shrink-0 cursor-pointer shadow-xs active:scale-95 transition-all"
            >
              {language === 'ar' ? 'اختار باقتك' : 'Choose Plan'}
            </button>
          </div>
        ) : (
          <div className="bg-primary/10 border-b border-primary/20 text-on-surface px-4 py-2 text-label-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 max-w-7xl mx-auto w-full">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-base shrink-0">workspace_premium</span>
              <div>
                <span className="font-bold text-primary">
                  {language === 'ar' ? 'أنت الآن في تجربتك المجانية' : 'You are in Your Free Trial'}
                </span>
                <span className="text-on-surface-variant text-xs ms-2">
                  {language === 'ar'
                    ? `باقي لك ${currentSub.daysRemaining} يوماً لتجربة صرّاف مع هاتف واحد (ينتهي في ${formatDate(currentSub.endsAt, 'ar')}). اختار باقتك في أي وقت عشان تكمل متابعة شغلك.`
                    : `${currentSub.daysRemaining} days remaining for testing with 1 terminal (expires ${formatDate(currentSub.endsAt, 'en')}). Choose your plan anytime to keep tracking.`}
                </span>
              </div>
            </div>
            <button
              onClick={() => setCurrentTab('subscriptions')}
              className="px-3 py-1 rounded-lg bg-primary text-on-primary hover:bg-primary/90 font-bold text-xs shrink-0 cursor-pointer shadow-xs active:scale-95 transition-all"
            >
              {language === 'ar' ? 'شوف الباقات' : 'View Plans'}
            </button>
          </div>
        )
      )}

      {/* Trial Expired Notice */}
      {currentSub?.status === 'trial_expired' && (
        <div className="bg-error/10 border-b border-error/20 text-on-surface px-4 py-3 text-label-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 max-w-7xl mx-auto w-full">
          <div className="flex items-start gap-2.5">
            <span className="material-symbols-outlined text-error text-xl shrink-0 mt-0.5">error_outline</span>
            <div>
              <span className="font-bold text-error text-sm block">
                {language === 'ar' ? 'تجربتك خلصت… كمّل مع صرّاف' : 'Your Free Trial Has Ended… Continue with Sarraf'}
              </span>
              <p className="text-body-xs text-on-surface-variant mt-0.5">
                {language === 'ar'
                  ? 'انتهت فترة التجربة المجانية. بياناتك السابقة محفوظة حسب سياسة الاحتفاظ، وتقدر تختار باقة وتكمل استخدام النظام من نفس الحساب. المتابعة ومعالجة الرسائل الجديدة متوقفة حتى تفعيل الاشتراك.'
                  : 'Your free trial has ended. Your historical records and devices remain preserved under our retention policy. Select a plan to resume real-time payment ingestion.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
            <button
              onClick={() => setCurrentTab('subscriptions')}
              className="px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-container text-on-surface font-semibold text-xs border border-outline-variant cursor-pointer transition-all"
            >
              {language === 'ar' ? 'قارن الباقات' : 'Compare Plans'}
            </button>
            <button
              onClick={() => setCurrentTab('subscriptions')}
              className="px-4 py-1.5 rounded-lg bg-primary text-on-primary hover:bg-primary/90 font-bold text-xs cursor-pointer shadow-xs active:scale-95 transition-all"
            >
              {language === 'ar' ? 'اشترك الآن' : 'Subscribe Now'}
            </button>
          </div>
        </div>
      )}

      {/* Email Verification Banner */}
      {currentUser.emailVerified === false && (
        <div className="bg-primary/10 border-b border-primary/20 text-primary px-4 py-2 text-label-sm flex items-center justify-between gap-2 max-w-7xl mx-auto w-full">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-base">mark_email_unread</span>
            <span>
              {language === 'ar'
                ? `يرجى تأكيد بريدك الإلكتروني (${currentUser.email}) لضمان استلام تقارير وتنبيهات الأمان.`
                : `Please verify your email address (${currentUser.email}) to receive critical security alerts.`}
            </span>
          </div>
          <button
            onClick={async () => {
              try {
                const res = await apiFetch('/api/v1/auth/resend-verification', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email: currentUser.email }),
                });
                if (res.ok) {
                  showToast(
                    language === 'ar'
                      ? 'تم إرسال رابط تأكيد البريد الإلكتروني بنجاح.'
                      : 'Verification link sent to your inbox.'
                  );
                  return;
                }
              } catch {}
              showToast(
                language === 'ar'
                  ? 'تعذر إرسال رابط التأكيد الآن. حاول مرة أخرى بعد قليل.'
                  : 'Could not send the verification link. Please try again shortly.'
              );
            }}
            className="underline hover:text-primary/80 font-bold shrink-0 cursor-pointer"
          >
            {language === 'ar' ? 'إعادة الإرسال' : 'Resend Link'}
          </button>
        </div>
      )}

      {/* Main View Router */}
      <main className="flex-1">
        {currentTab === 'dashboard' && (
          <DashboardView
            transactions={transactions}
            devices={devices}
            rails={rails}
            onSelectTransaction={(tx) => {
              setSelectedTransaction(tx);
              setCurrentTab('ledger');
            }}
            onOpenReview={(tx) => setReviewingTransaction(tx)}
            onInspectDevice={(_dev) => setCurrentTab('devices')}
            onOpenLedger={() => setCurrentTab('ledger')}
            language={language}
          />
        )}

        {currentTab === 'ledger' && (
          <LedgerView
            transactions={transactions}
            selectedTransaction={selectedTransaction}
            onSelectTransaction={(tx) => setSelectedTransaction(tx)}
            onOpenReview={(tx) => setReviewingTransaction(tx)}
            onConfirmTransaction={(tx) => handleApproveTransaction(tx)}
            language={language}
          />
        )}

        {currentTab === 'analytics' && (
          <AnalyticsView
            transactions={transactions}
            devices={devices}
            rails={rails}
            language={language}
            showToast={showToast}
            currentUser={currentUser}
            workspace={workspace}
          />
        )}

        {currentTab === 'devices' && (
          <DevicesView
            devices={devices}
            onToggleDeviceStatus={handleToggleDeviceStatus}
            onOpenPairDevice={() => setIsPairingOpen(true)}
            language={language}
          />
        )}

        {currentTab === 'rails' && (
          <RailsView
            rails={rails}
            onUpdateRails={(updated) => setRails(updated)}
            onTogglePause={handleToggleRailPause}
            onOpenAddSource={() => setIsAddSourceOpen(true)}
            language={language}
          />
        )}

        <Suspense fallback={<ViewLoadingSkeleton />}>
          {currentTab === 'audit' && <AuditLogsView language={language} />}

          {currentTab === 'settings' && (
            <SettingsView
              workspace={workspace}
              currentUser={currentUser}
              onUpdateWorkspace={(updated) => {
                setWorkspace((prev) => (prev ? { ...prev, ...updated } : null));
              }}
              onNavigateToSubscriptions={() => setCurrentTab('subscriptions')}
              language={language}
              theme={theme}
              onToggleTheme={handleToggleTheme}
            />
          )}

          {currentTab === 'subscriptions' && (
            <SubscriptionsView
              language={language}
              onNavigateToTab={(tab) => setCurrentTab(tab)}
              showToast={showToast}
            />
          )}

          {currentTab === 'platform' && currentUser.isPlatformAdmin && (
            <PlatformDashboardView
              language={language}
              showToast={showToast}
            />
          )}
        </Suspense>
      </main>

      {/* Navigation Slide-out Drawer */}
      <NavigationDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        workspace={workspace}
        currentUser={currentUser}
        devicesOnlineCount={devicesOnlineCount}
        totalDevicesCount={devices.length}
        currentTab={currentTab}
        onSelectTab={(tab) => setCurrentTab(tab)}
        onOpenOnboarding={() => setIsOnboardingOpen(true)}
        onSwitchWorkspace={handleSwitchWorkspace}
        onLogout={handleLogout}
        language={language}
        theme={theme}
        onToggleTheme={handleToggleTheme}
      />

      {/* Bottom Navigation Bar */}
      <BottomNavBar
        currentTab={currentTab}
        onSelectTab={(tab) => setCurrentTab(tab)}
        hasOfflineDevices={hasOfflineDevices}
        language={language}
      />

      {/* Operator Review & Verification Modal */}
      {reviewingTransaction && (
        <ReviewModal
          transaction={reviewingTransaction}
          onClose={() => setReviewingTransaction(null)}
          onApprove={handleApproveTransaction}
          onReject={handleRejectTransaction}
          language={language}
        />
      )}

      {/* Client Onboarding Guide / Launchpad Modal */}
      <OnboardingGuideModal
        isOpen={isOnboardingOpen}
        onClose={dismissOnboarding}
        workspace={workspace}
        rails={rails}
        devices={devices}
        transactionsCount={transactions.length}
        onOpenAddSource={() => setIsAddSourceOpen(true)}
        onOpenPairDevice={() => setIsPairingOpen(true)}
        onOpenSettings={() => setCurrentTab('settings')}
        onNavigateTab={(tab) => setCurrentTab(tab)}
        language={language}
      />

      {/* Pair New Device Modal */}
      <PairingModal
        isOpen={isPairingOpen}
        onClose={() => setIsPairingOpen(false)}
        onDevicePaired={(newDev) => {
          setDevices((prev) => [newDev, ...prev]);
          refreshBackendData();
          showToast(
            language === 'ar'
              ? `تم إصدار كود الاقتران بنجاح للجهاز: ${newDev.name}`
              : `Device registered: ${newDev.name}`
          );
        }}
        rails={rails}
        language={language}
      />

      {/* Add Receiving Payment Source Modal */}
      <AddSourceModal
        isOpen={isAddSourceOpen}
        onClose={() => setIsAddSourceOpen(false)}
        onSourceAdded={(newRail) => {
          setRails((prev) => [newRail, ...prev]);
          refreshBackendData();
          showToast(
            language === 'ar'
              ? `تم إضافة مسار الاستقبال بنجاح: ${newRail.name}`
              : `Receiving source added: ${newRail.name}`
          );
        }}
        language={language}
      />

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-20 sm:bottom-8 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-surface-container-lowest/95 dark:bg-surface-container-high/95 backdrop-blur-md text-on-surface rounded-2xl shadow-xl text-label-md flex items-center gap-2.5 border border-outline-variant shadow-primary/5 animate-slide-down-fade max-w-[90vw]">
          <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-sm">
              notifications_active
            </span>
          </div>
          <span className="font-semibold text-body-sm">{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
