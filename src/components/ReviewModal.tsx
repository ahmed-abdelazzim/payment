import React from 'react';
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
  if (!transaction) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl max-w-lg w-full p-space-lg shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between pb-space-sm border-b border-outline-variant">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-error text-2xl">
              notification_important
            </span>
            <div>
              <h3 className="text-title-md font-bold text-on-surface">
                {language === 'ar' ? 'مركز التحقق والمطابقة (القسم 12A)' : 'Operator Reconciliation Review (Section 12A)'}
              </h3>
              <p className="text-label-sm text-on-surface-variant">
                {transaction.trxId} · {transaction.deviceName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-on-surface-variant hover:bg-surface-container rounded"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="py-space-md space-y-space-md text-body-md text-on-surface">
          {/* Financial Summary Box */}
          <div className="p-space-sm rounded bg-error-container/20 border border-error/40 flex items-center justify-between">
            <div>
              <span className="text-label-sm text-outline uppercase block">
                {language === 'ar' ? 'المبلغ المعلق' : 'Pending Amount'}
              </span>
              <span className="text-headline-sm font-bold font-code-num text-error">
                +{transaction.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} {transaction.currency}
              </span>
            </div>

            <div className="text-right">
              <span className="text-label-sm text-outline uppercase block">
                {language === 'ar' ? 'درجة الثقة' : 'Parser Score'}
              </span>
              <span className="text-title-md font-bold font-code-num text-error">
                {transaction.confidenceScore || 88}%
              </span>
            </div>
          </div>

          {/* Anomaly & Warning Reason */}
          <div className="p-space-sm bg-surface-container-low border border-outline-variant rounded-lg space-y-1">
            <span className="text-label-sm text-outline block">
              {language === 'ar' ? 'سبب التحويل للمراجعة:' : 'Reconciliation Anomaly Reason:'}
            </span>
            <p className="text-body-md text-error font-semibold">
              {transaction.reviewReason || 'SMS notification unverified against USSD string'}
            </p>
            <p className="text-label-sm text-on-surface-variant">
              {language === 'ar'
                ? 'وفقاً لـ Section 12A، لا يتم اعتبار مجرد مطابقة النص أو حساب الرصيد إثباتاً لتسوية البنك. تم تعليق الإشعار التلقائي لحين موافقة المشغل.'
                : 'In accordance with Section 12A, message parsing or balance arithmetic alone does NOT prove bank settlement. Downstream fulfillment is suspended until operator verification.'}
            </p>
          </div>

          {/* Raw Message Ingestion */}
          <div>
            <span className="text-label-sm text-outline uppercase block mb-1">
              {language === 'ar' ? 'النص الأصلي الوارد للجهاز (Raw Payload):' : 'Raw Message Payload from Capture Device:'}
            </span>
            <pre className="p-space-sm bg-surface-container-low rounded border border-outline-variant text-label-sm font-code-num text-on-surface whitespace-pre-wrap select-all">
              {transaction.rawMessage || 'تم استلام تحويل غير مؤكد برمجياً'}
            </pre>
          </div>

          {/* Field Extraction Breakdown */}
          <div className="grid grid-cols-2 gap-2 text-label-sm p-space-sm bg-surface-bright rounded border border-outline-variant">
            <div>
              <span className="text-outline block">Sender Phone:</span>
              <span className="font-code-num font-semibold">{transaction.senderPhone}</span>
            </div>
            <div>
              <span className="text-outline block">Provider Rail:</span>
              <span className="font-semibold">{transaction.providerLabel}</span>
            </div>
            <div>
              <span className="text-outline block">Capture Device:</span>
              <span className="font-code-num">{transaction.deviceId}</span>
            </div>
            <div>
              <span className="text-outline block">Cryptographic Sig:</span>
              <span className="font-code-num text-secondary truncate block">
                {transaction.signature || '3e110b...a44'}
              </span>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-space-sm border-t border-outline-variant">
          <button
            onClick={() => onReject(transaction)}
            className="w-full sm:w-auto px-3.5 py-2 bg-surface-container-low hover:bg-error-container text-error rounded text-label-md font-semibold border border-error/30 active:scale-95 transition-all"
          >
            {language === 'ar' ? 'رفض / رسالة وهمية' : 'Reject as Suspicious'}
          </button>

          <div className="w-full sm:w-auto flex items-center gap-2">
            <button
              onClick={onClose}
              className="flex-1 sm:flex-initial px-3.5 py-2 text-on-surface-variant hover:bg-surface-container rounded text-label-md"
            >
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              onClick={() => onApprove(transaction)}
              className="flex-1 sm:flex-initial px-4 py-2 bg-primary text-on-primary rounded text-label-md font-semibold active:scale-95 transition-all shadow-sm"
            >
              {language === 'ar' ? 'اعتماد كعملية صحيحة ✓' : 'Approve Payment ✓'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
