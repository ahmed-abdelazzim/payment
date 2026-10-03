import React from 'react';
import { SubscriptionReceipt } from '../types';

interface ReceiptModalProps {
  receipt: SubscriptionReceipt | null;
  onClose: () => void;
  language: 'en' | 'ar';
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({ receipt, onClose, language }) => {
  if (!receipt) return null;

  const handlePrint = () => {
    window.print();
  };

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 print:border-none print:shadow-none">
        {/* Header */}
        <div className="p-6 bg-surface-container-low border-b border-outline-variant flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary text-on-primary flex items-center justify-center shadow-xs">
              <span className="material-symbols-outlined text-2xl">receipt_long</span>
            </div>
            <div>
              <h2 className="text-title-md font-bold text-on-surface">
                {language === 'ar' ? 'إيصال سداد الاشتراك' : 'Subscription Receipt'}
              </h2>
              <span className="text-label-xs font-mono text-primary font-bold">
                {receipt.receipt_number}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors cursor-pointer print:hidden"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        {/* Receipt Content */}
        <div className="p-6 space-y-5 text-on-surface">
          {/* Status Badge */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-primary/10 border border-primary/20">
            <div className="flex items-center gap-2 text-primary font-bold text-label-md">
              <span className="material-symbols-outlined text-lg">verified</span>
              <span>{language === 'ar' ? 'تم تأكيد السداد وتفعيل الباقة' : 'Payment Verified & Plan Active'}</span>
            </div>
            <span className="font-mono text-title-md font-extrabold text-primary">
              {receipt.amount_paid.toLocaleString()} ج.م
            </span>
          </div>

          {/* Details Table */}
          <div className="space-y-2.5 text-body-sm">
            <div className="flex items-center justify-between py-1.5 border-b border-outline-variant/50">
              <span className="text-on-surface-variant">{language === 'ar' ? 'المؤسسة / المتجر:' : 'Organization:'}</span>
              <span className="font-bold">{language === 'ar' ? receipt.org_name_ar || receipt.org_name : receipt.org_name || receipt.org_name_ar}</span>
            </div>

            <div className="flex items-center justify-between py-1.5 border-b border-outline-variant/50">
              <span className="text-on-surface-variant">{language === 'ar' ? 'الباقة المشتركة:' : 'Plan:'}</span>
              <span className="font-bold text-primary">{language === 'ar' ? receipt.plan_name_ar || receipt.plan_name_en : receipt.plan_name_en || receipt.plan_name_ar}</span>
            </div>

            <div className="flex items-center justify-between py-1.5 border-b border-outline-variant/50">
              <span className="text-on-surface-variant">{language === 'ar' ? 'دورة الاشتراك:' : 'Billing Cycle:'}</span>
              <span className="font-semibold">
                {receipt.billing_cycle === 'annual'
                  ? language === 'ar' ? 'سنوي (12 شهر تقويمي)' : 'Annual (12 Calendar Months)'
                  : language === 'ar' ? 'شهري (شهر تقويمي)' : 'Monthly (1 Calendar Month)'}
              </span>
            </div>

            <div className="flex items-center justify-between py-1.5 border-b border-outline-variant/50">
              <span className="text-on-surface-variant">{language === 'ar' ? 'فترة الصلاحية:' : 'Entitlement Period:'}</span>
              <span className="font-medium text-label-sm">
                {formatDate(receipt.period_start)} — {formatDate(receipt.period_end)}
              </span>
            </div>

            <div className="flex items-center justify-between py-1.5 border-b border-outline-variant/50">
              <span className="text-on-surface-variant">{language === 'ar' ? 'طريقة الدفع المعتمدة:' : 'Payment Channel:'}</span>
              <span className="font-semibold">{language === 'ar' ? 'تحويل يدوي إنستاباي (InstaPay)' : 'Manual InstaPay Transfer'}</span>
            </div>

            {receipt.matched_external_trx_id && (
              <div className="flex items-center justify-between py-1.5 border-b border-outline-variant/50">
                <span className="text-on-surface-variant">{language === 'ar' ? 'رقم مرجع التحويل المطابق:' : 'Matched Transfer Ref:'}</span>
                <span className="font-mono text-label-xs font-bold text-on-surface bg-surface-container px-2 py-0.5 rounded">
                  {receipt.matched_external_trx_id}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between py-1.5">
              <span className="text-on-surface-variant">{language === 'ar' ? 'تاريخ الإصدار:' : 'Issued At:'}</span>
              <span className="text-label-sm text-on-surface-variant">{formatDate(receipt.issued_at)}</span>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-surface-container-low text-label-xs text-on-surface-variant border border-outline-variant/60">
            {language === 'ar'
              ? 'إيصال إلكتروني صادر وموثق آلياً من منصة صرّاف لتأكيد اشتراك المتجر وصلاحيات ربط هواتف الالتقاط.'
              : 'Official electronic receipt generated and validated by Sarraf Ops for subscription entitlement and device capture limits.'}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-outline-variant bg-surface-container-low flex items-center justify-between print:hidden">
          <button
            onClick={handlePrint}
            className="px-4 py-2 rounded-lg bg-surface-container-high hover:bg-surface-container text-on-surface text-label-sm font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <span className="material-symbols-outlined text-base">print</span>
            <span>{language === 'ar' ? 'طباعة الإيصال' : 'Print Receipt'}</span>
          </button>

          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-primary text-on-primary text-label-sm font-semibold hover:bg-primary/90 transition-all cursor-pointer"
          >
            {language === 'ar' ? 'إغلاق' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
};
