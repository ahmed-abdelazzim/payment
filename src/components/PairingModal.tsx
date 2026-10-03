import React, { useState } from 'react';
import { Device } from '../types';

interface PairingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDevicePaired: (device: Device) => void;
  language: 'en' | 'ar';
}

export const PairingModal: React.FC<PairingModalProps> = ({
  isOpen,
  onClose,
  onDevicePaired,
  language,
}) => {
  const [friendlyName, setFriendlyName] = useState('');
  const [deviceIdentifier, setDeviceIdentifier] = useState(`POS-${Math.floor(100 + Math.random() * 900)}`);
  const [location, setLocation] = useState('');
  const [adapterType, setAdapterType] = useState<'macrodroid' | 'native_agent' | 'apple_shortcuts' | 'huawei_emui'>('macrodroid');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Result state
  const [pairingResult, setPairingResult] = useState<{
    deviceId: string;
    pairingCode: string;
    expiresAt: string;
  } | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedBody, setCopiedBody] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/v1/devices', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('sarraf_session_token') || ''}`,
        },
        body: JSON.stringify({
          friendlyName,
          deviceIdentifier,
          location: location || 'Main Terminal Gate',
          adapterType,
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

      onDevicePaired({
        id: data.deviceId,
        deviceNumber: deviceIdentifier,
        name: friendlyName,
        location: location || 'Main Terminal',
        provider: 'vodafone_cash',
        providerLabel: 'Vodafone Cash',
        phoneNumber: '01019283921',
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
                disabled={loading}
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

            {/* Direct Webhook URL Box */}
            <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-primary text-base">link</span>
                  <span>{language === 'ar' ? 'رابط الـ Webhook المباشر (لـ MacroDroid)' : 'Direct Webhook URL (for MacroDroid)'}</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const url = `${window.location.origin}/api/v1/devices/webhook-ingest?token=${pairingResult.pairingCode}`;
                    navigator.clipboard.writeText(url);
                    setCopiedCode(true);
                    setTimeout(() => setCopiedCode(false), 2000);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-primary text-on-primary text-xs font-semibold hover:bg-primary/90 transition-all cursor-pointer flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-xs">content_copy</span>
                  <span>{copiedCode ? (language === 'ar' ? 'تم النسخ!' : 'Copied!') : (language === 'ar' ? 'نسخ الرابط' : 'Copy URL')}</span>
                </button>
              </div>
              <div className="p-2.5 rounded-lg bg-surface-container-lowest font-mono text-xs text-primary break-all border border-outline-variant/60 select-all">
                {`${typeof window !== 'undefined' ? window.location.origin : ''}/api/v1/devices/webhook-ingest?token=${pairingResult.pairingCode}`}
              </div>
            </div>

            {/* Platform Instructions */}
            <div className="space-y-2">
              <h4 className="text-label-md font-bold text-on-surface">
                {language === 'ar' ? 'خطوات التفعيل على هاتف الاستقبال (MacroDroid):' : 'Terminal Activation Steps (MacroDroid):'}
              </h4>
              <div className="text-xs text-on-surface-variant space-y-2 bg-surface-container-lowest p-3.5 rounded-xl border border-outline-variant/60">
                {adapterType === 'macrodroid' ? (
                  <>
                    <p className="font-semibold text-on-surface">
                      {language === 'ar' ? '1. في تطبيق MacroDroid: اضغط على إضافة ماكرو (+ Add Macro)' : '1. In MacroDroid: Tap Add Macro (+)'}
                    </p>
                    <p>
                      {language === 'ar'
                        ? '2. المشغلات (Triggers - أحمر): اختر Calls / SMS -> SMS Received -> Any Number.'
                        : '2. Triggers (Red): Choose Calls / SMS -> SMS Received -> Any Number.'}
                    </p>
                    <p>
                      {language === 'ar'
                        ? '3. الإجراءات (Actions - أزرق): اختر Connectivity -> HTTP Request -> Method: POST والصق الرابط المنسوخ أعلاه.'
                        : '3. Actions (Blue): Choose Connectivity -> HTTP Request -> Method: POST and paste the Webhook URL above.'}
                    </p>
                    <div className="bg-surface-container-low p-3 rounded-lg border border-outline-variant/40 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-on-surface">
                          {language === 'ar' ? 'محتوى الطلب (Request Body - JSON):' : 'Request Body (JSON):'}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const bodyJson = '{"sms_message": "{sms_message}", "sms_number": "{sms_number}", "battery": "{battery}", "device_model": "{device_model}", "power": "{power}"}';
                            navigator.clipboard.writeText(bodyJson);
                            setCopiedBody(true);
                            setTimeout(() => setCopiedBody(false), 2000);
                          }}
                          className="px-2 py-0.5 rounded bg-surface-container border border-outline-variant text-[10px] font-semibold text-primary hover:bg-surface-container-high transition-all flex items-center gap-1 cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[12px]">{copiedBody ? 'check' : 'content_copy'}</span>
                          <span>{copiedBody ? (language === 'ar' ? 'تم النسخ!' : 'Copied!') : (language === 'ar' ? 'نسخ النص' : 'Copy JSON')}</span>
                        </button>
                      </div>
                      <code className="text-[11px] font-mono text-emerald-400 select-all block break-all">
                        {`{"sms_message": "{sms_message}", "sms_number": "{sms_number}", "battery": "{battery}", "device_model": "{device_model}", "power": "{power}"}`}
                      </code>
                    </div>
                    <p className="text-[11px] text-amber-400/90 font-medium">
                      {language === 'ar'
                        ? '⚠️ تأكد من تفعيل صلاحية "قراءة الرسائل والإشعارات" واستثناء MacroDroid من "توفير البطارية".'
                        : '⚠️ Make sure to grant SMS/Notification permissions and exclude MacroDroid from battery optimization.'}
                    </p>
                  </>
                ) : (
                  <ol className="list-decimal list-inside space-y-1">
                    <li>{language === 'ar' ? `كود الربط المعتمد: ${pairingResult.pairingCode}` : `Pairing Code: ${pairingResult.pairingCode}`}</li>
                    <li>{language === 'ar' ? 'عيّن إرسال محتوى الرسائل إلى نقطة الويب هوك.' : 'Dispatch SMS contents to the webhook.'}</li>
                  </ol>
                )}
              </div>
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
