import React, { useState } from 'react';
import { Device, ProviderRail } from '../types';
import { apiFetch } from '../api';

interface PairingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDevicePaired: (device: Device) => void;
  rails: ProviderRail[];
  language: 'en' | 'ar';
}

export const PairingModal: React.FC<PairingModalProps> = ({
  isOpen,
  onClose,
  onDevicePaired,
  rails,
  language,
}) => {
  const [friendlyName, setFriendlyName] = useState('');
  const [deviceIdentifier, setDeviceIdentifier] = useState(`POS-${Math.floor(100 + Math.random() * 900)}`);
  const [location, setLocation] = useState('');
  const [adapterType, setAdapterType] = useState<'macrodroid' | 'native_agent' | 'apple_shortcuts' | 'huawei_emui'>('macrodroid');
  const [paymentSourceId, setPaymentSourceId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Result state
  const [pairingResult, setPairingResult] = useState<{
    deviceId: string;
    pairingCode: string;
    expiresAt: string;
  } | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentSourceId) {
      setError(language === 'ar' ? 'اختر محفظة أو حساب الاستقبال الذي سيتبعه هذا الجهاز.' : 'Select the receiving source this device will monitor.');
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const res = await apiFetch('/api/v1/devices', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          friendlyName,
          deviceIdentifier,
          location: location || 'Main Terminal Gate',
          adapterType,
          paymentSourceId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to issue pairing code');
      }

      setPairingResult({
        deviceId: data.deviceId,
        pairingCode: data.pairingCode,
        expiresAt: data.expiresAt,
      });

      const selectedRail = rails.find((rail) => rail.id === paymentSourceId);
      onDevicePaired({
        id: data.deviceId,
        deviceNumber: deviceIdentifier,
        name: friendlyName,
        location: location || 'Main Terminal',
        provider: selectedRail?.provider || 'vodafone_cash',
        providerLabel: selectedRail?.name || 'Receiving source',
        phoneNumber: selectedRail?.walletNumber || '',
        status: 'online',
        batteryLevel: 100,
        lastPing: 'Just paired',
        txnsToday: 0,
        volumeToday: 0,
        agentVersion: 'v3.4.1-eg',
        configVersion: 'cfg-v1.4',
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCode = () => {
    if (pairingResult) {
      navigator.clipboard.writeText(pairingResult.pairingCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-5 animate-in fade-in zoom-in-95">
        <div className="flex items-center justify-between pb-3 border-b border-outline-variant">
          <div className="flex items-center gap-2 text-primary">
            <span className="material-symbols-outlined text-2xl">phonelink_ring</span>
            <h3 className="text-title-md font-bold text-on-surface">
              {language === 'ar' ? 'ربط جهاز استقبال رسائل الدفع' : 'Pair Payment Capture Device'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-on-surface-variant hover:bg-surface-container"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-error-container/20 text-error text-body-sm flex items-center gap-2">
            <span className="material-symbols-outlined text-base">error</span>
            <span>{error}</span>
          </div>
        )}

        {!pairingResult ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-label-md text-on-surface font-medium mb-1">
                {language === 'ar' ? 'اسم الجهاز التعريفي' : 'Device Friendly Name'}
              </label>
              <input
                type="text"
                required
                value={friendlyName}
                onChange={(e) => setFriendlyName(e.target.value)}
                placeholder={language === 'ar' ? 'هاتف كاشير المعادي 1' : 'Maadi POS Main Phone'}
                className="w-full px-3.5 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-body-md focus:ring-2 focus:ring-primary focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-label-md text-on-surface font-medium mb-1">
                  {language === 'ar' ? 'معرّف الجهاز (Terminal ID)' : 'Terminal Identifier'}
                </label>
                <input
                  type="text"
                  required
                  value={deviceIdentifier}
                  onChange={(e) => setDeviceIdentifier(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest font-code-num text-on-surface text-body-md focus:ring-2 focus:ring-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-label-md text-on-surface font-medium mb-1">
                  {language === 'ar' ? 'الموقع / الفرع' : 'Location / Branch'}
                </label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder={language === 'ar' ? 'فرع المهندسين' : 'Downtown Branch'}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-body-md focus:ring-2 focus:ring-primary focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-label-md text-on-surface font-medium mb-1">
                {language === 'ar' ? 'محفظة أو حساب الاستقبال المرتبط بالجهاز' : 'Receiving source monitored by this device'}
              </label>
              <select
                required
                value={paymentSourceId}
                onChange={(e) => setPaymentSourceId(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-body-md focus:ring-2 focus:ring-primary focus:outline-none"
              >
                <option value="">
                  {language === 'ar' ? 'اختر مصدر الاستقبال' : 'Select a receiving source'}
                </option>
                {rails.map((rail) => (
                  <option key={rail.id} value={rail.id}>
                    {rail.name} · {rail.walletNumber}
                  </option>
                ))}
              </select>
              {rails.length === 0 && (
                <p className="mt-1.5 text-label-sm text-error">
                  {language === 'ar' ? 'أضف مصدر استقبال أولاً قبل ربط هاتف.' : 'Add a receiving source before pairing a phone.'}
                </p>
              )}
            </div>

            <div>
              <label className="block text-label-md text-on-surface font-medium mb-1">
                {language === 'ar' ? 'نوع نظام التشغيل ومحوّل الالتقاط' : 'Operating System & Adapter'}
              </label>
              <select
                value={adapterType}
                onChange={(e) => setAdapterType(e.target.value as any)}
                className="w-full px-3.5 py-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-body-md focus:ring-2 focus:ring-primary focus:outline-none"
              >
                <option value="macrodroid">Android - MacroDroid (مستقر وموصى به)</option>
                <option value="native_agent">Android - Native Daemon Agent (خدمة خلفية بدون واجهة)</option>
                <option value="apple_shortcuts">Apple iOS - Shortcuts Webhook (التقاط عبر الاختصارات)</option>
                <option value="huawei_emui">Huawei EMUI / HarmonyOS (استثناء PowerGenie)</option>
              </select>
            </div>

            <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/60 text-label-sm text-on-surface-variant">
              {language === 'ar'
                ? 'سيتم توليد كود اقتران مشفر صالح لمدة 15 دقيقة لربط الجهاز بالخادم بأمان.'
                : 'A cryptographic one-time pairing code valid for 15 minutes will be issued.'}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-label-md font-semibold text-on-surface-variant hover:bg-surface-container"
              >
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={loading || rails.length === 0}
                className="px-5 py-2.5 rounded-lg bg-primary text-on-primary text-label-md font-semibold hover:bg-primary/90 transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {loading ? (
                  <span className="material-symbols-outlined animate-spin text-base">progress_activity</span>
                ) : (
                  <span className="material-symbols-outlined text-base">vpn_key</span>
                )}
                <span>{language === 'ar' ? 'توليد كود الاقتران' : 'Generate Pairing Code'}</span>
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="p-5 rounded-2xl bg-surface-container-low border border-outline-variant text-center space-y-2">
              <span className="text-label-sm text-on-surface-variant block">
                {language === 'ar' ? 'كود الاقتران السريع (صالح لمدة 15 دقيقة)' : 'One-Time Pairing Code (Expires in 15m)'}
              </span>
              <div className="text-display-sm font-bold font-code-num text-primary tracking-widest py-1">
                {pairingResult.pairingCode}
              </div>
              <button
                type="button"
                onClick={handleCopyCode}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-surface-container border border-outline-variant text-label-sm font-medium hover:bg-surface-container-high transition-all"
              >
                <span className="material-symbols-outlined text-sm">
                  {copiedCode ? 'check' : 'content_copy'}
                </span>
                <span>{copiedCode ? (language === 'ar' ? 'تم النسخ!' : 'Copied!') : (language === 'ar' ? 'نسخ الكود' : 'Copy Code')}</span>
              </button>
            </div>

            <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant space-y-2.5 text-xs text-on-surface-variant">
              <div className="flex items-center gap-1.5 font-bold text-on-surface">
                <span className="material-symbols-outlined text-primary text-base">shield</span>
                <span>{language === 'ar' ? 'إعداد آمن عبر تطبيق Sarraf Adapter' : 'Secure setup through the Sarraf Adapter'}</span>
              </div>
              <ol className="list-decimal list-inside space-y-1.5">
                <li>{language === 'ar' ? 'افتح تطبيق Sarraf Adapter على هاتف الاستقبال واختر ربط جهاز.' : 'Open the Sarraf Adapter on the capture phone and choose Pair device.'}</li>
                <li>{language === 'ar' ? 'أدخل هذا الرمز مرة واحدة. سيستلم التطبيق بيانات الاعتماد المخصصة للجهاز.' : 'Enter this one-time code. The adapter will receive device-scoped credentials.'}</li>
                <li>{language === 'ar' ? 'يوقّع التطبيق كل رسالة قبل إرسالها إلى المنصة؛ لا تستخدم روابط تحتوي على كود الاقتران.' : 'The adapter signs every message before sending it to the platform; do not use URLs containing a pairing code.'}</li>
              </ol>
              <p className="pt-1 text-[11px]">
                {language === 'ar'
                  ? 'فعّل صلاحية قراءة الإشعارات أو الرسائل واستثنِ التطبيق من توفير البطارية حسب نظام الهاتف.'
                  : 'Grant the required notification/SMS permission and exempt the adapter from battery optimization for this phone.'}
              </p>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 rounded-lg bg-primary text-on-primary text-label-md font-semibold hover:bg-primary/90 transition-all"
              >
                {language === 'ar' ? 'تم، إغلاق والعودة للأجهزة' : 'Done, Back to Terminals'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
