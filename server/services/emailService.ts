import nodemailer from 'nodemailer';

export interface EmailSendResult {
  success: boolean;
  link: string;
  provider: 'smtp' | 'resend' | 'simulated';
  error?: string;
}

export function getAppBaseUrl(): string {
  if (process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL') {
    return process.env.APP_URL.replace(/\/$/, '');
  }
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  }
  if (process.env.RENDER_EXTERNAL_URL) {
    return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '');
  }
  return 'http://localhost:3000';
}

function getSenderAddress(): string {
  return process.env.SMTP_FROM || process.env.EMAIL_FROM || '"Sarraf Ops" <no-reply@sarrafops.com>';
}

function createSmtpTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
    tls: {
      rejectUnauthorized: process.env.NODE_ENV === 'production' && process.env.SMTP_REJECT_UNAUTHORIZED !== 'false',
    },
  });
}

async function sendViaResend(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: getSenderAddress(),
      to: [to],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Resend API error: ${errorText}`);
  }

  return true;
}

export class EmailService {
  /**
   * Universal email dispatcher: tries SMTP, then Resend, then falls back to clean simulation logging
   */
  static async dispatch(to: string, subject: string, html: string, actionLink: string): Promise<EmailSendResult> {
    const transporter = createSmtpTransporter();

    // 1. Try SMTP if configured
    if (transporter) {
      try {
        await transporter.sendMail({
          from: getSenderAddress(),
          to,
          subject,
          html,
        });
        console.log('[EmailService] Email dispatched via SMTP.');
        return { success: true, link: actionLink, provider: 'smtp' };
      } catch (err: any) {
        console.error('[EmailService] SMTP send failed.');
        return { success: false, link: actionLink, provider: 'smtp', error: err.message };
      }
    }

    // 2. Try Resend if configured
    if (process.env.RESEND_API_KEY) {
      try {
        await sendViaResend(to, subject, html);
        console.log('[EmailService] Email dispatched via Resend.');
        return { success: true, link: actionLink, provider: 'resend' };
      } catch (err: any) {
        console.error('[EmailService] Resend dispatch failed.');
        return { success: false, link: actionLink, provider: 'resend', error: err.message };
      }
    }

    // Do not expose recipient data or one-time action links in logs. They are credentials.
    console.warn('[EmailService] Email was not sent because no mail provider is configured.');

    return { success: false, link: actionLink, provider: 'simulated', error: 'SMTP_NOT_CONFIGURED' };
  }

  /**
   * 1. Send Account Email Verification
   */
  static async sendVerificationEmail(params: {
    to: string;
    fullName: string;
    token: string;
    organizationName: string;
  }): Promise<EmailSendResult> {
    const baseUrl = getAppBaseUrl();
    const verifyLink = `${baseUrl}/verify-email?token=${encodeURIComponent(params.token)}`;
    const subject = `تأكيد بريدك الإلكتروني — صرّاف أوبس | Verify your Sarraf Ops email`;

    const html = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0f19; color: #e2e8f0; margin: 0; padding: 24px; }
    .container { max-width: 580px; margin: 0 auto; background: #131a29; border: 1px solid #1e293b; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    .header { background: linear-gradient(135deg, #1e3a8a 0%, #0f172a 100%); padding: 32px 24px; text-align: center; border-bottom: 1px solid #1e293b; }
    .logo-badge { display: inline-block; background: #2563eb; color: #ffffff; font-weight: 800; font-size: 14px; padding: 6px 16px; border-radius: 9999px; letter-spacing: 1px; margin-bottom: 12px; }
    .title { color: #ffffff; margin: 0; font-size: 22px; font-weight: 700; }
    .content { padding: 32px 24px; line-height: 1.7; font-size: 15px; color: #cbd5e1; }
    .greeting { font-size: 18px; font-weight: 600; color: #ffffff; margin-bottom: 16px; }
    .btn-container { text-align: center; margin: 32px 0; }
    .btn { display: inline-block; background: #2563eb; color: #ffffff !important; text-decoration: none; padding: 14px 36px; border-radius: 10px; font-weight: 700; font-size: 16px; box-shadow: 0 4px 14px rgba(37,99,235,0.4); }
    .link-fallback { background: #0b0f19; padding: 14px; border-radius: 8px; word-break: break-all; font-family: monospace; font-size: 13px; color: #94a3b8; border: 1px solid #1e293b; margin-top: 20px; }
    .footer { padding: 20px 24px; background: #0b0f19; border-top: 1px solid #1e293b; font-size: 12px; color: #64748b; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo-badge">SARRAF OPS | صرّاف أوبس</div>
      <h1 class="title">تأكيد البريد الإلكتروني</h1>
    </div>
    <div class="content">
      <div class="greeting">أهلاً بك يا ${escapeHtml(params.fullName)} 👋</div>
      <p>شكراً لانضمامك إلى <strong>صرّاف أوبس</strong> لمتابعة وتوفيق مدفوعات <strong>${escapeHtml(params.organizationName)}</strong>.</p>
      <p>يرجى تأكيد بريدك الإلكتروني لتفعيل حسابك وضمان استلام تقارير وتنبيهات الأمان اللحظية لعمليات المحافظ الإلكترونية.</p>
      <div class="btn-container">
        <a href="${verifyLink}" class="btn" target="_blank">تأكيد البريد الإلكتروني الآن</a>
      </div>
      <p style="font-size: 13px; color: #94a3b8;">أو يمكنك نسخ الرابط التالي ولصقه في المتصفح:</p>
      <div class="link-fallback">${verifyLink}</div>
    </div>
    <div class="footer">
      هذا الرابط صالح لمدة 24 ساعة. إذا لم تكن قد أنشأت حساباً في صرّاف أوبس، يمكنك تجاهل هذه الرسالة بأمان.
    </div>
  </div>
</body>
</html>
`;

    return this.dispatch(params.to, subject, html, verifyLink);
  }

  /**
   * 2. Send Team Member Invitation
   */
  static async sendTeamInviteEmail(params: {
    to: string;
    inviterName: string;
    organizationName: string;
    role: string;
    token: string;
  }): Promise<EmailSendResult> {
    const baseUrl = getAppBaseUrl();
    const inviteLink = `${baseUrl}/invite/${encodeURIComponent(params.token)}`;
    
    const roleMap: Record<string, string> = {
      admin: 'مدير نظام (Admin)',
      manager: 'مشرف عمليات (Manager)',
      viewer: 'مطلع (Viewer)',
    };
    const roleNameAr = roleMap[params.role] || params.role;

    const subject = `دعوة للانضمام إلى مساحة عمل ${params.organizationName} — صرّاف أوبس`;

    const html = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0f19; color: #e2e8f0; margin: 0; padding: 24px; }
    .container { max-width: 580px; margin: 0 auto; background: #131a29; border: 1px solid #1e293b; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    .header { background: linear-gradient(135deg, #059669 0%, #0f172a 100%); padding: 32px 24px; text-align: center; border-bottom: 1px solid #1e293b; }
    .logo-badge { display: inline-block; background: #10b981; color: #ffffff; font-weight: 800; font-size: 14px; padding: 6px 16px; border-radius: 9999px; letter-spacing: 1px; margin-bottom: 12px; }
    .title { color: #ffffff; margin: 0; font-size: 22px; font-weight: 700; }
    .content { padding: 32px 24px; line-height: 1.7; font-size: 15px; color: #cbd5e1; }
    .greeting { font-size: 18px; font-weight: 600; color: #ffffff; margin-bottom: 16px; }
    .badge-role { display: inline-block; background: #1e293b; border: 1px solid #334155; padding: 4px 12px; border-radius: 6px; font-weight: 700; color: #38bdf8; }
    .btn-container { text-align: center; margin: 32px 0; }
    .btn { display: inline-block; background: #10b981; color: #ffffff !important; text-decoration: none; padding: 14px 36px; border-radius: 10px; font-weight: 700; font-size: 16px; box-shadow: 0 4px 14px rgba(16,185,129,0.4); }
    .link-fallback { background: #0b0f19; padding: 14px; border-radius: 8px; word-break: break-all; font-family: monospace; font-size: 13px; color: #94a3b8; border: 1px solid #1e293b; margin-top: 20px; }
    .footer { padding: 20px 24px; background: #0b0f19; border-top: 1px solid #1e293b; font-size: 12px; color: #64748b; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo-badge">SARRAF OPS | صرّاف أوبس</div>
      <h1 class="title">دعوة انضمام لفريق العمل</h1>
    </div>
    <div class="content">
      <div class="greeting">مرحباً بك 👋</div>
      <p>قام <strong>${escapeHtml(params.inviterName)}</strong> بدعوتك للانضمام إلى مساحة عمل <strong>"${escapeHtml(params.organizationName)}"</strong> على منصة صرّاف أوبس لتوفيق وتدقيق المدفوعات.</p>
      <p>الصلاحية المحددة لك: <span class="badge-role">${roleNameAr}</span></p>
      <div class="btn-container">
        <a href="${inviteLink}" class="btn" target="_blank">قبول الدعوة والانضمام</a>
      </div>
      <p style="font-size: 13px; color: #94a3b8;">أو يمكنك نسخ الرابط التالي ولصقه في المتصفح:</p>
      <div class="link-fallback">${inviteLink}</div>
    </div>
    <div class="footer">
      هذا الرابط مخصص لك وصالح لمدة 7 أيام. إذا لم تكن تتوقع هذه الدعوة، يمكنك تجاهلها بأمان.
    </div>
  </div>
</body>
</html>
`;

    return this.dispatch(params.to, subject, html, inviteLink);
  }

  /**
   * 3. Send Password Reset Email
   */
  static async sendPasswordResetEmail(params: {
    to: string;
    fullName: string;
    token: string;
  }): Promise<EmailSendResult> {
    const baseUrl = getAppBaseUrl();
    const resetLink = `${baseUrl}/login?resetToken=${encodeURIComponent(params.token)}`;
    const subject = `إعادة تعيين كلمة المرور — صرّاف أوبس | Password Reset`;

    const html = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0f19; color: #e2e8f0; margin: 0; padding: 24px; }
    .container { max-width: 580px; margin: 0 auto; background: #131a29; border: 1px solid #1e293b; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    .header { background: linear-gradient(135deg, #dc2626 0%, #0f172a 100%); padding: 32px 24px; text-align: center; border-bottom: 1px solid #1e293b; }
    .logo-badge { display: inline-block; background: #ef4444; color: #ffffff; font-weight: 800; font-size: 14px; padding: 6px 16px; border-radius: 9999px; letter-spacing: 1px; margin-bottom: 12px; }
    .title { color: #ffffff; margin: 0; font-size: 22px; font-weight: 700; }
    .content { padding: 32px 24px; line-height: 1.7; font-size: 15px; color: #cbd5e1; }
    .greeting { font-size: 18px; font-weight: 600; color: #ffffff; margin-bottom: 16px; }
    .btn-container { text-align: center; margin: 32px 0; }
    .btn { display: inline-block; background: #ef4444; color: #ffffff !important; text-decoration: none; padding: 14px 36px; border-radius: 10px; font-weight: 700; font-size: 16px; box-shadow: 0 4px 14px rgba(239,68,68,0.4); }
    .link-fallback { background: #0b0f19; padding: 14px; border-radius: 8px; word-break: break-all; font-family: monospace; font-size: 13px; color: #94a3b8; border: 1px solid #1e293b; margin-top: 20px; }
    .footer { padding: 20px 24px; background: #0b0f19; border-top: 1px solid #1e293b; font-size: 12px; color: #64748b; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo-badge">SARRAF OPS | صرّاف أوبس</div>
      <h1 class="title">إعادة تعيين كلمة المرور</h1>
    </div>
    <div class="content">
      <div class="greeting">أهلاً ${escapeHtml(params.fullName || '')} 👋</div>
      <p>تلقينا طلباً لإعادة تعيين كلمة المرور الخاصة بحسابك على صرّاف أوبس.</p>
      <p>اضغط على الزر التالي لتعيين كلمة مرور جديدة:</p>
      <div class="btn-container">
        <a href="${resetLink}" class="btn" target="_blank">إعادة تعيين كلمة المرور</a>
      </div>
      <p style="font-size: 13px; color: #94a3b8;">أو انسخ الرابط التالي:</p>
      <div class="link-fallback">${resetLink}</div>
    </div>
    <div class="footer">
      هذا الرابط صالح لمدة ساعة واحدة. إذا لم تكن قد طلبت ذلك، يمكنك تجاهل هذه الرسالة دون أي قلق.
    </div>
  </div>
</body>
</html>
`;

    return this.dispatch(params.to, subject, html, resetLink);
  }
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
