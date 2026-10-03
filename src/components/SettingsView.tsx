import React, { useState, useEffect } from 'react';
import { Workspace, User, TeamMember, CurrentSubscription } from '../types';

interface SettingsViewProps {
  workspace: Workspace;
  currentUser: User;
  onUpdateWorkspace: (updated: Partial<Workspace>) => void;
  onNavigateToSubscriptions?: () => void;
  language: 'en' | 'ar';
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  workspace,
  currentUser,
  onUpdateWorkspace,
  onNavigateToSubscriptions,
  language,
  theme,
  onToggleTheme,
}) => {
  const [activeTab, setActiveTab] = useState<'workspace' | 'team' | 'plan' | 'integrations'>('workspace');
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [currentSub, setCurrentSub] = useState<CurrentSubscription | null>(null);
  const [loadingSub, setLoadingSub] = useState(false);

  // Workspace form state
  const [orgName, setOrgName] = useState(workspace.name);
  const [orgNameAr, setOrgNameAr] = useState(workspace.nameAr);
  const [timezone, setTimezone] = useState(workspace.defaultTimezone || 'Africa/Cairo');
  const [savingOrg, setSavingOrg] = useState(false);
  const [orgSaveSuccess, setOrgSaveSuccess] = useState(false);

  // Invite member form state
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'manager' | 'viewer'>('manager');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [issuedInvite, setIssuedInvite] = useState<{
    token: string;
    email: string;
    role: string;
    link: string;
    expiresAt: string;
  } | null>(null);
  const [pendingInvitations, setPendingInvitations] = useState<any[]>([]);
  const [loadingInvitations, setLoadingInvitations] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // Integrations state (Clean initialized, loaded from server)
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [savingIntegrations, setSavingIntegrations] = useState(false);
  const [integrationsSaved, setIntegrationsSaved] = useState(false);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/v1/organizations/settings', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('sarraf_session_token') || ''}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.name) setOrgName(data.name);
        if (data.nameAr) setOrgNameAr(data.nameAr);
        if (data.defaultTimezone) setTimezone(data.defaultTimezone);
        if (data.telegramBotToken) setTelegramBotToken(data.telegramBotToken);
        if (data.telegramChatId) setTelegramChatId(data.telegramChatId);
        if (data.webhookUrl) setWebhookUrl(data.webhookUrl);
        if (data.webhookSecret) setWebhookSecret(data.webhookSecret);
      }
    } catch {}
  };

  const fetchMembers = async () => {
    setLoadingMembers(true);
    try {
      const res = await fetch('/api/v1/organizations/members', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('sarraf_session_token') || ''}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setMembers(data);
      }
    } catch {
      // offline fallback
    } finally {
      setLoadingMembers(false);
    }
  };

  const fetchInvitations = async () => {
    if (!['owner', 'admin'].includes(currentUser.role)) return;
    setLoadingInvitations(true);
    try {
      const res = await fetch('/api/v1/organizations/members/invitations', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('sarraf_session_token') || ''}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setPendingInvitations(Array.isArray(data) ? data : []);
      }
    } catch {} finally {
      setLoadingInvitations(false);
    }
  };

  const fetchSubscription = async () => {
    setLoadingSub(true);
    try {
      const res = await fetch('/api/v1/subscriptions/current', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('sarraf_session_token') || ''}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setCurrentSub(data);
      }
    } catch {} finally {
      setLoadingSub(false);
    }
  };

  useEffect(() => {
    fetchSettings();
    fetchSubscription();
  }, []);

  useEffect(() => {
    if (activeTab === 'team') {
      fetchMembers();
      fetchInvitations();
    } else if (activeTab === 'plan') {
      fetchSubscription();
    }
  }, [activeTab]);

  const handleSaveWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingOrg(true);
    setOrgSaveSuccess(false);

    try {
      const res = await fetch('/api/v1/organizations/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('sarraf_session_token') || ''}`,
        },
        body: JSON.stringify({
          name: orgName,
          nameAr: orgNameAr,
          defaultTimezone: timezone,
        }),
      });

      if (res.ok) {
        onUpdateWorkspace({ name: orgName, nameAr: orgNameAr, defaultTimezone: timezone });
        setOrgSaveSuccess(true);
        setTimeout(() => setOrgSaveSuccess(false), 3000);
      }
    } catch {
      // error
    } finally {
      setSavingOrg(false);
    }
  };

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    setInviteError(null);

    try {
      const res = await fetch('/api/v1/organizations/members/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('sarraf_session_token') || ''}`,
        },
        body: JSON.stringify({
          email: inviteEmail,
          fullName: inviteName,
          role: inviteRole,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Invitation failed');
      }

      setIssuedInvite({
        token: data.inviteToken,
        email: data.email,
        role: data.role,
        link: `${window.location.origin}/invite/${data.inviteToken}`,
        expiresAt: data.expiresAt,
      });
      setInviteEmail('');
      setInviteName('');
      fetchMembers();
      fetchInvitations();
    } catch (err: any) {
      setInviteError(err.message);
    } finally {
      setInviting(false);
    }
  };

  const handleSaveIntegrations = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingIntegrations(true);
    setIntegrationsSaved(false);
    try {
      const res = await fetch('/api/v1/organizations/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('sarraf_session_token') || ''}`,
        },
        body: JSON.stringify({
          telegramBotToken,
          telegramChatId,
          webhookUrl,
          webhookSecret,
        }),
      });
      if (res.ok) {
        setIntegrationsSaved(true);
        setTimeout(() => setIntegrationsSaved(false), 3500);
      }
    } catch {} finally {
      setSavingIntegrations(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-margin-mobile py-6 space-y-6 pt-16 pb-24">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-outline-variant">
        <div>
          <h1 className="text-title-lg font-bold text-on-surface">
            {language === 'ar' ? 'إعدادات المؤسسة والحساب' : 'Workspace & Account Settings'}
          </h1>
          <p className="text-body-sm text-on-surface-variant">
            {language === 'ar'
              ? 'إدارة النشاط التجاري، أعضاء الفريق، الصلاحيات، والتنبيهات الآلية'
              : 'Manage organization profile, team RBAC, regulatory limit alerts, and webhooks'}
          </p>
        </div>

        {/* Tab Selector */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-container-low border border-outline-variant">
          <button
            onClick={() => setActiveTab('workspace')}
            className={`px-3 py-1.5 rounded-lg text-label-md font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === 'workspace'
                ? 'bg-surface-container-lowest text-primary shadow-xs'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-base">domain</span>
            <span>{language === 'ar' ? 'المؤسسة' : 'Workspace'}</span>
          </button>

          <button
            onClick={() => setActiveTab('team')}
            className={`px-3 py-1.5 rounded-lg text-label-md font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === 'team'
                ? 'bg-surface-container-lowest text-primary shadow-xs'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-base">group</span>
            <span>{language === 'ar' ? 'فريق العمل' : 'Team'}</span>
          </button>

          <button
            onClick={() => setActiveTab('plan')}
            className={`px-3 py-1.5 rounded-lg text-label-md font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === 'plan'
                ? 'bg-surface-container-lowest text-primary shadow-xs'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-base">credit_card</span>
            <span>{language === 'ar' ? 'الاشتراك' : 'Plan'}</span>
          </button>

          <button
            onClick={() => setActiveTab('integrations')}
            className={`px-3 py-1.5 rounded-lg text-label-md font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === 'integrations'
                ? 'bg-surface-container-lowest text-primary shadow-xs'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-base">webhook</span>
            <span>{language === 'ar' ? 'التكاملات' : 'Integrations'}</span>
          </button>
        </div>
      </div>

      {/* TAB 1: WORKSPACE PROFILE */}
      {activeTab === 'workspace' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 shadow-xs space-y-6">
            <h2 className="text-title-md font-bold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">storefront</span>
              <span>{language === 'ar' ? 'بيانات التاجر والمؤسسة' : 'Merchant Business Profile'}</span>
            </h2>

            {orgSaveSuccess && (
              <div className="p-3 rounded-lg bg-primary/10 border border-primary/20 text-primary text-body-sm flex items-center gap-2">
                <span className="material-symbols-outlined text-base">check_circle</span>
                <span>{language === 'ar' ? 'تم حفظ التعديلات بنجاح' : 'Settings saved successfully.'}</span>
              </div>
            )}

            <form onSubmit={handleSaveWorkspace} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-label-md text-on-surface font-medium mb-1.5">
                    {language === 'ar' ? 'اسم المؤسسة (English)' : 'Business Name (English)'}
                  </label>
                  <input
                    type="text"
                    required
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-body-md focus:ring-2 focus:ring-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-label-md text-on-surface font-medium mb-1.5">
                    {language === 'ar' ? 'اسم المؤسسة (بالعربية)' : 'Business Name (Arabic)'}
                  </label>
                  <input
                    type="text"
                    required
                    value={orgNameAr}
                    onChange={(e) => setOrgNameAr(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-body-md focus:ring-2 focus:ring-primary focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-label-md text-on-surface font-medium mb-1.5">
                  {language === 'ar' ? 'معرّف مساحة العمل (Slug)' : 'Workspace Identifier (Slug)'}
                </label>
                <input
                  type="text"
                  disabled
                  value={workspace.slug || workspace.id}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-outline-variant bg-surface-container-low text-on-surface-variant text-body-md font-code-num cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-label-md text-on-surface font-medium mb-1.5">
                  {language === 'ar' ? 'المنطقة الزمنية القياسية' : 'Standard Accounting Timezone'}
                </label>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-body-md focus:ring-2 focus:ring-primary focus:outline-none"
                >
                  <option value="Africa/Cairo">Africa/Cairo (EET/EEST, GMT+2 / GMT+3)</option>
                  <option value="UTC">UTC (Universal Time Coordinated)</option>
                </select>
                <p className="text-label-sm text-on-surface-variant mt-1">
                  {language === 'ar'
                    ? 'يتم احتساب حدود الدوران اليومية والشهرية للبنك المركزي بناءً على توقيت القاهرة.'
                    : 'Central Bank of Egypt (CBE) daily and monthly turnover resets at midnight Cairo Time.'}
                </p>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={savingOrg}
                  className="px-5 py-2.5 rounded-lg bg-primary text-on-primary text-label-md font-semibold hover:bg-primary/90 transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  {savingOrg ? (
                    <span className="material-symbols-outlined animate-spin text-base">progress_activity</span>
                  ) : (
                    <span className="material-symbols-outlined text-base">save</span>
                  )}
                  <span>{language === 'ar' ? 'حفظ التعديلات' : 'Save Changes'}</span>
                </button>
              </div>
            </form>
          </div>

          {/* Theme & Display Appearance Card */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 shadow-xs space-y-4">
            <h3 className="text-title-sm font-bold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">palette</span>
              <span>{language === 'ar' ? 'مظهر وتخصيص الواجهة' : 'Appearance & Theme'}</span>
            </h3>

            <p className="text-body-sm text-on-surface-variant">
              {language === 'ar'
                ? 'اختر مظهر العرض المفضل لديك للوحة التحكم، يدعم الوضع الليلي لراحة العين أثناء العمل المطول.'
                : 'Select your preferred visual appearance across the platform. Night mode reduces eye strain during extended work.'}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <button
                type="button"
                onClick={() => {
                  if (theme === 'dark' && onToggleTheme) onToggleTheme();
                }}
                className={`p-4 rounded-xl border flex items-center justify-between transition-all cursor-pointer ${
                  theme === 'light'
                    ? 'border-primary bg-primary/5 text-primary shadow-xs ring-1 ring-primary'
                    : 'border-outline-variant bg-surface-container-low text-on-surface hover:bg-surface-container'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-2xl text-amber-500">light_mode</span>
                  <div className="text-left rtl:text-right">
                    <span className="font-bold text-label-md block">
                      {language === 'ar' ? 'الوضع النهاري' : 'Light Mode'}
                    </span>
                    <span className="text-label-xs text-on-surface-variant">
                      {language === 'ar' ? 'إضاءة واضحة ومتباينة' : 'Bright daylight theme'}
                    </span>
                  </div>
                </div>
                {theme === 'light' && (
                  <span className="material-symbols-outlined text-primary text-xl">check_circle</span>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  if (theme === 'light' && onToggleTheme) onToggleTheme();
                }}
                className={`p-4 rounded-xl border flex items-center justify-between transition-all cursor-pointer ${
                  theme === 'dark'
                    ? 'border-primary bg-primary/10 text-primary shadow-xs ring-1 ring-primary'
                    : 'border-outline-variant bg-surface-container-low text-on-surface hover:bg-surface-container'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-2xl text-indigo-400">dark_mode</span>
                  <div className="text-left rtl:text-right">
                    <span className="font-bold text-label-md block">
                      {language === 'ar' ? 'الوضع الليلي (Night Mode)' : 'Night / Dark Mode'}
                    </span>
                    <span className="text-label-xs text-on-surface-variant">
                      {language === 'ar' ? 'مريح للعين أثناء العمل والمتابعة المسائية' : 'Low-strain dark palette for nighttime operations'}
                    </span>
                  </div>
                </div>
                {theme === 'dark' && (
                  <span className="material-symbols-outlined text-primary text-xl">check_circle</span>
                )}
              </button>
            </div>
          </div>

          {/* User Account Info Card */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 shadow-xs space-y-4">
            <h3 className="text-title-sm font-bold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">person</span>
              <span>{language === 'ar' ? 'حساب المستخدم النشط' : 'Active User Session'}</span>
            </h3>

            <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/60 space-y-3">
              <div>
                <span className="text-label-sm text-on-surface-variant block">
                  {language === 'ar' ? 'الاسم' : 'Full Name'}
                </span>
                <span className="text-body-md font-bold text-on-surface">{currentUser.fullName}</span>
              </div>

              <div>
                <span className="text-label-sm text-on-surface-variant block">
                  {language === 'ar' ? 'البريد الإلكتروني' : 'Email'}
                </span>
                <span className="text-body-md text-on-surface font-code-num">{currentUser.email}</span>
              </div>

              <div>
                <span className="text-label-sm text-on-surface-variant block">
                  {language === 'ar' ? 'الصلاحية والمسؤولية' : 'Role & Privilege'}
                </span>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-label-sm font-bold bg-primary text-on-primary uppercase mt-1">
                  {currentUser.role}
                </span>
              </div>
            </div>

            <div className="p-3 rounded-lg border border-outline-variant/60 text-label-sm text-on-surface-variant">
              {language === 'ar'
                ? 'الجلسة مؤمنة برمز مشفر ينتهي تلقائياً بعد 7 أيام من آخر استخدام.'
                : 'Session is cryptographically signed and valid for 7 days.'}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: TEAM & RBAC */}
      {activeTab === 'team' && (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-title-md font-bold text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">manage_accounts</span>
                <span>{language === 'ar' ? 'أعضاء مساحة العمل والصلاحيات' : 'Team Members & RBAC Permissions'}</span>
              </h2>
              <p className="text-body-sm text-on-surface-variant">
                {language === 'ar'
                  ? 'التحكم في وصول المحاسبين والمشرفين إلى طابور المطابقة وأجهزة الأسطول'
                  : 'Role-based access control for operators, accountants, and branch managers'}
              </p>
            </div>

            {['owner', 'admin'].includes(currentUser.role) && (
              <button
                onClick={() => setIsInviteOpen(true)}
                className="px-4 py-2 rounded-lg bg-primary text-on-primary text-label-md font-semibold hover:bg-primary/90 transition-all flex items-center gap-1.5 shadow-xs"
              >
                <span className="material-symbols-outlined text-base">person_add</span>
                <span>{language === 'ar' ? 'دعوة عضو جديد' : 'Invite Member'}</span>
              </button>
            )}
          </div>

          {/* Members Table */}
          <div className="overflow-x-auto border border-outline-variant rounded-xl">
            <table className="w-full text-left rtl:text-right border-collapse">
              <thead>
                <tr className="bg-surface-container-low border-b border-outline-variant text-label-sm text-on-surface-variant font-semibold">
                  <th className="py-3 px-4">{language === 'ar' ? 'العضو' : 'Member'}</th>
                  <th className="py-3 px-4">{language === 'ar' ? 'البريد الإلكتروني' : 'Email'}</th>
                  <th className="py-3 px-4">{language === 'ar' ? 'الدور والصلاحيات' : 'Role'}</th>
                  <th className="py-3 px-4">{language === 'ar' ? 'تاريخ الانضمام' : 'Joined'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant text-body-sm text-on-surface">
                {loadingMembers ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-on-surface-variant">
                      <span className="material-symbols-outlined animate-spin text-xl">progress_activity</span>
                    </td>
                  </tr>
                ) : members.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 px-4 text-center text-on-surface-variant">
                      <div className="flex items-center justify-center gap-2">
                        <span className="font-bold text-on-surface">{currentUser.fullName}</span>
                        <span className="text-xs px-2 py-0.5 rounded bg-primary text-on-primary">
                          {currentUser.role}
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  members.map((m) => (
                    <tr key={m.id} className="hover:bg-surface-container-low/50 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-on-surface flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-surface-container-high text-primary font-bold flex items-center justify-center text-label-md">
                          {m.fullName ? m.fullName[0].toUpperCase() : 'U'}
                        </div>
                        <span>{m.fullName}</span>
                      </td>
                      <td className="py-3.5 px-4 font-code-num text-on-surface-variant">{m.email}</td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full text-label-xs font-bold uppercase ${
                            m.role === 'owner'
                              ? 'bg-primary text-on-primary'
                              : m.role === 'admin'
                              ? 'bg-primary-container text-on-primary-container'
                              : m.role === 'manager'
                              ? 'bg-surface-container-high text-primary'
                              : 'bg-surface-container text-on-surface-variant'
                          }`}
                        >
                          {m.role}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-on-surface-variant text-label-sm font-code-num">
                        {m.joinedAt ? new Date(m.joinedAt).toLocaleDateString() : 'Active'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pending Invitations Section */}
          {pendingInvitations.length > 0 && (
            <div className="space-y-3 pt-2">
              <h3 className="text-title-sm font-bold text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">mail</span>
                <span>{language === 'ar' ? 'دعوات الفريق المعلقة (صالحة لمدة 7 أيام)' : 'Pending Team Invitations'}</span>
              </h3>
              <div className="border border-outline-variant rounded-xl overflow-hidden divide-y divide-outline-variant">
                {pendingInvitations.map((inv) => (
                  <div key={inv.token} className="p-3.5 bg-surface-container-low flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-on-surface text-body-sm font-code-num">{inv.email}</span>
                        <span className="px-2 py-0.5 rounded text-label-xs uppercase font-bold bg-surface-container text-primary">
                          {inv.role}
                        </span>
                      </div>
                      <p className="text-label-xs text-on-surface-variant mt-0.5">
                        {language === 'ar' ? 'تنتهي الصلاحية في:' : 'Expires:'} {new Date(inv.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const link = `${window.location.origin}/invite/${inv.token}`;
                        navigator.clipboard.writeText(link);
                        setCopiedToken(inv.token);
                        setTimeout(() => setCopiedToken(null), 2500);
                      }}
                      className="self-start sm:self-auto px-3 py-1.5 rounded-lg border border-outline-variant bg-surface-container-lowest hover:bg-surface-container text-label-sm font-medium text-on-surface flex items-center gap-1.5 transition-all"
                    >
                      <span className="material-symbols-outlined text-sm">
                        {copiedToken === inv.token ? 'check' : 'content_copy'}
                      </span>
                      <span>
                        {copiedToken === inv.token
                          ? language === 'ar'
                            ? 'تم نسخ الرابط!'
                            : 'Link Copied!'
                          : language === 'ar'
                          ? 'نسخ رابط الدعوة'
                          : 'Copy Invite Link'}
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* RBAC Rules Definition Reference */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
            <div className="p-3 rounded-xl bg-surface-container-low border border-outline-variant/60">
              <span className="text-label-sm font-bold text-primary block mb-1">Owner (المالك)</span>
              <p className="text-label-xs text-on-surface-variant">
                {language === 'ar'
                  ? 'إدارة الحساب والمؤسسة بالكامل، إلغاء الأجهزة، وحذف الحسابات.'
                  : 'Full control, device credentials revocation, deletion, and billing.'}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-surface-container-low border border-outline-variant/60">
              <span className="text-label-sm font-bold text-primary block mb-1">Admin (المشرف)</span>
              <p className="text-label-xs text-on-surface-variant">
                {language === 'ar'
                  ? 'ربط أجهزة جديدة، ضبط الحدود، ودعوة المحاسبين والمديرين.'
                  : 'Pair devices, configure CBE limits, and invite team members.'}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-surface-container-low border border-outline-variant/60">
              <span className="text-label-sm font-bold text-primary block mb-1">Manager (المدير)</span>
              <p className="text-label-xs text-on-surface-variant">
                {language === 'ar'
                  ? 'مراجعة واعتماد العمليات المشكوك بها، وإيقاف مسارات الاستقبال مؤقتاً.'
                  : 'Review & approve queue items, toggle pause on payment lines.'}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-surface-container-low border border-outline-variant/60">
              <span className="text-label-sm font-bold text-primary block mb-1">Viewer (المشاهد)</span>
              <p className="text-label-xs text-on-surface-variant">
                {language === 'ar'
                  ? 'قراءة لوحة المراقبة وسجل القيود فقط دون إمكانية التعديل.'
                  : 'Read-only access to transaction ledger and telemetry.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: SUBSCRIPTION & PLAN */}
      {activeTab === 'plan' && (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-outline-variant">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="material-symbols-outlined text-primary">verified</span>
                <h2 className="text-title-md font-bold text-on-surface">
                  {language === 'ar' ? 'خطة المؤسسة وحدود هواتف الالتقاط' : 'Enterprise Plan & Capture Terminals'}
                </h2>
                {currentSub && (
                  <span className={`px-2 py-0.5 rounded-full text-label-xs font-bold ${
                    currentSub.status === 'active'
                      ? 'bg-primary/10 text-primary border border-primary/20'
                      : currentSub.status === 'grace_period'
                      ? 'bg-amber-500/10 text-amber-600 border border-amber-500/20'
                      : 'bg-surface-container-high text-on-surface-variant'
                  }`}>
                    {currentSub.status === 'active'
                      ? (language === 'ar' ? 'نشط' : 'Active')
                      : currentSub.status === 'grace_period'
                      ? (language === 'ar' ? 'فترة سماح للتجديد' : 'Grace Period')
                      : (language === 'ar' ? 'غير نشط' : 'Inactive')}
                  </span>
                )}
              </div>
              <p className="text-body-sm text-on-surface-variant">
                {currentSub
                  ? `${language === 'ar' ? 'الباقة الحالية:' : 'Current Plan:'} ${language === 'ar' ? currentSub.planNameAr : currentSub.planNameEn}`
                  : (language === 'ar'
                      ? 'الخطة النشطة المعتمدة لمراقبة محافظ الدفع وشبكة إنستاباي'
                      : 'Active subscription tier for Egyptian commercial payment ingestion')}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {onNavigateToSubscriptions && (
                <button
                  type="button"
                  onClick={onNavigateToSubscriptions}
                  className="px-4 py-2 rounded-xl bg-primary text-on-primary text-label-sm font-bold hover:bg-primary/90 transition-all flex items-center gap-1.5 cursor-pointer shadow-xs active:scale-95"
                >
                  <span className="material-symbols-outlined text-base">workspace_premium</span>
                  <span>{language === 'ar' ? 'إدارة الباقات والاشتراك' : 'Manage Plans & Billing'}</span>
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/60">
              <span className="text-label-sm text-on-surface-variant block mb-1">
                {language === 'ar' ? 'هواتف الالتقاط المتصلة' : 'Connected Capture Terminals'}
              </span>
              <span className="text-title-lg font-bold font-code-num text-on-surface">
                {currentSub ? `${currentSub.devicesUsed} / ${currentSub.deviceLimit}` : '—'}
              </span>
              <div className="w-full h-1.5 bg-surface-container-high rounded-full mt-3 overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{
                    width: currentSub && currentSub.deviceLimit > 0
                      ? `${Math.min(100, Math.round((currentSub.devicesUsed / currentSub.deviceLimit) * 100))}%`
                      : '0%',
                  }}
                ></div>
              </div>
              <span className="text-label-xs text-on-surface-variant mt-2 block">
                {currentSub
                  ? `${language === 'ar' ? 'المتبقي:' : 'Remaining:'} ${currentSub.devicesRemaining} ${language === 'ar' ? 'هواتف' : 'terminals'}`
                  : ''}
              </span>
            </div>

            <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/60">
              <span className="text-label-sm text-on-surface-variant block mb-1">
                {language === 'ar' ? 'المعاملات الشهرية المتاحة' : 'Monthly Transaction Volume'}
              </span>
              <span className="text-title-lg font-bold font-code-num text-on-surface">
                {language === 'ar' ? 'غير محدود' : 'Unlimited'}
              </span>
              <p className="text-label-xs text-primary font-semibold mt-3">
                {language === 'ar' ? 'دفتر قيود مشفر دائم' : 'Permanent Immutable Ledger'}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/60">
              <span className="text-label-sm text-on-surface-variant block mb-1">
                {language === 'ar' ? 'تاريخ نهاية الاشتراك' : 'Subscription Expiry'}
              </span>
              <span className="text-title-md font-bold font-code-num text-on-surface">
                {currentSub?.endsAt
                  ? new Date(currentSub.endsAt).toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US')
                  : (language === 'ar' ? 'غير محدد' : 'N/A')}
              </span>
              <p className="text-label-xs text-on-surface-variant mt-3">
                {currentSub?.daysRemaining !== undefined
                  ? `${language === 'ar' ? 'متبقي' : 'Remaining:'} ${currentSub.daysRemaining} ${language === 'ar' ? 'يوم' : 'days'}`
                  : (language === 'ar' ? 'تأمين كامل بنظام التدقيق' : 'Audited and secure')}
              </p>
            </div>
          </div>

          {/* Quick Action Card to Plans Page */}
          <div className="p-4 rounded-xl bg-primary/5 border border-primary/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-primary text-2xl">diamond</span>
              <div>
                <h4 className="text-title-sm font-bold text-on-surface">
                  {language === 'ar' ? 'ترقية الباقة أو تفعيل هواتف إضافية' : 'Upgrade Plan or Add More Phones'}
                </h4>
                <p className="text-body-xs text-on-surface-variant">
                  {language === 'ar'
                    ? 'باقات شهرية وسنوية تبدأ من 3 هواتف وحتى 10 هواتف مع دفع مباشر عبر إنستاباي'
                    : 'Monthly and annual plans starting from 3 up to 10 terminals via InstaPay manual transfer'}
                </p>
              </div>
            </div>
            {onNavigateToSubscriptions && (
              <button
                type="button"
                onClick={onNavigateToSubscriptions}
                className="px-4 py-2 rounded-xl bg-primary text-on-primary font-bold text-label-sm hover:bg-primary/90 transition-all flex items-center gap-1 cursor-pointer shrink-0 shadow-xs"
              >
                <span>{language === 'ar' ? 'الانتقال لصفحة الباقات' : 'Go to Plans Page'}</span>
                <span className="material-symbols-outlined text-base">arrow_forward</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: INTEGRATIONS (TELEGRAM & WEBHOOKS) */}
      {activeTab === 'integrations' && (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 shadow-xs space-y-6">
          <div className="pb-4 border-b border-outline-variant">
            <h2 className="text-title-md font-bold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">sensors</span>
              <span>{language === 'ar' ? 'التكاملات والربط الفوري (ERP & Telegram)' : 'Real-time Webhooks & Alerts'}</span>
            </h2>
            <p className="text-body-sm text-on-surface-variant">
              {language === 'ar'
                ? 'إرسال إشعارات التحويل المؤكدة إلى تيليجرام أو نظام إدارة المبيعات الخاص بك فوراً'
                : 'Dispatch verified incoming payments directly to Telegram or your internal ERP'}
            </p>
          </div>

          {integrationsSaved && (
            <div className="p-3 rounded-lg bg-primary/10 border border-primary/20 text-primary text-body-sm flex items-center gap-2">
              <span className="material-symbols-outlined text-base">check_circle</span>
              <span>{language === 'ar' ? 'تم حفظ إعدادات التكامل بنجاح' : 'Integrations updated successfully.'}</span>
            </div>
          )}

          <form onSubmit={handleSaveIntegrations} className="space-y-6">
            {/* Telegram Configuration */}
            <div className="space-y-3 p-4 rounded-xl bg-surface-container-low border border-outline-variant/60">
              <h3 className="text-title-sm font-bold text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">send</span>
                <span>{language === 'ar' ? 'إشعارات تيليجرام اللحظية' : 'Telegram Bot Direct Feed'}</span>
              </h3>
              <p className="text-label-sm text-on-surface-variant">
                {language === 'ar'
                  ? 'يتم إرسال رسالة فورية عند تأكيد أي عملية، وعند اقتراب سقف الحساب من 80% أو 90%.'
                  : 'Instant Telegram alert upon confirmed payments and regulatory limits 80%/90% proximity.'}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-label-sm text-on-surface font-medium mb-1">
                    {language === 'ar' ? 'رمز البوت (Bot Token)' : 'Telegram Bot Token'}
                  </label>
                  <input
                    type="text"
                    value={telegramBotToken}
                    onChange={(e) => setTelegramBotToken(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest font-code-num text-body-sm focus:ring-2 focus:ring-primary focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-label-sm text-on-surface font-medium mb-1">
                    {language === 'ar' ? 'معرّف القناة / المحادثة (Chat ID)' : 'Telegram Chat ID'}
                  </label>
                  <input
                    type="text"
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest font-code-num text-body-sm focus:ring-2 focus:ring-primary focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Webhook Configuration */}
            <div className="space-y-3 p-4 rounded-xl bg-surface-container-low border border-outline-variant/60">
              <h3 className="text-title-sm font-bold text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">alt_route</span>
                <span>{language === 'ar' ? 'رابط الويب هوك للأنظمة الخارجية (Webhook)' : 'Merchant Webhook Ingestion'}</span>
              </h3>
              <p className="text-label-sm text-on-surface-variant">
                {language === 'ar'
                  ? 'يتم إرسال حمولة JSON موقعة بهيدر X-Signature للتحقق من سلامة البيانات في نظامك.'
                  : 'Signed JSON payload dispatched with canonical HMAC header for verification.'}
              </p>

              <div className="space-y-3">
                <div>
                  <label className="block text-label-sm text-on-surface font-medium mb-1">
                    {language === 'ar' ? 'رابط الاستقبال (Endpoint URL)' : 'Endpoint URL'}
                  </label>
                  <input
                    type="url"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest font-code-num text-body-sm focus:ring-2 focus:ring-primary focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-label-sm text-on-surface font-medium mb-1">
                    {language === 'ar' ? 'مفتاح توقيع الويب هوك (Signing Secret)' : 'Webhook Signing Secret'}
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={webhookSecret}
                    className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface-container-low font-code-num text-body-sm"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingIntegrations}
                className="px-5 py-2.5 rounded-lg bg-primary text-on-primary text-label-md font-semibold hover:bg-primary/90 transition-all flex items-center gap-2"
              >
                {savingIntegrations ? (
                  <span className="material-symbols-outlined animate-spin text-base">progress_activity</span>
                ) : (
                  <span className="material-symbols-outlined text-base">save</span>
                )}
                <span>{language === 'ar' ? 'حفظ إعدادات الربط' : 'Save Integrations'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* INVITE MEMBER MODAL */}
      {isInviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-outline-variant">
              <h3 className="text-title-md font-bold text-on-surface">
                {language === 'ar' ? 'دعوة عضو جديد لمساحة العمل' : 'Invite Team Member'}
              </h3>
              <button
                onClick={() => setIsInviteOpen(false)}
                className="p-1 rounded text-on-surface-variant hover:bg-surface-container"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>

            {issuedInvite ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/60 space-y-3">
                  <div className="flex items-center gap-2 text-primary font-bold text-title-sm">
                    <span className="material-symbols-outlined">mark_email_read</span>
                    <span>{language === 'ar' ? 'تم إنشاء رابط الدعوة بنجاح' : 'Invitation Link Created!'}</span>
                  </div>
                  <p className="text-body-sm text-on-surface-variant">
                    {language === 'ar'
                      ? `تمت دعوة ${issuedInvite.email} بصلاحية ${issuedInvite.role}. انسخ الرابط التالي وأرسله له لتأكيد الانضمام:`
                      : `Invited ${issuedInvite.email} as ${issuedInvite.role}. Share this one-time link with your colleague:`}
                  </p>
                  <div className="p-3 rounded-lg bg-surface-container-lowest border border-outline-variant font-code-num text-body-sm break-all text-on-surface select-all">
                    {issuedInvite.link}
                  </div>
                  <div className="flex items-center justify-between text-label-xs text-on-surface-variant">
                    <span>{language === 'ar' ? 'الصلاحية: 7 أيام' : 'Valid for 7 days'}</span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(issuedInvite.link);
                        setCopiedToken(issuedInvite.token);
                        setTimeout(() => setCopiedToken(null), 2500);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-primary text-on-primary font-semibold text-label-sm flex items-center gap-1.5 shadow-xs hover:bg-primary/90 transition-all"
                    >
                      <span className="material-symbols-outlined text-sm">
                        {copiedToken === issuedInvite.token ? 'check' : 'content_copy'}
                      </span>
                      <span>
                        {copiedToken === issuedInvite.token
                          ? language === 'ar'
                            ? 'تم النسخ!'
                            : 'Copied!'
                          : language === 'ar'
                          ? 'نسخ الرابط'
                          : 'Copy Link'}
                      </span>
                    </button>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIssuedInvite(null);
                      setIsInviteOpen(false);
                    }}
                    className="px-4 py-2 rounded-lg bg-surface-container-high text-on-surface text-label-md font-semibold hover:bg-surface-container transition-all"
                  >
                    {language === 'ar' ? 'إغلاق' : 'Close'}
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleInviteMember} className="space-y-4">
                {inviteError && (
                  <div className="p-3 rounded-lg bg-error-container/20 text-error text-body-sm">
                    {inviteError}
                  </div>
                )}
                <div>
                  <label className="block text-label-md text-on-surface font-medium mb-1">
                    {language === 'ar' ? 'الاسم بالكامل' : 'Full Name'}
                  </label>
                  <input
                    type="text"
                    required
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder="Omar Hassan"
                    className="w-full px-3.5 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-body-md focus:ring-2 focus:ring-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-label-md text-on-surface font-medium mb-1">
                    {language === 'ar' ? 'البريد الإلكتروني' : 'Email Address'}
                  </label>
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="omar@merchant.com"
                    className="w-full px-3.5 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-body-md focus:ring-2 focus:ring-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-label-md text-on-surface font-medium mb-1">
                    {language === 'ar' ? 'الدور والصلاحية' : 'Assigned Role'}
                  </label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as any)}
                    className="w-full px-3.5 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-body-md focus:ring-2 focus:ring-primary focus:outline-none"
                  >
                    <option value="admin">Admin (مشرف - إدارة الأجهزة والحدود)</option>
                    <option value="manager">Manager (مدير - اعتماد ومراجعة العمليات)</option>
                    <option value="viewer">Viewer (مشاهد - قراءة الدفتر واللوحة فقط)</option>
                  </select>
                </div>

                <div className="pt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsInviteOpen(false)}
                    className="px-4 py-2 rounded-lg text-label-md font-semibold text-on-surface-variant hover:bg-surface-container transition-all"
                  >
                    {language === 'ar' ? 'إلغاء' : 'Cancel'}
                  </button>
                  <button
                    type="submit"
                    disabled={inviting}
                    className="px-4 py-2 rounded-lg bg-primary text-on-primary text-label-md font-semibold hover:bg-primary/90 transition-all flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {inviting ? (
                      <span className="material-symbols-outlined animate-spin text-base">progress_activity</span>
                    ) : (
                      <span className="material-symbols-outlined text-base">send</span>
                    )}
                    <span>{language === 'ar' ? 'إرسال الدعوة' : 'Send Invite'}</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
