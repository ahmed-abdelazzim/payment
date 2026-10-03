import React, { useState } from 'react';
import { Workspace, ProviderRail, Device } from '../types';

interface OnboardingGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspace: Workspace;
  rails: ProviderRail[];
  devices: Device[];
  transactionsCount: number;
  onOpenAddSource: () => void;
  onOpenPairDevice: () => void;
  onOpenSettings: () => void;
  onNavigateTab?: (tab: string) => void;
  language: 'en' | 'ar';
}

export const OnboardingGuideModal: React.FC<OnboardingGuideModalProps> = ({
  isOpen,
  onClose,
  workspace,
  rails,
  devices,
  transactionsCount,
  onOpenAddSource,
  onOpenPairDevice,
  onOpenSettings,
  onNavigateTab,
  language,
}) => {
  const [activeStep, setActiveStep] = useState<number>(1);

  if (!isOpen) return null;

  const hasSources = rails.length > 0;
  const hasDevices = devices.length > 0;
  const hasOnlineDevice = devices.some((d) => d.status === 'online');
  const hasVerifiedPermissions = devices.some(
    (d) => d.status === 'online' && Boolean(d.verifiedAt) && Boolean(d.notificationListenerGranted)
  );
  const hasLimitsConfigured = rails.some((r) => r.dailyLimit > 0);
  const hasRealPayment = transactionsCount > 0;

  const handleNavigate = (tab: string) => {
    onClose();
    if (onNavigateTab) {
      onNavigateTab(tab);
    }
  };

  const steps = [
    {
      num: 1,
      titleEn: 'Create Merchant Workspace',
      titleAr: 'إنشاء مساحة العمل وإعداد المتجر',
      descEn: `Workspace created for ${workspace.name} with compliant Egyptian Pound (EGP) balance ledger.`,
      descAr: `تم إنشاء مساحة العمل بنجاح باسم "${workspace.nameAr || workspace.name}" ودفتر قيود بالجنيه المصري.`,
      isComplete: true,
      targetTab: 'settings',
      pageNameEn: 'Workspace Settings',
      pageNameAr: 'إعدادات مساحة العمل',
      pageLinkEn: 'Open Workspace Settings',
      pageLinkAr: 'الذهاب إلى صفحة إعدادات المتجر',
      actionTextEn: 'View Settings Page',
      actionTextAr: 'فتح صفحة الإعدادات',
      action: () => handleNavigate('settings'),
      icon: 'domain_verification',
    },
    {
      num: 2,
      titleEn: 'Add Receiving Payment Source',
      titleAr: 'إضافة مصدر استقبال (محفظة أو إنستاباي)',
      descEn: 'Register your Vodafone Cash, InstaPay VPA, Orange Cash, or e& Cash receiving wallet.',
      descAr: 'أضف رقم المحفظة الإلكترونية أو عنوان إنستاباي IPA المخصص لاستقبال أموال العملاء.',
      isComplete: hasSources,
      targetTab: 'rails',
      pageNameEn: 'Payment Rails & Sources',
      pageNameAr: 'مسارات ومصادر الاستقبال',
      pageLinkEn: 'Open Payment Rails page',
      pageLinkAr: 'الذهاب إلى صفحة مسارات الاستقبال',
      actionTextEn: hasSources ? 'Manage Sources' : 'Add Source Now',
      actionTextAr: hasSources ? 'إدارة المسارات' : 'إضافة مصدر استقبال',
      action: () => {
        onClose();
        onOpenAddSource();
      },
      icon: 'account_balance_wallet',
    },
    {
      num: 3,
      titleEn: 'Pair Message Capture Device',
      titleAr: 'ربط جهاز استقبال الإشعارات والرسائل',
      descEn: 'Pair an Android (MacroDroid/Native Agent), Apple Shortcuts, or Huawei terminal via 15-min pairing code.',
      descAr: 'اربط هاتف الاستقبال عبر كود اقتران مشفر لمدة 15 دقيقة، ليتم التقاط الرسائل تلقائياً.',
      isComplete: hasDevices,
      targetTab: 'devices',
      pageNameEn: 'Connected Devices Fleet',
      pageNameAr: 'أسطول أجهزة الربط والاستقبال',
      pageLinkEn: 'Open Devices page',
      pageLinkAr: 'الذهاب إلى صفحة أجهزة الربط',
      actionTextEn: hasDevices ? 'Manage Devices' : 'Pair Device Now',
      actionTextAr: hasDevices ? 'إدارة الأجهزة' : 'ربط جهاز جديد',
      action: () => {
        onClose();
        onOpenPairDevice();
      },
      icon: 'phonelink_ring',
    },
    {
      num: 4,
      titleEn: 'Verify Telemetry & Permissions',
      titleAr: 'التحقق من الاتصال وصلاحيات الالتقاط',
      descEn: hasVerifiedPermissions
        ? 'Verified telemetry proof received from device: Notification listener is active and battery optimization is exempt.'
        : 'Device proof required: Notification listener permission and battery optimization exemption must be confirmed by device heartbeat.',
      descAr: hasVerifiedPermissions
        ? 'تم استلام دليل التحقق من الجهاز: صلاحية الاستماع للإشعارات نشطة وتوفير الطاقة معفى.'
        : 'يتطلب دليلاً من الجهاز: يجب تأكيد تفعيل صلاحية قراءة الإشعارات وإلغاء توفير الطاقة عبر إشارة من الهاتف.',
      isComplete: hasVerifiedPermissions,
      targetTab: 'devices',
      pageNameEn: 'Devices & Permissions',
      pageNameAr: 'فحص الأجهزة والصلاحيات',
      pageLinkEn: 'Inspect on Devices page',
      pageLinkAr: 'الذهاب إلى فحص الأجهزة والصلاحيات',
      actionTextEn: hasVerifiedPermissions ? 'Inspect Devices' : 'Check Device Status',
      actionTextAr: hasVerifiedPermissions ? 'فحص الأجهزة المتصلة' : 'فحص حالة الجهاز والصلاحيات',
      action: () => handleNavigate('devices'),
      icon: 'security',
    },
    {
      num: 5,
      titleEn: 'Configure Regulatory Limits & Alerts',
      titleAr: 'ضبط الحدود والتنبيهات (CBE Caps)',
      descEn: 'Set daily and monthly turnover ceilings with automated alerts at 80% and 90% via Telegram/SMS.',
      descAr: 'اضبط السقف اليومي والشهري للتسوية مع تنبيهات استباقية عند 80% و 90%.',
      isComplete: hasLimitsConfigured,
      targetTab: 'settings',
      pageNameEn: 'Alerts & Organization Settings',
      pageNameAr: 'صفحة الإعدادات والتنبيهات',
      pageLinkEn: 'Open Alerts Settings',
      pageLinkAr: 'الذهاب إلى إعدادات التنبيهات',
      actionTextEn: 'Configure Alerts',
      actionTextAr: 'ضبط التنبيهات في الإعدادات',
      action: () => {
        onClose();
        onOpenSettings();
      },
      icon: 'notifications_active',
    },
    {
      num: 6,
      titleEn: 'Receive First Real Transfer',
      titleAr: 'استقبال أول تحويل حقيقي على الدفتر',
      descEn: 'Your first customer transaction will be parsed, verified, reconciled, and displayed in real time.',
      descAr: 'بمجرد وصول أول رسالة تحويل حقيقية، سيتم مطابقتها فلكياً وتحديث الرصيد اللحظي تلقائياً.',
      isComplete: hasRealPayment,
      targetTab: 'ledger',
      pageNameEn: 'Live Transactions Ledger',
      pageNameAr: 'دفتر العمليات والتحويلات اللحظية',
      pageLinkEn: 'Open Live Ledger',
      pageLinkAr: 'الذهاب إلى دفتر العمليات والتحويلات',
      actionTextEn: hasRealPayment ? 'View Live Ledger' : 'Watch Live Ledger',
      actionTextAr: hasRealPayment ? 'عرض دفتر العمليات' : 'مراقبة دفتر العمليات',
      action: () => handleNavigate('ledger'),
      icon: 'task_alt',
    },
  ];

  const completedCount = steps.filter((s) => s.isComplete).length;
  const progressPercent = Math.round((completedCount / steps.length) * 100);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="p-6 border-b border-outline-variant bg-surface-container-low flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary text-on-primary flex items-center justify-center shadow-xs">
              <span className="material-symbols-outlined text-2xl">rocket_launch</span>
            </div>
            <div>
              <h2 className="text-title-md font-bold text-on-surface">
                {language === 'ar' ? 'دليل البدء السريع وضبط مساحة العمل' : 'Merchant Launchpad & Onboarding'}
              </h2>
              <p className="text-body-sm text-on-surface-variant">
                {language === 'ar'
                  ? '6 خطوات أساسية لتشغيل المراقبة الآلية الآمنة لاستقبال أموالك مع روابط مباشرة لصفحة كل إجراء'
                  : '6 essential steps to automated and secure payment monitoring with direct links to each page'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors cursor-pointer"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        {/* Progress Bar */}
        <div className="px-6 py-4 bg-surface-container-lowest border-b border-outline-variant/60 flex items-center justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center justify-between text-label-sm mb-1.5 font-medium">
              <span className="text-on-surface">
                {language === 'ar' ? 'نسبة اكتمال الإعداد' : 'Setup Progress'}
              </span>
              <span className="font-code-num text-primary font-bold">
                {completedCount} / {steps.length} ({progressPercent}%)
              </span>
            </div>
            <div className="w-full h-2 bg-surface-container-high rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* Steps List */}
        <div className="p-6 overflow-y-auto space-y-4">
          {steps.map((s) => (
            <div
              key={s.num}
              className={`p-4 rounded-xl border transition-all ${
                s.isComplete
                  ? 'bg-surface-container-low/40 border-outline-variant/60'
                  : 'bg-surface-container-lowest border-outline-variant hover:border-primary/50 shadow-xs'
              }`}
            >
              <div className="flex items-start gap-4">
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    s.isComplete
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface-container-high text-on-surface-variant'
                  }`}
                >
                  <span className="material-symbols-outlined text-xl">
                    {s.isComplete ? 'check' : s.icon}
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  {/* Step Header with Hyperlink */}
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-label-sm font-code-num px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant">
                        #{s.num}
                      </span>
                      <h3 className="text-title-sm font-bold text-on-surface">
                        {language === 'ar' ? s.titleAr : s.titleEn}
                      </h3>
                    </div>

                    {/* Direct Page Hyperlink Button */}
                    <button
                      type="button"
                      onClick={() => handleNavigate(s.targetTab)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-label-xs font-semibold text-primary bg-primary/10 hover:bg-primary/20 hover:underline border border-primary/25 transition-all cursor-pointer group shadow-2xs"
                      title={language === 'ar' ? `فتح ${s.pageNameAr}` : `Go to ${s.pageNameEn}`}
                    >
                      <span className="material-symbols-outlined text-[15px] group-hover:scale-110 transition-transform">
                        open_in_new
                      </span>
                      <span>{language === 'ar' ? s.pageLinkAr : s.pageLinkEn}</span>
                    </button>
                  </div>

                  <p className="text-body-sm text-on-surface-variant mb-3">
                    {language === 'ar' ? s.descAr : s.descEn}
                  </p>

                  {/* Actions & Status Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-outline-variant/40">
                    <span
                      className={`text-label-sm font-semibold flex items-center gap-1.5 ${
                        s.isComplete ? 'text-primary' : 'text-on-surface-variant'
                      }`}
                    >
                      <span className="material-symbols-outlined text-sm">
                        {s.isComplete ? 'verified' : 'pending'}
                      </span>
                      <span>
                        {s.isComplete
                          ? language === 'ar'
                            ? 'مكتمل'
                            : 'Completed'
                          : language === 'ar'
                          ? 'بانتظار الإجراء'
                          : 'Action Needed'}
                      </span>
                    </span>

                    <div className="flex items-center gap-2">
                      {/* Secondary textual link if there is a primary modal button */}
                      {s.action && !s.isComplete && (
                        <button
                          type="button"
                          onClick={s.action}
                          className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-label-sm font-semibold hover:bg-primary/90 transition-all flex items-center gap-1 shadow-xs cursor-pointer active:scale-95"
                        >
                          <span>{language === 'ar' ? s.actionTextAr : s.actionTextEn}</span>
                          <span className="material-symbols-outlined text-sm">arrow_forward</span>
                        </button>
                      )}

                      {/* If completed or no separate modal, provide an direct open page button */}
                      {(s.isComplete || !s.action) && (
                        <button
                          type="button"
                          onClick={() => handleNavigate(s.targetTab)}
                          className="px-2.5 py-1 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-label-xs font-semibold transition-all flex items-center gap-1 cursor-pointer border border-outline-variant/60"
                        >
                          <span className="material-symbols-outlined text-xs text-primary">arrow_forward</span>
                          <span>{language === 'ar' ? s.actionTextAr : s.actionTextEn}</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-outline-variant bg-surface-container-low flex items-center justify-between">
          <span className="text-label-sm text-on-surface-variant">
            {language === 'ar'
              ? 'يمكنك العودة لهذا الدليل في أي وقت من القائمة الجانبية أو الزر العلوي'
              : 'You can revisit this onboarding guide anytime from the top bar or side menu'}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-surface-container-high text-on-surface hover:bg-surface-container font-semibold text-label-md transition-all cursor-pointer"
          >
            {language === 'ar' ? 'إغلاق ومتابعة' : 'Close & Continue'}
          </button>
        </div>
      </div>
    </div>
  );
};
