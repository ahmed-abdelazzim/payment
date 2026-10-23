import React, { useState } from 'react';
import { User, Workspace } from '../types';
import { apiFetch } from '../api';
import { formatAuthErrorMessage, getPasswordInputType } from '../utils/uiHelpers';

interface AuthViewProps {
  onSuccess: (user: User, org: Workspace) => void;
  language: 'en' | 'ar';
  onToggleLanguage: () => void;
  initialTab?: 'login' | 'signup';
  onNavigateHome?: () => void;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
}

export const AuthView: React.FC<AuthViewProps> = ({
  onSuccess,
  language,
  onToggleLanguage,
  initialTab = 'login',
  onNavigateHome,
  theme,
  onToggleTheme,
}) => {
  const [tab, setTab] = useState<'login' | 'signup' | 'forgot'>(initialTab);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  // Login form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Signup form state
  const [signupFullName, setSignupFullName] = useState('');
  const [signupOrgName, setSignupOrgName] = useState('');
  const [signupOrgNameAr, setSignupOrgNameAr] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [showSignupPassword, setShowSignupPassword] = useState(false);

  // Forgot password form state
  const [forgotEmail, setForgotEmail] = useState('');
  const [resetToken, setResetToken] = useState(() =>
    typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('resetToken') || ''
  );
  const [newPassword, setNewPassword] = useState('');
  const [isResetStep, setIsResetStep] = useState(() =>
    typeof window !== 'undefined' && Boolean(new URLSearchParams(window.location.search).get('resetToken'))
  );

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await apiFetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || (language === 'ar' ? 'فشل تسجيل الدخول' : 'Login failed'));
      }

      onSuccess(
        {
          id: data.user.id,
          email: data.user.email,
          fullName: data.user.fullName,
          role: data.user.role,
          organizationId: data.organization.id,
        },
        {
          id: data.organization.id,
          name: data.organization.name,
          nameAr: data.organization.nameAr,
          subTitle: `${data.organization.nameAr} - بوابة العمليات`,
          initials: data.organization.name.slice(0, 2).toUpperCase(),
          slug: data.organization.slug,
        }
      );
    } catch (err: any) {
      setError(formatAuthErrorMessage(err, language, typeof navigator !== 'undefined' ? navigator.onLine : true));
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await apiFetch('/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: signupFullName,
          organizationName: signupOrgName,
          organizationNameAr: signupOrgNameAr || signupOrgName,
          email: signupEmail,
          password: signupPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || (language === 'ar' ? 'فشل إنشاء الحساب' : 'Signup failed'));
      }

      onSuccess(
        {
          id: data.user.id,
          email: data.user.email,
          fullName: data.user.fullName,
          role: data.user.role,
          organizationId: data.organization.id,
        },
        {
          id: data.organization.id,
          name: data.organization.name,
          nameAr: data.organization.nameAr,
          subTitle: `${data.organization.nameAr} - مساحة العمل الجديدة`,
          initials: data.organization.name.slice(0, 2).toUpperCase(),
          slug: data.organization.slug,
        }
      );
    } catch (err: any) {
      setError(formatAuthErrorMessage(err, language, typeof navigator !== 'undefined' ? navigator.onLine : true));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);
    setLoading(true);

    try {
      const res = await apiFetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Request failed');
      }

      setInfoMessage(
        data.message ||
          (language === 'ar'
            ? 'إذا كان البريد مسجلاً، أرسلنا رابطاً آمناً لإعادة تعيين كلمة المرور.'
            : 'If that email is registered, we sent a secure password-reset link.')
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);
    setLoading(true);

    try {
      const res = await apiFetch('/api/v1/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, newPassword }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Reset failed');
      }

      setInfoMessage(data.message);
      setIsResetStep(false);
      setTab('login');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="sarraf-auth-shell min-h-screen sarraf-shell bg-surface-container-lowest">
      <aside className="sarraf-auth-visual hidden lg:flex flex-col justify-between p-10 xl:p-14 text-white overflow-hidden relative">
        <div className="sarraf-auth-grid absolute inset-0 opacity-30" aria-hidden="true" />
        <div className="relative z-10 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded border border-white/20 bg-white/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-2xl">account_balance</span>
            </div>
            <div>
              <p className="text-xl font-extrabold tracking-tight">Sarraf Ops | صرّاف</p>
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Egyptian payment rails engine</p>
            </div>
          </div>
          <span className="px-3 py-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 text-emerald-300 text-[11px] font-bold">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 me-1.5" />
            {language === 'ar' ? 'شبكة المدفوعات متصلة' : 'Payment rails connected'}
          </span>
        </div>

        <div className="relative z-10 max-w-xl">
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-600/15 border border-blue-400/30 text-blue-200 text-xs font-bold mb-6">
            <span className="material-symbols-outlined text-base">hub</span>
            {language === 'ar' ? 'بنية تشغيل موحدة للمدفوعات' : 'Unified payment operations'}
          </span>
          <h2 className="text-4xl xl:text-5xl font-extrabold leading-tight tracking-tight">
            {language === 'ar'
              ? 'بنية تحتية موحدة لمطابقة مدفوعات إنستاباي والمحافظ الإلكترونية في مصر'
              : 'One operating layer for Egypt’s instant payments and mobile wallets'}
          </h2>
          <p className="mt-5 text-slate-300 text-base leading-8">
            {language === 'ar'
              ? 'اجمع إشعارات التحويل، طابقها مع طلبات متجرك، وراقب السيولة والأجهزة من لوحة تشغيل واحدة.'
              : 'Capture transfer notifications, reconcile store orders, and monitor liquidity and devices from one secure console.'}
          </p>

          <div className="mt-8 space-y-3">
            {[
              language === 'ar' ? 'تجربة مجانية لمدة 7 أيام مع هاتف التقاط واحد' : '7-day free trial with one capture phone',
              language === 'ar' ? 'مطابقة لحظية لمسارات الدفع المصرية' : 'Real-time reconciliation across Egyptian rails',
              language === 'ar' ? 'تشفير كامل بدون حفظ كلمات سر المحافظ' : 'Encrypted by design with no wallet passwords stored',
            ].map((item) => (
              <div key={item} className="flex items-center gap-3 px-4 py-3 rounded border border-white/15 bg-white/[0.045]">
                <span className="w-6 h-6 rounded-full bg-emerald-500/15 text-emerald-300 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-base">check</span>
                </span>
                <span className="text-sm font-semibold text-slate-100">{item}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 grid grid-cols-3 gap-3 text-[10px] text-slate-400 border-t border-white/10 pt-5">
          <span>PCI-aware operations</span>
          <span>TLS 1.3</span>
          <span>{language === 'ar' ? 'استضافة محلية آمنة' : 'Secure regional hosting'}</span>
        </div>
      </aside>

      <section className="sarraf-auth-panel min-h-screen flex flex-col justify-between p-4 sm:p-8">
      {/* Top Header */}
      <header className="max-w-5xl mx-auto w-full flex items-center justify-between pb-6 border-b border-outline-variant/60">
        <div className="flex items-center gap-2 text-primary">
          <span className="material-symbols-outlined text-primary text-2xl">
            account_balance_wallet
          </span>
          <span className="text-title-lg font-bold tracking-tight">Sarraf Ops</span>
          <span className="text-label-sm px-2 py-0.5 rounded bg-surface-container-high text-primary font-semibold">
            {language === 'ar' ? 'صرّاف مصر' : 'Enterprise'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {onNavigateHome && (
            <button
              type="button"
              onClick={onNavigateHome}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-outline-variant bg-surface-container-low text-label-md text-on-surface hover:bg-surface-container transition-all cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">home</span>
              <span>{language === 'ar' ? 'الرئيسية' : 'Home'}</span>
            </button>
          )}

          {onToggleTheme && (
            <button
              type="button"
              onClick={onToggleTheme}
              className="w-9 h-9 rounded-lg border border-outline-variant bg-surface-container-low text-on-surface hover:text-primary hover:bg-surface-container transition-all flex items-center justify-center cursor-pointer active:scale-90"
              title={theme === 'dark' ? (language === 'ar' ? 'الوضع النهاري' : 'Light Mode') : (language === 'ar' ? 'الوضع الليلي (Night Mode)' : 'Dark Mode')}
              aria-label="Toggle Night Mode"
            >
              <span className="material-symbols-outlined text-lg">
                {theme === 'dark' ? 'light_mode' : 'dark_mode'}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={onToggleLanguage}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-outline-variant bg-surface-container-low text-label-md text-on-surface hover:bg-surface-container transition-all cursor-pointer"
          >
            <span className="material-symbols-outlined text-base">translate</span>
            <span>{language === 'en' ? 'العربية' : 'English'}</span>
          </button>
        </div>
      </header>

      {/* Main Authentication Card */}
      <main className="max-w-md mx-auto w-full my-auto py-8">
        <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl shadow-sm p-6 sm:p-8 space-y-6">
          {/* Header Typography */}
          <div className="text-center space-y-2">
            <h1 className="text-title-lg font-bold text-on-surface">
              {tab === 'login' && (language === 'ar' ? 'تسجيل الدخول إلى حسابك' : 'Sign In to Your Workspace')}
              {tab === 'signup' && (language === 'ar' ? 'إنشاء حساب تاجر جديد' : 'Create Merchant Account')}
              {tab === 'forgot' && (language === 'ar' ? 'استعادة كلمة المرور' : 'Reset Your Password')}
            </h1>
            <p className="text-body-sm text-on-surface-variant">
              {tab === 'login' &&
                (language === 'ar'
                  ? 'منظومة مراقبة وتأكيد المحافظ الإلكترونية وشبكة المدفوعات اللحظية IPN'
                  : 'Real-time payment telemetry & reconciliation for Egyptian financial networks')}
              {tab === 'signup' &&
                (language === 'ar'
                  ? 'ابدأ بمساحة عمل جديدة تماماً خالية من أي بيانات تجريبية'
                  : 'Start with a clean slate workspace dedicated to your business')}
              {tab === 'forgot' &&
                (language === 'ar'
                  ? 'أدخل بريدك الإلكتروني لاستلام رابط آمن لتعيين كلمة المرور'
                  : 'Enter your email address to receive a secure password-reset link')}
            </p>
          </div>

          {/* Navigation Tabs */}
          <div className="flex rounded-lg bg-surface-container-low p-1 border border-outline-variant/60">
            <button
              type="button"
              onClick={() => {
                setTab('login');
                setError(null);
                setInfoMessage(null);
              }}
              className={`flex-1 py-1.5 text-label-md rounded-md font-semibold transition-all ${
                tab === 'login'
                  ? 'bg-surface-container-lowest text-primary shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {language === 'ar' ? 'تسجيل الدخول' : 'Sign In'}
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('signup');
                setError(null);
                setInfoMessage(null);
              }}
              className={`flex-1 py-1.5 text-label-md rounded-md font-semibold transition-all ${
                tab === 'signup'
                  ? 'bg-surface-container-lowest text-primary shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {language === 'ar' ? 'حساب جديد' : 'New Account'}
            </button>
          </div>

          {/* Alert Messages */}
          {error && (
            <div className="p-3 rounded-lg bg-error-container/20 border border-error/30 text-error text-body-sm flex items-start gap-2">
              <span className="material-symbols-outlined text-base mt-0.5">error</span>
              <span>{error}</span>
            </div>
          )}

          {infoMessage && (
            <div className="p-3 rounded-lg bg-primary/10 border border-primary/20 text-primary text-body-sm flex items-start gap-2">
              <span className="material-symbols-outlined text-base mt-0.5">info</span>
              <span>{infoMessage}</span>
            </div>
          )}

          {/* TAB 1: LOGIN FORM */}
          {tab === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-label-md text-on-surface font-medium mb-1.5">
                  {language === 'ar' ? 'البريد الإلكتروني' : 'Email Address'}
                </label>
                <input
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="merchant@business.eg"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-body-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-label-md text-on-surface font-medium">
                    {language === 'ar' ? 'كلمة المرور' : 'Password'}
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setTab('forgot');
                      setError(null);
                      setInfoMessage(null);
                    }}
                    className="text-label-sm text-primary hover:underline"
                  >
                    {language === 'ar' ? 'نسيت كلمة المرور؟' : 'Forgot password?'}
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={getPasswordInputType(showLoginPassword)}
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full px-3.5 py-2.5 pe-11 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-body-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPassword((prev) => !prev)}
                    className="absolute end-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface p-1 rounded-md transition-colors cursor-pointer"
                    aria-label={showLoginPassword ? (language === 'ar' ? 'إخفاء كلمة المرور' : 'Hide password') : (language === 'ar' ? 'إظهار كلمة المرور' : 'Show password')}
                  >
                    <span className="material-symbols-outlined text-lg">
                      {showLoginPassword ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-lg bg-primary text-on-primary font-semibold text-label-lg hover:bg-primary/90 active:scale-[0.99] transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading ? (
                  <span className="material-symbols-outlined animate-spin text-lg">progress_activity</span>
                ) : (
                  <span className="material-symbols-outlined text-lg">login</span>
                )}
                <span>{language === 'ar' ? 'تسجيل الدخول' : 'Sign In'}</span>
              </button>
            </form>
          )}

          {/* TAB 2: SIGNUP FORM */}
          {tab === 'signup' && (
            <form onSubmit={handleSignup} className="space-y-4">
              <div className="p-3.5 rounded-xl bg-primary/10 border border-primary/20 text-body-xs text-primary flex items-start gap-2.5">
                <span className="material-symbols-outlined text-base mt-0.5 shrink-0">verified</span>
                <div>
                  <span className="font-bold block">
                    {language === 'ar' ? 'تشمل 7 أيام تجربة مجانية تلقائياً' : 'Includes 7-Day Free Trial Automatically'}
                  </span>
                  <p className="text-on-surface-variant text-[11px] mt-0.5">
                    {language === 'ar'
                      ? 'ربط هاتف التقاط واحد، وتجربة كافة مميزات المنصة بدون كريديت كارد وبدون أي دفع مسبق.'
                      : 'Connect 1 capture terminal and test all platform features with zero credit card or upfront payment.'}
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-label-md text-on-surface font-medium mb-1.5">
                  {language === 'ar' ? 'الاسم بالكامل' : 'Full Name'}
                </label>
                <input
                  type="text"
                  required
                  value={signupFullName}
                  onChange={(e) => setSignupFullName(e.target.value)}
                  placeholder={language === 'ar' ? 'أحمد محمود' : 'Ahmed Mahmoud'}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-body-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-label-md text-on-surface font-medium mb-1.5">
                    {language === 'ar' ? 'اسم المؤسسة (English)' : 'Business Name'}
                  </label>
                  <input
                    type="text"
                    required
                    value={signupOrgName}
                    onChange={(e) => setSignupOrgName(e.target.value)}
                    placeholder="Nile Mart Ltd"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-body-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                  />
                </div>
                <div>
                  <label className="block text-label-md text-on-surface font-medium mb-1.5">
                    {language === 'ar' ? 'اسم المؤسسة (بالعربية)' : 'Arabic Name'}
                  </label>
                  <input
                    type="text"
                    value={signupOrgNameAr}
                    onChange={(e) => setSignupOrgNameAr(e.target.value)}
                    placeholder="نايل مارت"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-body-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-label-md text-on-surface font-medium mb-1.5">
                  {language === 'ar' ? 'البريد الإلكتروني للعمل' : 'Work Email'}
                </label>
                <input
                  type="email"
                  required
                  value={signupEmail}
                  onChange={(e) => setSignupEmail(e.target.value)}
                  placeholder="owner@nilemart.eg"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-body-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                />
              </div>

              <div>
                <label className="block text-label-md text-on-surface font-medium mb-1.5">
                  {language === 'ar' ? 'كلمة المرور' : 'Password (min. 8 characters)'}
                </label>
                <div className="relative">
                  <input
                    type={getPasswordInputType(showSignupPassword)}
                    required
                    minLength={8}
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full px-3.5 py-2.5 pe-11 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-body-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSignupPassword((prev) => !prev)}
                    className="absolute end-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface p-1 rounded-md transition-colors cursor-pointer"
                    aria-label={showSignupPassword ? (language === 'ar' ? 'إخفاء كلمة المرور' : 'Hide password') : (language === 'ar' ? 'إظهار كلمة المرور' : 'Show password')}
                  >
                    <span className="material-symbols-outlined text-lg">
                      {showSignupPassword ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/60 text-label-sm text-on-surface-variant flex items-center gap-2">
                <span className="material-symbols-outlined text-base text-primary">credit_card_off</span>
                <span>
                  {language === 'ar'
                    ? 'التجربة المجانية (7 أيام) لا تحتاج إلى كريديت كارد أو دفع مسبق'
                    : 'Free 7-day trial: No credit card or upfront payment required'}
                </span>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-lg bg-primary text-on-primary font-semibold text-label-lg hover:bg-primary/90 active:scale-[0.99] transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading ? (
                  <span className="material-symbols-outlined animate-spin text-lg">progress_activity</span>
                ) : (
                  <span className="material-symbols-outlined text-lg">domain_add</span>
                )}
                <span>{language === 'ar' ? 'إنشاء مساحة العمل والبدء' : 'Create Workspace & Get Started'}</span>
              </button>
            </form>
          )}

          {/* TAB 3: FORGOT PASSWORD */}
          {tab === 'forgot' && (
            <div className="space-y-4">
              {!isResetStep ? (
                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <div>
                    <label className="block text-label-md text-on-surface font-medium mb-1.5">
                      {language === 'ar' ? 'البريد الإلكتروني المسجل' : 'Registered Email Address'}
                    </label>
                    <input
                      type="email"
                      required
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder="merchant@example.com"
                      className="w-full px-3.5 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-body-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 px-4 rounded-lg bg-primary text-on-primary font-semibold text-label-lg hover:bg-primary/90 active:scale-[0.99] transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {loading ? (
                      <span className="material-symbols-outlined animate-spin text-lg">progress_activity</span>
                    ) : (
                      <span className="material-symbols-outlined text-lg">send</span>
                    )}
                    <span>{language === 'ar' ? 'إرسال رابط الاستعادة' : 'Send Reset Link'}</span>
                  </button>
                </form>
              ) : (
                <form onSubmit={handleResetPassword} className="space-y-4">
                  <div>
                    <label className="block text-label-md text-on-surface font-medium mb-1.5">
                      {language === 'ar' ? 'رمز الاستعادة' : 'Reset token'}
                    </label>
                    <input
                      type="text"
                      required
                      value={resetToken}
                      onChange={(e) => setResetToken(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-body-md font-code-num focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-label-md text-on-surface font-medium mb-1.5">
                      {language === 'ar' ? 'كلمة المرور الجديدة' : 'New Password'}
                    </label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full px-3.5 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-body-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 px-4 rounded-lg bg-primary text-on-primary font-semibold text-label-lg hover:bg-primary/90 active:scale-[0.99] transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {loading ? (
                      <span className="material-symbols-outlined animate-spin text-lg">progress_activity</span>
                    ) : (
                      <span className="material-symbols-outlined text-lg">check_circle</span>
                    )}
                    <span>{language === 'ar' ? 'تحديث كلمة المرور' : 'Update Password'}</span>
                  </button>
                </form>
              )}

              <button
                type="button"
                onClick={() => {
                  setTab('login');
                  setIsResetStep(false);
                  setError(null);
                  setInfoMessage(null);
                }}
                className="w-full text-center text-label-md text-on-surface-variant hover:text-on-surface pt-2"
              >
                {language === 'ar' ? 'العودة لتسجيل الدخول' : 'Back to Sign In'}
              </button>
            </div>
          )}
        </div>
      </main>

      {/* Footer Branding */}
      <footer className="max-w-5xl mx-auto w-full text-center text-label-sm text-on-surface-variant/70 pt-6">
        <span>Sarraf Ops Engine &copy; 2026 &middot; </span>
        <span>
          {language === 'ar'
            ? 'نظام تشغيل ومراقبة التحويلات التجارية'
            : 'Commercial Payment Telemetry Platform'}
        </span>
      </footer>
      </section>
    </div>
  );
};
