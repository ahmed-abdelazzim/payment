import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';

interface VerifyEmailViewProps {
  language: 'en' | 'ar';
  onNavigateHome: () => void;
  onNavigateLogin: () => void;
  onNavigateApp: () => void;
}

export const VerifyEmailView: React.FC<VerifyEmailViewProps> = ({
  language,
  onNavigateHome,
  onNavigateLogin,
  onNavigateApp,
}) => {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (!token) {
      setStatus('error');
      setErrorMessage(
        language === 'ar'
          ? 'رمز التأكيد مفقود من الرابط.'
          : 'Verification token is missing from URL.'
      );
      return;
    }

    const verifyToken = async () => {
      try {
        const res = await apiFetch('/api/v1/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        const data = await res.json();
        if (res.ok) {
          setStatus('success');
          setEmail(data.email || '');
        } else {
          setStatus('error');
          setErrorMessage(
            data.message ||
              (language === 'ar'
                ? 'رمز التأكيد غير صالح أو انتهت صلاحيته (صالح لـ 24 ساعة).'
                : 'Verification token is invalid or expired (valid for 24h).')
          );
        }
      } catch (err: any) {
        setStatus('error');
        setErrorMessage(
          language === 'ar'
            ? 'تعذر الاتصال بالخادم. يرجى المحاولة مرة أخرى.'
            : 'Unable to reach the server. Please try again.'
        );
      }
    };

    verifyToken();
  }, [language]);

  useEffect(() => {
    apiFetch('/api/v1/auth/me')
      .then((res) => setHasSession(res.ok))
      .catch(() => setHasSession(false));
  }, []);

  return (
    <div className="min-h-screen bg-surface-container-lowest flex flex-col justify-center items-center px-4 py-12 selection:bg-primary selection:text-on-primary">
      <div className="w-full max-w-md bg-surface-container rounded-2xl border border-outline-variant/30 shadow-xl overflow-hidden p-8 text-center animate-in fade-in zoom-in-95 duration-200">
        
        {/* Brand Header */}
        <div className="flex justify-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-xs">
            <span className="material-symbols-outlined text-2xl">account_balance_wallet</span>
          </div>
        </div>

        {status === 'loading' && (
          <div className="py-8 space-y-4">
            <span className="material-symbols-outlined text-4xl text-primary animate-spin">
              progress_activity
            </span>
            <h2 className="text-xl font-bold text-on-surface">
              {language === 'ar' ? 'جاري التحقق من بريدك الإلكتروني...' : 'Verifying your email address...'}
            </h2>
            <p className="text-sm text-on-surface-variant">
              {language === 'ar'
                ? 'لحظات ونقوم بتأكيد حسابك وتفعيل ميزات الأمان.'
                : 'Confirming your business email and activating security policies.'}
            </p>
          </div>
        )}

        {status === 'success' && (
          <div className="py-6 space-y-5">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 flex items-center justify-center mx-auto shadow-sm">
              <span className="material-symbols-outlined text-3xl">verified</span>
            </div>
            
            <div className="space-y-1">
              <h2 className="text-2xl font-bold text-on-surface">
                {language === 'ar' ? 'تم تأكيد بريدك الإلكتروني بنجاح!' : 'Email Verified Successfully!'}
              </h2>
              {email && (
                <p className="text-sm font-mono text-primary font-medium">{email}</p>
              )}
            </div>

            <p className="text-sm text-on-surface-variant leading-relaxed">
              {language === 'ar'
                ? 'أصبح حسابك موثقاً بالكامل الآن. يمكنك استلام تقارير التوفيق وتنبيهات تخطي حدود البنك المركزي وتأكيد المدفوعات فورياً.'
                : 'Your email is now verified. You will receive real-time reconciliation reports, limit alerts, and critical telemetry notices.'}
            </p>

            <div className="pt-4">
              <button
                onClick={hasSession ? onNavigateApp : onNavigateLogin}
                className="w-full py-3 px-4 rounded-xl bg-primary text-on-primary font-bold text-sm shadow-md hover:bg-primary/90 active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <span>
                  {hasSession
                    ? language === 'ar'
                      ? 'الدخول إلى لوحة العمليات'
                      : 'Go to Operations Dashboard'
                    : language === 'ar'
                    ? 'تسجيل الدخول'
                    : 'Sign In'}
                </span>
                <span className="material-symbols-outlined text-lg rtl:rotate-180">arrow_forward</span>
              </button>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="py-6 space-y-5">
            <div className="w-16 h-16 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-500 flex items-center justify-center mx-auto shadow-sm">
              <span className="material-symbols-outlined text-3xl">error_outline</span>
            </div>

            <div className="space-y-1">
              <h2 className="text-xl font-bold text-on-surface">
                {language === 'ar' ? 'تعذر تأكيد البريد الإلكتروني' : 'Verification Failed'}
              </h2>
              <p className="text-sm text-rose-400">{errorMessage}</p>
            </div>

            <p className="text-xs text-on-surface-variant leading-relaxed">
              {language === 'ar'
                ? 'قد يكون الرابط انتهت صلاحيته (24 ساعة) أو تم استخدامه مسبقاً. يمكنك تسجيل الدخول وطلب إعادة إرسال الرابط من الشريط العلوي.'
                : 'The token might be expired (24h) or already used. Sign in to your account and request a fresh link.'}
            </p>

            <div className="pt-4 flex flex-col gap-2">
              <button
                onClick={onNavigateLogin}
                className="w-full py-3 px-4 rounded-xl bg-primary text-on-primary font-bold text-sm shadow-sm hover:bg-primary/90 transition-all cursor-pointer"
              >
                {language === 'ar' ? 'الانتقال لتسجيل الدخول' : 'Go to Login'}
              </button>
              <button
                onClick={onNavigateHome}
                className="w-full py-2.5 px-4 rounded-xl bg-surface-container-high hover:bg-surface-container-highest text-on-surface text-xs font-semibold transition-all cursor-pointer"
              >
                {language === 'ar' ? 'العودة للصفحة الرئيسية' : 'Back to Home'}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
