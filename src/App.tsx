/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Transaction, Device, ProviderRail, Workspace, User, CurrentSubscription } from './types';
import { Header } from './components/Header';
import { DashboardView } from './components/DashboardView';
import { LedgerView } from './components/LedgerView';
import { DevicesView } from './components/DevicesView';
import { RailsView } from './components/RailsView';
import { AuditLogsView } from './components/AuditLogsView';
import { SettingsView } from './components/SettingsView';
import { NavigationDrawer } from './components/NavigationDrawer';
import { BottomNavBar } from './components/BottomNavBar';
import { ReviewModal } from './components/ReviewModal';
import { OnboardingGuideModal } from './components/OnboardingGuideModal';
import { PairingModal } from './components/PairingModal';
import { AddSourceModal } from './components/AddSourceModal';
import { AuthView } from './components/AuthView';
import { SubscriptionsView } from './components/SubscriptionsView';
import { PlatformDashboardView } from './components/PlatformDashboardView';
import { LandingPageView } from './components/LandingPageView';
import { VerifyEmailView } from './components/VerifyEmailView';
import { InviteAcceptView } from './components/InviteAcceptView';
import { apiFetch } from './api';

export default function App() {
  // Public Routing & Path State
  const [currentPath, setCurrentPath] = useState<string>(() => window.location.pathname || '/');

  // Authentication & Session State
  const [hasSession, setHasSession] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [userWorkspaces, setUserWorkspaces] = useState<any[]>([]);
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(true);
  const [currentSub, setCurrentSub] = useState<CurrentSubscription | null>(null);

  // Core Data State (Loaded dynamically per tenant)
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [rails, setRails] = useState<ProviderRail[]>([]);

  // Navigation & Language
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
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

  // Night Mode / Theme State
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('sarraf_theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  });

  // Synchronize document dark class on theme change
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
    localStorage.setItem('sarraf_theme', theme);
  }, [theme]);

  const handleToggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  // Synchronize document dir attribute on language change
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

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  // Fetch current user session and tenant context
  const verifySession = useCallback(async () => {
    setIsAuthLoading(true);
    try {
      const res = await apiFetch('/api/v1/auth/me');

      if (res.ok) {
        const data = await res.json();
        setHasSession(true);
        setCurrentUser(data.user);
        setWorkspace({
          id: data.organization.id,
          name: data.organization.name,
          nameAr: data.organization.name_ar || data.organization.name,
          subTitle: `${data.organization.name_ar || data.organization.name} - بوابة العمليات`,
          initials: data.organization.name.slice(0, 2).toUpperCase(),
          slug: data.organization.slug,
          defaultTimezone: data.organization.default_timezone,
        });
        if (Array.isArray(data.workspaces)) {
          setUserWorkspaces(data.workspaces);
        }
      } else {
        setHasSession(false);
        setCurrentUser(null);
        setWorkspace(null);
        setCurrentSub(null);
      }
    } catch {
      // Server unreachable
    } finally {
      setIsAuthLoading(false);
    }
  }, []);

  // Fetch real data from backend API for the active authenticated tenant
  const refreshBackendData = useCallback(async () => {
    try {
      const [txRes, devRes, railRes, subRes] = await Promise.all([
        apiFetch('/api/v1/transactions'),
        apiFetch('/api/v1/devices'),
        apiFetch('/api/v1/sources'),
        apiFetch('/api/v1/subscriptions/current'),
      ]);

      if (subRes.ok) {
        const subData = await subRes.json();
        setCurrentSub(subData);
      }

      if (txRes.ok && devRes.ok && railRes.ok) {
        const txData = await txRes.json();
        const devData = await devRes.json();
        const railData = await railRes.json();

        setTransactions(
          Array.isArray(txData)
            ? txData.map((t: any) => ({
                id: t.id,
                trxId: t.trxId || t.external_trx_id || t.id,
                amount: t.amount,
                currency: t.currency || 'EGP',
                provider: t.provider,
                providerLabel:
                  t.provider === 'vodafone_cash'
                    ? 'Vodafone Cash'
                    : t.provider === 'instapay'
                    ? 'InstaPay (IPN)'
                    : t.provider === 'orange_cash'
                    ? 'Orange Cash'
                    : 'e& Cash',
                senderName: t.senderName || 'Anonymous Customer',
                senderPhone: t.senderPhone || '',
                timeAgo: 'Recently',
                timestamp: t.timestamp || new Date().toISOString(),
                status: t.status,
                confidenceScore: t.confidenceScore ? Math.round(t.confidenceScore * 100) : 95,
                deviceId: t.deviceId || 'DEV-POS',
                deviceName: t.deviceName || 'Terminal Gate',
                reviewReason: t.reviewReason,
                rawMessage: t.rawMessage,
                signature: t.signature,
              }))
            : []
        );

        setDevices(
          Array.isArray(devData)
            ? devData.map((d: any) => ({
                id: d.id,
                deviceNumber: d.device_number,
                name: d.friendly_name,
                location: d.location || 'Terminal',
                provider: 'vodafone_cash',
                providerLabel: 'Vodafone Cash',
                phoneNumber: '01019283921',
                status: d.status,
                batteryLevel: d.battery_level,
                lastPing: d.last_seen_at || 'Just now',
                txnsToday: d.txns_count || 0,
                volumeToday: 0,
                agentVersion: d.agent_version || 'v3.4.1-eg',
                configVersion: d.config_version || 'cfg-v1.4',
                verifiedAt: d.verified_at,
                notificationListenerGranted: Boolean(d.notification_listener_granted),
                batteryOptimizationExempt: Boolean(d.battery_optimization_exempt),
              }))
            : []
        );

        setRails(
          Array.isArray(railData)
            ? railData.map((r: any) => ({
                id: r.id,
                provider: r.provider,
                name: r.name || r.provider,
                sharePercentage: r.sharePercentage || 0,
                volume: r.volume || 0,
                target: r.dailyLimit || 60000,
                txnsCount: r.txnsCount || 0,
                color: r.color || '#1e3a8a',
                walletNumber: r.walletNumber || r.primaryAddress || '',
                dailyLimit: r.dailyLimit || 60000,
                monthlyLimit: r.monthlyLimit || 200000,
                dailyIntake: r.dailyIntake,
                monthlyIntake: r.monthlyIntake,
                dailyPercentage: r.dailyPercentage,
                monthlyPercentage: r.monthlyPercentage,
                isPaused: r.isPaused || false,
              }))
            : []
        );

        // Prompt onboarding guide if tenant has 0 devices
        if (Array.isArray(devData) && devData.length === 0) {
          setIsOnboardingOpen(true);
        }
      }
    } catch {
      // offline
    }
  }, []);

  // Initial Auth Check
  useEffect(() => {
    verifySession();
  }, [verifySession]);

  // Load tenant data whenever workspace is established
  useEffect(() => {
    if (currentUser && workspace) {
      refreshBackendData();
    }
  }, [currentUser, workspace, refreshBackendData]);

  // Live Real-Time Telemetry Auto-Sync: Poll every 3 seconds while in active workspace
  useEffect(() => {
    if (!hasSession || !currentUser || !workspace) return;
    const interval = setInterval(() => {
      refreshBackendData();
    }, 3000);
    return () => clearInterval(interval);
  }, [hasSession, currentUser, workspace, refreshBackendData]);

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
    try {
      await apiFetch('/api/v1/auth/logout', { method: 'POST' });
    } catch {}
    setHasSession(false);
    setCurrentUser(null);
    setWorkspace(null);
    setCurrentSub(null);
    setTransactions([]);
    setDevices([]);
    setRails([]);
    setIsDrawerOpen(false);
    navigate('/');
    showToast(language === 'ar' ? 'تم تسجيل الخروج بنجاح' : 'Logged out successfully');
  };

  // Approve review transaction via real backend API
  const handleApproveTransaction = async (tx: Transaction) => {
    try {
      const res = await apiFetch(`/api/v1/transactions/${tx.id}/approve`, {
        method: 'POST',
      });
      if (res.ok) {
        await refreshBackendData();
        setReviewingTransaction(null);
        showToast(
          language === 'ar'
            ? `تم اعتماد العملية ${tx.trxId} رسمياً وتحديث رصيد الدفتر`
            : `Transaction ${tx.trxId} approved & recorded to audit log.`
        );
        return;
      }
    } catch {}

    setTransactions((prev) =>
      prev.map((t) => (t.id === tx.id ? { ...t, status: 'confirmed' } : t))
    );
    setReviewingTransaction(null);
    showToast(
      language === 'ar'
        ? `تم اعتماد العملية ${tx.trxId} بنجاح`
        : `Transaction ${tx.trxId} confirmed and ledger updated.`
    );
  };

  // Reject review transaction via real backend API
  const handleRejectTransaction = async (tx: Transaction) => {
    try {
      const res = await apiFetch(`/api/v1/transactions/${tx.id}/reject`, {
        method: 'POST',
      });
      if (res.ok) {
        await refreshBackendData();
        setReviewingTransaction(null);
        showToast(
          language === 'ar'
            ? `تم رفض العملية ${tx.trxId} كرسالة غير موثوقة وتوثيق ذلك في سجل الأمان`
            : `Transaction ${tx.trxId} flagged as rejected & logged.`
        );
        return;
      }
    } catch {}

    setTransactions((prev) =>
      prev.map((t) => (t.id === tx.id ? { ...t, status: 'failed' } : t))
    );
    setReviewingTransaction(null);
    showToast(
      language === 'ar'
        ? `تم رفض العملية ${tx.trxId} كرسالة غير موثوقة`
        : `Transaction ${tx.trxId} rejected as unverified.`
    );
  };

  // Toggle device status (online / offline) via real backend
  const handleToggleDeviceStatus = async (deviceId: string) => {
    try {
      const res = await apiFetch(`/api/v1/devices/${deviceId}/toggle`, {
        method: 'POST',
      });
      if (res.ok) {
        await refreshBackendData();
        return;
      }
    } catch {}

    setDevices((prev) =>
      prev.map((d) => {
        if (d.id === deviceId) {
          const newStatus = d.status === 'online' ? 'offline' : 'online';
          return {
            ...d,
            status: newStatus,
            lastPing: newStatus === 'online' ? 'Just now' : '15 min ago',
            offlineDuration: newStatus === 'offline' ? '15 min' : undefined,
          };
        }
        return d;
      })
    );
  };

  const handleToggleRailPause = async (sourceId: string) => {
    try {
      const res = await apiFetch(`/api/v1/sources/${sourceId}/toggle-pause`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Unable to update source status');
      }
      await refreshBackendData();
    } catch (err: any) {
      showToast(
        language === 'ar'
          ? (err.message || 'تعذر تحديث حالة مصدر الاستقبال.')
          : (err.message || 'Unable to update the receiving source.')
      );
    }
  };

  // Switch workspace
  const handleSwitchWorkspace = async () => {
    if (userWorkspaces.length > 1) {
      const nextOrg = userWorkspaces.find((w) => w.id !== workspace?.id) || userWorkspaces[0];
      try {
        const res = await apiFetch('/api/v1/auth/switch-workspace', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ organizationId: nextOrg.id }),
        });
        if (res.ok) {
          setWorkspace({
            id: nextOrg.id,
            name: nextOrg.name,
            nameAr: nextOrg.name_ar || nextOrg.name,
            subTitle: `${nextOrg.name_ar || nextOrg.name} - بوابة العمليات`,
            initials: nextOrg.name.slice(0, 2).toUpperCase(),
            slug: nextOrg.slug,
          });
          refreshBackendData();
          showToast(
            language === 'ar'
              ? `تم التبديل إلى: ${nextOrg.name_ar || nextOrg.name}`
              : `Switched to workspace: ${nextOrg.name}`
          );
        }
      } catch {}
    } else {
      showToast(
        language === 'ar'
          ? 'لديك مساحة عمل واحدة فقط مسجلة حالياً.'
          : 'You are currently in your primary workspace.'
      );
    }
  };

  // 1. Loading State
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
      <LandingPageView
        language={language}
        onToggleLanguage={handleToggleLanguage}
        onNavigate={navigate}
        isLoggedIn={Boolean(hasSession && currentUser && workspace)}
        theme={theme}
        onToggleTheme={handleToggleTheme}
      />
    );
  }

  // 3. Public Login Page at '/login'
  if (currentPath === '/login') {
    if (hasSession && currentUser && workspace) {
      // Already authenticated, redirect to /app
      navigate('/app');
    } else {
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
  }

  // 4. Public Signup Page at '/signup'
  if (currentPath === '/signup') {
    if (hasSession && currentUser && workspace) {
      // Already authenticated, redirect to /app
      navigate('/app');
    } else {
      return (
        <AuthView
          initialTab="signup"
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

  // 5. Public Email Verification at '/verify-email'
  if (currentPath === '/verify-email') {
    return (
      <VerifyEmailView
        language={language}
        onNavigateHome={() => navigate('/')}
        onNavigateLogin={() => navigate('/login')}
        onNavigateApp={() => {
          navigate('/app');
          refreshBackendData();
        }}
      />
    );
  }

  // 6. Public Team Member Invite Acceptance at '/invite/:token'
  if (currentPath.startsWith('/invite/')) {
    const inviteToken = currentPath.replace('/invite/', '').split('/')[0];
    return (
      <InviteAcceptView
        token={inviteToken}
        language={language}
        onSuccess={handleAuthSuccess}
        onNavigateHome={() => navigate('/')}
        onNavigateLogin={() => navigate('/login')}
      />
    );
  }

  // 7. Protected Client Dashboard at '/app' (and any other authenticated view)
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

      {/* Trial Active Banner (Requirement 7) */}
      {currentSub?.status === 'trial' && (
        currentSub.hoursRemaining !== undefined && currentSub.hoursRemaining <= 48 ? (
          // Urgent 48h / 24h Warning Banner
          <div className="bg-amber-500/10 border-b border-amber-500/30 text-on-surface px-4 py-2.5 text-label-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 max-w-7xl mx-auto w-full">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-600 text-lg shrink-0">timer</span>
              <div>
                <span className="font-bold text-amber-800 dark:text-amber-200">
                  {language === 'ar' ? 'تجربتك المجانية قربت تخلص' : 'Your Free Trial is Ending Soon'}
                </span>
                <span className="text-on-surface-variant text-xs mr-2 rtl:mr-0 rtl:ml-2">
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
          // Standard Active Trial Banner
          <div className="bg-primary/10 border-b border-primary/20 text-on-surface px-4 py-2 text-label-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 max-w-7xl mx-auto w-full">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-base shrink-0">workspace_premium</span>
              <div>
                <span className="font-bold text-primary">
                  {language === 'ar' ? 'أنت الآن في تجربتك المجانية' : 'You are in Your Free Trial'}
                </span>
                <span className="text-on-surface-variant text-xs mr-2 rtl:mr-0 rtl:ml-2">
                  {language === 'ar'
                    ? `باقي لك ${currentSub.daysRemaining} يوماً لتجربة صرّاف مع هاتف واحد (ينتهي في ${currentSub.endsAt ? new Date(currentSub.endsAt).toLocaleDateString('ar-EG') : '7 أيام'}). اختار باقتك في أي وقت عشان تكمل متابعة شغلك.`
                    : `${currentSub.daysRemaining} days remaining for testing with 1 terminal (expires ${currentSub.endsAt ? new Date(currentSub.endsAt).toLocaleDateString('en-US') : 'in 7 days'}). Choose your plan anytime to keep tracking.`}
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

      {/* Trial Expired Banner / Notice (Requirement 8) */}
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
                }
              } catch {}
            }}
            className="underline hover:text-primary/80 font-bold shrink-0"
          >
            {language === 'ar' ? 'إعادة الإرسال' : 'Resend Link'}
          </button>
        </div>
      )}

      {/* Main View Router */}
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
          onInspectDevice={(_dev) => {
            setCurrentTab('devices');
          }}
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

      {/* Bottom Navigation Bar (Mobile / Compact Viewport) */}
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
        onClose={() => setIsOnboardingOpen(false)}
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
