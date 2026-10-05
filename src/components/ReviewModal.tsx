import React, { useEffect } from 'react';
import { Transaction } from '../types';

interface ReviewModalProps {
  transaction: Transaction | null;
  onClose: () => void;
  onApprove: (tx: Transaction) => void;
  onReject: (tx: Transaction) => void;
  language: 'en' | 'ar';
}

export const ReviewModal: React.FC<ReviewModalProps> = ({
  transaction,
  onClose,
  onApprove,
  onReject,
  language,
}) => {
  // ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!transaction) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-outline-variant">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-error/10 text-error flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-2xl">
                notification_important
              </span>
            </div>
            <div>
              <h3 className="text-title-md font-bold text-on-surface">
                {language === 'ar' ? 'مركز التحقق والمطابقة اليدوية' : 'Operator Reconciliation Review'}
              </h3>
              <p className="text-label-xs font-code-num text-on-surface-variant">
                {transaction.trxId} · {transaction.deviceName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-on-surface-variant hover:bg-surface-container rounded-lg cursor-pointer"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4 text-body-sm text-on-surface">
          {/* Financial Summary Box */}
          <div className="p-4 rounded-xl bg-error-container/20 border border-error/30 flex items-center justify-between">
            <div>
              <span className="text-label-xs text-outline uppercase font-semibold block mb-0.5">
                {language === 'ar' ? 'المبلغ المعلق للمراجعة' : 'Pending Amount'}
              </span>
              <span className="text-headline-sm font-extrabold font-code-num text-error">
                +{transaction.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} {transaction.currency}
              </span>
            </div>

            <div className="text-right rtl:text-left">
              <span className="text-label-xs text-outline uppercase font-semibold block mb-0.5">
                {language === 'ar' ? 'درجة الثقة البرمجية' : 'Parser Score'}
              </span>
              <span className="text-title-md font-extrabold font-code-num text-error">
                {transaction.confidenceScore || 88}%
              </span>
            </div>
          </div>

          {/* Anomaly & Warning Reason */}
          <div className="p-3.5 bg-surface-container-low border border-outline-variant rounded-xl space-y-1">
            <span className="text-label-xs text-outline block font-semibold">
              {language === 'ar' ? 'سبب التحويل للمراجعة:' : 'Reconciliation Anomaly Reason:'}
            </span>
            <p className="text-body-sm text-error font-bold">
              {transaction.reviewReason || 'SMS notification unverified against official bank/wallet string'}
            </p>
            <p className="text-label-xs text-on-surface-variant leading-relaxed">
              {language === 'ar'
                ? 'وفقاً لمعايير الأمان المالي، لا يتم اعتبار مجرد مطابقة النص أو حساب الرصيد إثباتاً لتسوية البنك. تم تعليق الإشعار التلقائي لحين موافقة المشغل يدوياً.'
                : 'In accordance with financial security standards, message parsing alone does NOT prove bank settlement. Downstream fulfillment is suspended until operator verification.'}
            </p>
          </div>

          {/* Raw Message Ingestion */}
          <div>
            <span className="text-label-xs text-outline uppercase font-semibold block mb-1">
              {language === 'ar' ? 'النص الأصلي الوارد للجهاز (Raw Payload):' : 'Raw Message Payload from Capture Device:'}
            </span>
            <pre className="p-3 bg-surface-container-low rounded-xl border border-outline-variant text-label-xs font-code-num text-on-surface whitespace-pre-wrap select-all max-h-28 overflow-y-auto">
              {transaction.rawMessage || 'تم استلام تحويل غير مؤكد برمجياً'}
            </pre>
          </div>

          {/* Field Extraction Breakdown */}
          <div className="grid grid-cols-2 gap-3 text-label-xs p-3 bg-surface-container-low rounded-xl border border-outline-variant">
            <div>
              <span className="text-outline block mb-0.5">
                {language === 'ar' ? 'هاتف المرسل:' : 'Sender Phone:'}
              </span>
              <span className="font-code-num font-semibold text-on-surface">{transaction.senderPhone}</span>
            </div>
            <div>
              <span className="text-outline block mb-0.5">
                {language === 'ar' ? 'مسار المزود:' : 'Provider Rail:'}
              </span>
              <span className="font-semibold text-on-surface">{transaction.providerLabel}</span>
            </div>
            <div>
              <span className="text-outline block mb-0.5">
                {language === 'ar' ? 'جهاز الالتقاط:' : 'Capture Device:'}
              </span>
              <span className="font-code-num text-on-surface">{transaction.deviceId}</span>
            </div>
            <div>
              <span className="text-outline block mb-0.5">
                {language === 'ar' ? 'التوقيع المشفر:' : 'Cryptographic Sig:'}
              </span>
              <span className="font-code-num text-primary truncate block select-all">
                {transaction.signature || '3e110b...a44'}
              </span>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-outline-variant">
          <button
            onClick={() => onReject(transaction)}
            className="w-full sm:w-auto px-4 py-2 bg-error-container/20 hover:bg-error-container/40 text-error rounded-xl text-label-sm font-bold border border-error/30 active:scale-95 transition-all cursor-pointer"
          >
            {language === 'ar' ? 'رفض / رسالة وهمية' : 'Reject as Suspicious'}
          </button>

          <div className="w-full sm:w-auto flex items-center gap-2">
            <button
              onClick={onClose}
              className="flex-1 sm:flex-initial px-4 py-2 text-on-surface-variant hover:bg-surface-container rounded-xl text-label-sm font-semibold transition-colors cursor-pointer"
            >
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              onClick={() => onApprove(transaction)}
              className="flex-1 sm:flex-initial px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-label-sm font-bold active:scale-95 transition-all shadow-xs cursor-pointer flex items-center justify-center gap-1.5"
            >
              <span className="material-symbols-outlined text-sm">check</span>
              <span>{language === 'ar' ? 'اعتماد كعملية صحيحة' : 'Approve Payment'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
