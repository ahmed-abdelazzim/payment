import React, { useState, useEffect } from 'react';
import { ProviderType, Transaction, Device } from '../types';

interface SimulateModalProps {
  devices: Device[];
  onClose: () => void;
  onSimulate: (tx: Transaction) => void;
  language: 'en' | 'ar';
}

const PRESETS = [
  {
    label: 'Vodafone Cash: 2,100 EGP (Standard Credit)',
    provider: 'vodafone_cash' as ProviderType,
    deviceId: 'Device #01',
    deviceName: 'Device #01 (Maadi Terminal)',
    senderName: 'Omar Samy',
    senderPhone: '010•••••736',
    amount: 2100.0,
    raw: 'تم استلام مبلغ 2,100 جنيه من 01099182736. رصيد فودافون كاش الحالي 32,070 جنيه. رقم العملية: VF-910283',
    status: 'confirmed' as const,
    confidence: 99.2,
  },
  {
    label: 'InstaPay IPN: 5,500 EGP (Transfer)',
    provider: 'instapay' as ProviderType,
    deviceId: 'Device #02',
    deviceName: 'Device #02 (New Cairo Rail)',
    senderName: 'Mona Zaki',
    senderPhone: 'mona@instapay',
    amount: 5500.0,
    raw: 'InstaPay: EGP 5,500.00 received from mona@instapay. Reference: IPN-8820194.',
    status: 'confirmed' as const,
    confidence: 98.9,
  },
  {
    label: 'Orange Cash: 950 EGP (Suspicious / Missing USSD Check)',
    provider: 'orange_cash' as ProviderType,
    deviceId: 'Device #04',
    deviceName: 'Device #04 (Downtown Kiosk)',
    senderName: 'Unknown Sender',
    senderPhone: '012•••••331',
    amount: 950.0,
    raw: 'تم تحويل مبلغ 950 جنيه من 01288771331. برجاء التأكد من رصيدك عبر #115#.',
    status: 'review_required' as const,
    confidence: 84.0,
    reason: 'SMS notification unverified against USSD string',
  },
  {
    label: 'e& Cash: 430 EGP (Etisalat Mobile)',
    provider: 'etisalat_cash' as ProviderType,
    deviceId: 'Device #05',
    deviceName: 'Device #05 (Alexandria Warehouse)',
    senderName: 'Hassan Fathy',
    senderPhone: '011•••••620',
    amount: 430.0,
    raw: 'تم استلام 430.00 جنيه من حسن فتحي عبر محفظة اتصالات كاش. رقم المعاملة: ET-99214',
    status: 'confirmed' as const,
    confidence: 97.5,
  },
];

export const SimulateModal: React.FC<SimulateModalProps> = ({
  devices,
  onClose,
  onSimulate,
  language,
}) => {
  const [selectedPresetIndex, setSelectedPresetIndex] = useState(0);
  const activePreset = PRESETS[selectedPresetIndex];

  const [provider, setProvider] = useState<ProviderType>(activePreset.provider);
  const [amount, setAmount] = useState<number>(activePreset.amount);
  const [senderName, setSenderName] = useState<string>(activePreset.senderName);
  const [senderPhone, setSenderPhone] = useState<string>(activePreset.senderPhone);
  const [rawMessage, setRawMessage] = useState<string>(activePreset.raw);
  const [deviceId, setDeviceId] = useState<string>(activePreset.deviceId);
  const [status, setStatus] = useState<'confirmed' | 'review_required'>(activePreset.status);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSelectPreset = (index: number) => {
    setSelectedPresetIndex(index);
    const p = PRESETS[index];
    setProvider(p.provider);
    setAmount(p.amount);
    setSenderName(p.senderName);
    setSenderPhone(p.senderPhone);
    setRawMessage(p.raw);
    setDeviceId(p.deviceId);
    setStatus(p.status);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const providerLabels: Record<ProviderType, string> = {
      vodafone_cash: 'Vodafone Cash',
      instapay: 'InstaPay IPN',
      orange_cash: 'Orange Cash',
      etisalat_cash: 'e& Cash',
    };

    const targetDevice = devices.find((d) => d.deviceNumber === deviceId) || devices[0] || {
      deviceNumber: 'Terminal-01',
      location: 'Primary Gateway',
    };

    const newTrxId =
      provider === 'instapay'
        ? `IPN-${Math.floor(100000000 + Math.random() * 900000000)}`
        : provider === 'vodafone_cash'
        ? `VF-${Math.floor(100000 + Math.random() * 900000)}`
        : provider === 'orange_cash'
        ? `OC-${Math.floor(100000 + Math.random() * 900000)}`
        : `ET-${Math.floor(10000 + Math.random() * 90000)}`;

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const newTx: Transaction = {
      id: `tx_${Date.now()}`,
      trxId: newTrxId,
      amount: Number(amount),
      currency: 'EGP',
      provider,
      providerLabel: providerLabels[provider],
      senderName,
      senderPhone,
      timeAgo: 'Just now',
      timestamp: timeStr,
      status,
      confidenceScore: status === 'confirmed' ? 99.2 : 84.0,
      deviceId: targetDevice.deviceNumber,
      deviceName: `${targetDevice.deviceNumber} (${targetDevice.location})`,
      reviewReason: status === 'review_required' ? 'SMS notification unverified against USSD string' : undefined,
      rawMessage,
      signature: Math.random().toString(36).substring(2, 8) + '...' + Math.random().toString(36).substring(2, 5),
      auditTimeline: [
        {
          time: `${timeStr}:01`,
          title: `Captured by Mobile Agent on ${targetDevice.deviceNumber}`,
          detail: 'Agent Latency 89ms · HMAC-SHA256 signature verified',
        },
        {
          time: `${timeStr}:03`,
          title: `Parsed with ${status === 'confirmed' ? '99.2%' : '84.0%'} confidence`,
          detail: `Regex Inbound Parser (${providerLabels[provider]})`,
        },
        {
          time: `${timeStr}:04`,
          title: 'Telegram alert delivered',
          detail: 'Channel: #cairo-vault-bot',
        },
        {
          time: `${timeStr}:05`,
          title: 'Webhook acknowledged (HTTP 200)',
          detail: 'Endpoint: /api/v1/ledger/ingest',
        },
      ],
    };

    onSimulate(newTx);
    onClose();
  };

  return (
    <div 
      className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        className="bg-surface-container-lowest border border-outline-variant rounded-2xl max-w-lg w-full p-6 shadow-2xl animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-outline-variant">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shadow-xs">
              <span className="material-symbols-outlined text-2xl">
                add_card
              </span>
            </div>
            <div>
              <h3 className="text-title-md font-bold text-on-surface">
                {language === 'ar' ? 'محاكاة استلام دفعة لحظية' : 'Simulate Inbound Payment Event'}
              </h3>
              <p className="text-label-xs text-on-surface-variant">
                {language === 'ar' ? 'اختبار مسارات التوجيه والتنبيه اللحظي' : 'Test ingestion rails and instant alert triggers'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-lg transition-colors cursor-pointer"
            aria-label="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Preset Selector */}
        <form onSubmit={handleSubmit} className="py-4 space-y-4 text-body-md text-on-surface">
          <div>
            <label className="text-label-sm text-outline font-semibold block mb-1.5">
              {language === 'ar' ? 'اختر قالب رسالة مصري جاهز:' : 'Select Realistic Egyptian Inbound Template:'}
            </label>
            <div className="grid grid-cols-1 gap-2 max-h-40 overflow-y-auto pr-1">
              {PRESETS.map((p, idx) => (
                <button
                  type="button"
                  key={idx}
                  onClick={() => handleSelectPreset(idx)}
                  className={`px-3.5 py-2.5 rounded-xl text-label-sm text-start border transition-all cursor-pointer ${
                    selectedPresetIndex === idx
                      ? 'bg-primary/10 border-primary text-primary font-bold shadow-xs ring-1 ring-primary/30'
                      : 'bg-surface-container-low border-outline-variant/60 text-on-surface hover:bg-surface-container'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Form fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-label-xs text-outline font-medium block mb-1">
                {language === 'ar' ? 'المبلغ (ج.م):' : 'Amount (EGP):'}
              </label>
              <input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                required
                className="w-full h-10 px-3 bg-surface-container-low border border-outline-variant rounded-xl text-on-surface font-code-num focus:ring-2 focus:ring-primary focus:outline-none transition-all"
              />
            </div>

            <div>
              <label className="text-label-xs text-outline font-medium block mb-1">
                {language === 'ar' ? 'شبكة المزود:' : 'Provider Rail:'}
              </label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as ProviderType)}
                className="w-full h-10 px-3 bg-surface-container-low border border-outline-variant rounded-xl text-on-surface text-label-md focus:ring-2 focus:ring-primary focus:outline-none transition-all cursor-pointer"
              >
                <option value="vodafone_cash">Vodafone Cash</option>
                <option value="instapay">InstaPay (IPN)</option>
                <option value="orange_cash">Orange Cash</option>
                <option value="etisalat_cash">e& Cash</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-label-xs text-outline font-medium block mb-1">
                {language === 'ar' ? 'اسم المرسل:' : 'Sender Name:'}
              </label>
              <input
                type="text"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                required
                className="w-full h-10 px-3 bg-surface-container-low border border-outline-variant rounded-xl text-on-surface focus:ring-2 focus:ring-primary focus:outline-none transition-all"
              />
            </div>

            <div>
              <label className="text-label-xs text-outline font-medium block mb-1">
                {language === 'ar' ? 'هاتف / عنوان المرسل:' : 'Sender Phone / IPN:'}
              </label>
              <input
                type="text"
                value={senderPhone}
                onChange={(e) => setSenderPhone(e.target.value)}
                required
                className="w-full h-10 px-3 bg-surface-container-low border border-outline-variant rounded-xl text-on-surface font-code-num focus:ring-2 focus:ring-primary focus:outline-none transition-all"
              />
            </div>
          </div>

          <div>
            <label className="text-label-xs text-outline font-medium block mb-1">
              {language === 'ar' ? 'نص الرسالة الواردة للجهاز (Raw SMS / Push):' : 'Raw SMS / Push Notification String:'}
            </label>
            <textarea
              rows={2}
              value={rawMessage}
              onChange={(e) => setRawMessage(e.target.value)}
              className="w-full p-2.5 bg-surface-container-low border border-outline-variant rounded-xl text-label-sm font-code-num text-on-surface focus:ring-2 focus:ring-primary focus:outline-none transition-all resize-none"
            />
          </div>

          <div className="flex items-center justify-between p-3 bg-surface-container-low rounded-xl border border-outline-variant">
            <span className="text-label-sm font-semibold">
              {language === 'ar' ? 'حالة التحقق والمطابقة:' : 'Reconciliation Verdict:'}
            </span>
            <div className="flex gap-4">
              <label className="flex items-center gap-1.5 text-label-sm font-medium cursor-pointer">
                <input
                  type="radio"
                  name="status"
                  className="text-primary focus:ring-primary"
                  checked={status === 'confirmed'}
                  onChange={() => setStatus('confirmed')}
                />
                <span className={status === 'confirmed' ? 'text-primary font-bold' : ''}>
                  {language === 'ar' ? 'مؤكدة مباشرة' : 'Confirmed'}
                </span>
              </label>
              <label className="flex items-center gap-1.5 text-label-sm font-medium text-error cursor-pointer">
                <input
                  type="radio"
                  name="status"
                  className="text-error focus:ring-error"
                  checked={status === 'review_required'}
                  onChange={() => setStatus('review_required')}
                />
                <span className={status === 'review_required' ? 'font-bold' : ''}>
                  {language === 'ar' ? 'تحويل للمراجعة' : 'Review Queue'}
                </span>
              </label>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex justify-end gap-3 pt-3 border-t border-outline-variant">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-on-surface-variant hover:bg-surface-container rounded-xl text-label-md font-medium transition-colors cursor-pointer"
            >
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 bg-primary text-on-primary rounded-xl text-label-md font-bold active:scale-95 transition-all shadow-xs hover:bg-primary/90 cursor-pointer"
            >
              {language === 'ar' ? 'إرسال واستيعاب الحدث' : 'Ingest & Reconcile Event'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
