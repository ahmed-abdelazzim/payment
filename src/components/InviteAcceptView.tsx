import React, { useEffect, useState } from 'react';
import { User, Workspace } from '../types';

interface InviteAcceptViewProps {
  token: string;
  language: 'en' | 'ar';
  onSuccess: (token: string, user: User, org: Workspace) => void;
  onNavigateHome: () => void;
  onNavigateLogin: () => void;
}

export const InviteAcceptView: React.FC<InviteAcceptViewProps> = ({
  token,
  language,
  onSuccess,
  onNavigateHome,
  onNavigateLogin,
}) => {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [invite, setInvite] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // Form fields for new user registration
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    const fetchInviteDetails = async () => {
      try {
        const res = await fetch(`/api/v1/organizations/members/invitations/${encodeURIComponent(token)}`);
        const data = await res.json();

        if (res.ok) {
          setInvite(data);
          if (!data.isValid) {
            if (data.isAccepted) {
              setError(
                language === 'ar'
                  ? 'تم قبول هذه الدعوة مسبقاً. يمكنك تسجيل الدخول بحسابك مباشرة.'
                  : 'This invitation has already been accepted. Sign in to your account.'
              );
            } else if (data.isExpired) {
              setError(
                language === 'ar'
                  ? 'انتهت صلاحية هذه الدعوة (صلاحية الرابط 7 أيام). اطلب من مدير مساحة العمل إرسال دعوة جديدة.'
                  : 'This invitation has expired (valid for 7 days). Request a new invite from your workspace admin.'
              );
            }
          }
        } else {
          setError(
            data.message ||
              (language === 'ar' ? 'الدعوة غير موجودة أو غير صالحة.' : 'Invitation not found or invalid.')
          );
        }
      } catch (err: any) {
        setError(
          language === 'ar'
            ? 'تعذر الاتصال بالخادم. يرجى التحقق من اتصالك والمحاولة مجدداً.'
            : 'Unable to reach the server. Please check your connection.'
        );
      } finally {
        setLoading(false);
      }
    };

    fetchInviteDetails();
  }, [token, language]);

  // Handle accepting with existing active session
  const handleAcceptWithExistingSession = async () => {
    const activeToken = localStorage.getItem('sarraf_session_token');
    if (!activeToken) {
      onNavigateLogin();
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/v1/organizations/members/invitations/accept', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${activeToken}`,
        },
        body: JSON.stringify({ token }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || (language === 'ar' ? 'فشل قبول الدعوة' : 'Failed to accept invite'));
      }

      // Reload me
      const meRes = await fetch('/api/v1/auth/me', {
        headers: { Authorization: `Bearer ${activeToken}` },
      });
      if (meRes.ok) {
        const meData = await meRes.json();
        onSuccess(
          activeToken,
          meData.user,
          {
            id: meData.organization.id,
            name: meData.organization.name,
            nameAr: meData.organization.name_ar,
            subTitle: `${meData.organization.name_ar || meData.organization.name} - بوابة العمليات`,
            initials: meData.organization.name.slice(0, 2).toUpperCase(),
            slug: meData.organization.slug,
          }
        );
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Handle registering and accepting in 1 step
  const handleRegisterAndAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || password.length < 8) {
      setError(
        language === 'ar'
          ? 'يرجى إدخال الاسم بالكامل وكلمة مرور من 8 أحرف على الأقل.'
          : 'Please enter your full name and a password of at least 8 characters.'
      );
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/v1/organizations/members/invitations/register-and-accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          fullName: fullName.trim(),
          password,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || (language === 'ar' ? 'فشل إتمام الانضمام' : 'Failed to complete registration'));
      }

      localStorage.setItem('sarraf_session_token', data.token);
      onSuccess(
        data.token,
        data.user,
        {
          id: data.organization.id,
          name: data.organization.name,
          nameAr: data.organization.nameAr,
          subTitle: `${data.organization.nameAr || data.organization.name} - بوابة العمليات`,
          initials: data.organization.name.slice(0, 2).toUpperCase(),
          slug: data.organization.slug,
        }
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const hasSession = Boolean(localStorage.getItem('sarraf_session_token'));

  const roleNameMap: Record<string, { ar: string; en: string }> = {
    admin: { ar: 'مدير نظام (Admin)', en: 'Admin' },
    manager: { ar: 'مشرف عمليات (Manager)', en: 'Operations Manager' },
    viewer: { ar: 'مطلع (Viewer)', en: 'Viewer' },
  };

  return (
    <div className="min-h-screen bg-surface-container-lowest flex flex-col justify-center items-center px-4 py-12 selection:bg-primary selection:text-on-primary">
      <div className="w-full max-w-md bg-surface-container rounded-2xl border border-outline-variant/30 shadow-2xl overflow-hidden p-8 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Brand Badge */}
        <div className="flex justify-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-xs">
            <span className="material-symbols-outlined text-2xl">group_add</span>
          </div>
        </div>

        {loading && (
          <div className="py-12 text-center space-y-4">
            <span className="material-symbols-outlined text-4xl text-primary animate-spin">
              progress_activity
            </span>
            <p className="text-sm font-semibold text-on-surface-variant">
              {language === 'ar' ? 'جاري استرجاع بيانات الدعوة...' : 'Loading invitation details...'}
            </p>
          </div>
        )}

        {!loading && error && !invite?.isValid && (
          <div className="py-6 space-y-5 text-center">
            <div className="w-16 h-16 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-500 flex items-center justify-center mx-auto shadow-sm">
              <span className="material-symbols-outlined text-3xl">cancel</span>
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-bold text-on-surface">
                {language === 'ar' ? 'تعذر قبول الدعوة' : 'Unable to Accept Invite'}
              </h2>
              <p className="text-sm text-rose-400">{error}</p>
            </div>
            <div className="pt-4 flex flex-col gap-2">
              <button
                onClick={onNavigateLogin}
                className="w-full py-3 px-4 rounded-xl bg-primary text-on-primary font-bold text-sm shadow-sm hover:bg-primary/90 transition-all cursor-pointer"
              >
                {language === 'ar' ? 'تسجيل الدخول' : 'Go to Login'}
              </button>
              <button
                onClick={onNavigateHome}
                className="w-full py-2.5 px-4 rounded-xl bg-surface-container-high hover:bg-surface-container-highest text-on-surface text-xs font-semibold transition-all cursor-pointer"
              >
                {language === 'ar' ? 'الصفحة الرئيسية' : 'Home'}
              </button>
            </div>
          </div>
        )}

        {!loading && invite?.isValid && (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <span className="inline-block px-3 py-1 rounded-full text-xs font-bold bg-primary/10 text-primary border border-primary/20">
                {language === 'ar' ? 'دعوة انضمام لفريق العمل' : 'Workspace Team Invite'}
              </span>
              <h1 className="text-2xl font-bold text-on-surface">
                {language === 'ar' ? invite.organizationNameAr || invite.organizationName : invite.organizationName}
              </h1>
              <p className="text-sm text-on-surface-variant">
                {language === 'ar'
                  ? `تمت دعوتك للانضمام بصلاحية: `
                  : `You've been invited with role: `}
                <strong className="text-primary">
                  {language === 'ar'
                    ? roleNameMap[invite.role]?.ar || invite.role
                    : roleNameMap[invite.role]?.en || invite.role}
                </strong>
              </p>
              <div className="text-xs font-mono bg-surface-container-highest px-3 py-1.5 rounded-lg text-on-surface-variant inline-block">
                {invite.email}
              </div>
            </div>

            {error && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-400 rounded-xl text-xs flex items-center gap-2">
                <span className="material-symbols-outlined text-base shrink-0">error</span>
                <span>{error}</span>
              </div>
            )}

            {hasSession ? (
              <div className="space-y-3 pt-2">
                <p className="text-xs text-on-surface-variant text-center">
                  {language === 'ar'
                    ? 'أنت مسجل الدخول حالياً في المتصفح. يمكنك الانضمام مباشرة بحسابك الحالي.'
                    : 'You are currently signed in. You can join directly with your active account.'}
                </p>
                <button
                  onClick={handleAcceptWithExistingSession}
                  disabled={submitting}
                  className="w-full py-3.5 px-4 rounded-xl bg-primary text-on-primary font-bold text-sm shadow-md hover:bg-primary/90 disabled:opacity-50 cursor-pointer transition-all flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <span className="material-symbols-outlined text-lg animate-spin">progress_activity</span>
                  ) : (
                    <>
                      <span>{language === 'ar' ? 'قبول الدعوة والانضمام فوراً' : 'Accept Invite with Active Account'}</span>
                      <span className="material-symbols-outlined text-base rtl:rotate-180">arrow_forward</span>
                    </>
                  )}
                </button>
              </div>
            ) : (
              <form onSubmit={handleRegisterAndAccept} className="space-y-4 pt-2">
                <div>
                  <label className="block text-xs font-bold text-on-surface-variant mb-1">
                    {language === 'ar' ? 'الاسم بالكامل' : 'Full Name'}
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder={language === 'ar' ? 'مثال: أحمد عبد العظيم' : 'e.g. Ahmed Abdelazim'}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-highest border border-outline-variant/40 text-on-surface text-sm focus:outline-hidden focus:border-primary transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-on-surface-variant mb-1">
                    {language === 'ar' ? 'كلمة المرور الجديدة' : 'Create Password'}
                  </label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-highest border border-outline-variant/40 text-on-surface text-sm focus:outline-hidden focus:border-primary transition-all"
                  />
                  <p className="text-[11px] text-on-surface-variant mt-1">
                    {language === 'ar' ? '8 أحرف على الأقل.' : 'At least 8 characters.'}
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-3.5 px-4 rounded-xl bg-primary text-on-primary font-bold text-sm shadow-md hover:bg-primary/90 disabled:opacity-50 cursor-pointer transition-all flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <span className="material-symbols-outlined text-lg animate-spin">progress_activity</span>
                  ) : (
                    <>
                      <span>{language === 'ar' ? 'تفعيل الحساب والانضمام' : 'Activate Account & Join'}</span>
                      <span className="material-symbols-outlined text-base rtl:rotate-180">arrow_forward</span>
                    </>
                  )}
                </button>

                <div className="text-center pt-2">
                  <button
                    type="button"
                    onClick={onNavigateLogin}
                    className="text-xs text-primary hover:underline font-semibold cursor-pointer"
                  >
                    {language === 'ar' ? 'لديك حساب بالفعل؟ سجل دخولك' : 'Already have an account? Sign in'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

      </div>
    </div>
  );
};
