import React, { useEffect, useState } from 'react';
import { ProviderRail } from '../types';
import { apiFetch } from '../api';

interface PairingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCaptureSaved: (kind: 'device' | 'message') => void;
  rails: ProviderRail[];
  language: 'en' | 'ar';
}

export const PairingModal: React.FC<PairingModalProps> = ({ isOpen, onClose, onCaptureSaved, rails, language }) => {
  const [mode, setMode] = useState<'automation' | 'manual'>('automation');
  const [paymentSourceId, setPaymentSourceId] = useState('');
  const [adapterType, setAdapterType] = useState<'macrodroid' | 'apple_shortcuts' | 'huawei_emui'>('macrodroid');
  const [friendlyName, setFriendlyName] = useState('');
  const [captureCredential, setCaptureCredential] = useState<{ token: string; endpoint: string } | null>(null);
  const [rawContent, setRawContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setCaptureCredential(null);
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleCapture = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      const response = await apiFetch('/api/v1/manual-captures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentSourceId, rawContent }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to save the message.');
      if (result.status === 'duplicate') {
        setError(language === 'ar' ? 'هذه العملية مسجلة بالفعل؛ لم تُضف مرة ثانية.' : 'This payment is already recorded; it was not added twice.');
      } else {
        setSaved(true);
        setRawContent('');
        onCaptureSaved('message');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Connection error');
    } finally {
      setLoading(false);
    }
  };

  const copyMobileLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/app?tab=devices`);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2500);
    } catch {
      setError(language === 'ar' ? 'تعذر نسخ الرابط. افتح نفس عنوان الموقع على هاتفك.' : 'Could not copy the link. Open this site on your phone.');
    }
  };

  const createCaptureLink = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setCaptureCredential(null);
    try {
      const response = await apiFetch('/api/v1/capture-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentSourceId, adapterType, friendlyName }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || result.error || 'Could not create the connection.');
      setCaptureCredential({ token: result.token, endpoint: `${window.location.origin}${result.endpoint}` });
      onCaptureSaved('device');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Connection error');
    } finally {
      setLoading(false);
    }
  };

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2500);
    } catch {
      setError(language === 'ar' ? 'تعذر النسخ. انسخ النص يدويًا.' : 'Could not copy. Select the text manually.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sarraf-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="mobile-capture-title" className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-outline-variant bg-surface-container-lowest p-5 sm:p-6 sarraf-modal space-y-5">
        <div className="flex items-start justify-between gap-3 border-b border-outline-variant pb-4">
          <div>
            <h2 id="mobile-capture-title" className="text-title-md font-bold text-on-surface">
              {language === 'ar' ? 'ربط هاتف استقبال رسائل الدفع' : 'Connect a payment capture phone'}
            </h2>
            <p className="text-body-sm text-on-surface-variant mt-1">
              {language === 'ar' ? 'اختَر أتمتة الهاتف أو الإدخال اليدوي من المتصفح. لا تحتاج تطبيق Sarraf Adapter.' : 'Choose a phone automation or browser entry. No Sarraf Adapter app is required.'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={language === 'ar' ? 'إغلاق' : 'Close'} className="p-2 rounded-lg hover:bg-surface-container text-on-surface-variant">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2" role="tablist" aria-label={language === 'ar' ? 'طريقة الربط' : 'Capture method'}>
          <button type="button" role="tab" aria-selected={mode === 'automation'} onClick={() => { setMode('automation'); setError(null); }} className={`rounded-lg px-3 py-2 text-label-sm font-bold border ${mode === 'automation' ? 'bg-primary text-on-primary border-primary' : 'border-outline-variant text-on-surface'}`}>{language === 'ar' ? 'أتمتة الهاتف' : 'Phone automation'}</button>
          <button type="button" role="tab" aria-selected={mode === 'manual'} onClick={() => { setMode('manual'); setError(null); }} className={`rounded-lg px-3 py-2 text-label-sm font-bold border ${mode === 'manual' ? 'bg-primary text-on-primary border-primary' : 'border-outline-variant text-on-surface'}`}>{language === 'ar' ? 'إدخال يدوي' : 'Manual entry'}</button>
        </div>

        {mode === 'automation' ? (
          <div className="space-y-4">
            <p className="text-body-sm text-on-surface-variant">{language === 'ar' ? 'استخدم MacroDroid على Android/Huawei أو تطبيق Shortcuts المدمج في iPhone. يُحفظ كل إشعار للمراجعة فقط؛ لا يؤكد دفع العميل تلقائيًا.' : 'Use MacroDroid on Android/Huawei or the built-in Shortcuts app on iPhone. Every message enters review; it never confirms customer payment automatically.'}</p>
            <form onSubmit={createCaptureLink} className="space-y-3">
              <label className="block text-label-sm font-semibold text-on-surface">{language === 'ar' ? 'نوع الهاتف' : 'Phone type'}
                <select value={adapterType} onChange={(event) => setAdapterType(event.target.value as typeof adapterType)} className="mt-1 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-on-surface">
                  <option value="macrodroid">Android · MacroDroid</option>
                  <option value="huawei_emui">Huawei · MacroDroid</option>
                  <option value="apple_shortcuts">iPhone · Apple Shortcuts</option>
                </select>
              </label>
              <label className="block text-label-sm font-semibold text-on-surface">{language === 'ar' ? 'اسم الهاتف' : 'Phone name'}
                <input required minLength={2} maxLength={100} value={friendlyName} onChange={(event) => setFriendlyName(event.target.value)} placeholder={language === 'ar' ? 'مثال: هاتف استقبال المتجر' : 'Example: Shop receiver phone'} className="mt-1 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-on-surface" />
              </label>
              <label className="block text-label-sm font-semibold text-on-surface">{language === 'ar' ? 'مصدر الاستقبال المرتبط بهذا الهاتف' : 'Receiving source for this phone'}
                <select required value={paymentSourceId} onChange={(event) => setPaymentSourceId(event.target.value)} className="mt-1 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-on-surface">
                  <option value="">{language === 'ar' ? 'اختر المحفظة أو حساب إنستاباي' : 'Choose wallet or InstaPay account'}</option>
                  {rails.map((rail) => <option key={rail.id} value={rail.id}>{rail.name} · {rail.walletNumber}</option>)}
                </select>
              </label>
              <button type="submit" disabled={loading || rails.length === 0} className="w-full rounded-lg bg-primary px-4 py-3 font-bold text-on-primary disabled:opacity-50">{loading ? (language === 'ar' ? 'جارٍ الإنشاء…' : 'Creating…') : (language === 'ar' ? 'إنشاء بيانات ربط الهاتف' : 'Create phone connection')}</button>
            </form>
            {captureCredential && <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
              <p className="text-body-sm font-bold text-on-surface">{language === 'ar' ? 'احتفظ بالمفتاح الآن؛ لن يظهر بعد إغلاق هذه النافذة.' : 'Save this key now; it will not be shown after closing.'}</p>
              <div><span className="text-label-xs block mb-1">POST URL</span><code className="block break-all text-body-sm select-all">{captureCredential.endpoint}</code><button type="button" onClick={() => copyText(captureCredential.endpoint)} className="text-primary underline text-label-sm">{language === 'ar' ? 'نسخ الرابط' : 'Copy URL'}</button></div>
              <div><span className="text-label-xs block mb-1">Authorization header</span><code className="block break-all text-body-sm select-all">Bearer {captureCredential.token}</code><button type="button" onClick={() => copyText(`Bearer ${captureCredential.token}`)} className="text-primary underline text-label-sm">{language === 'ar' ? 'نسخ قيمة الهيدر' : 'Copy header value'}</button></div>
              <div><span className="text-label-xs block mb-1">Content-Type: application/json · Body</span><code className="block break-all text-body-sm select-all">{'{"raw_content":"<MESSAGE_BODY>"}'}</code></div>
              <p className="text-body-sm text-on-surface-variant">{language === 'ar' ? 'ضع نص الرسالة الفعلي مكان <MESSAGE_BODY> من قائمة متغيرات أداة الأتمتة. لا تضع المفتاح في الرابط ولا ترسله لأحد.' : 'Insert the actual received message body from the automation variable picker. Keep the key out of the URL and do not share it.'}</p>
              <p className="text-body-sm text-on-surface-variant">{adapterType === 'apple_shortcuts'
                ? (language === 'ar' ? 'في Shortcuts: Automation ← Message ← اختر مرسل البنك أو المحفظة ← Get Contents of URL ← POST ← أضف الهيدرَين أعلاه وJSON body بنص الرسالة الواردة. جرّبها برسالة حقيقية على هاتفك؛ سلوك أتمتة الرسائل يختلف حسب إصدار iOS.' : 'In Shortcuts: Automation → Message → choose bank/wallet sender → Get Contents of URL → POST → add the headers and JSON body using the incoming message. Validate on the physical iPhone; message automation behavior varies by iOS version.')
                : (language === 'ar' ? 'في MacroDroid: أنشئ Macro بـ Trigger: SMS Received أو Notification Received للتطبيق البنكي، ثم Action: HTTP Request POST. ضع الرابط والهيدرَين وJSON body أعلاه، واختر متغير نص الرسالة من MacroDroid. جرّب استقبال رسالة حقيقية.' : 'In MacroDroid: use SMS Received or bank-app Notification Received as trigger, then HTTP Request POST with the URL, headers and JSON body above. Insert the message-text variable from MacroDroid and test with a real message.')}</p>
              <p className="text-body-xs text-on-surface-variant">{language === 'ar' ? 'اختبر أن العملية تظهر في قائمة «تحتاج مراجعة». إلغاء الهاتف من صفحة الأجهزة يبطل المفتاح فورًا.' : 'Verify the event appears in Review Required. Revoking the phone in Devices immediately disables the key.'}</p>
            </div>}
            {error && <p role="alert" className="text-body-sm text-error">{error}</p>}
            {rails.length === 0 && <p className="text-body-sm text-on-surface-variant">{language === 'ar' ? 'أضف مصدر استقبال أولًا.' : 'Add a receiving source first.'}</p>}
          </div>
        ) : (
        <>

        <div className="rounded-xl border border-primary/25 bg-primary/5 p-4 space-y-2">
          <div className="font-bold text-primary flex items-center gap-2"><span className="material-symbols-outlined text-lg">phone_iphone</span>{language === 'ar' ? 'من متصفح أي هاتف — متاح الآن' : 'Any phone browser — available now'}</div>
          <ol className="list-decimal list-inside text-body-sm text-on-surface-variant space-y-1">
            <li>{language === 'ar' ? 'افتح نفس الموقع على هاتف الاستقبال وسجّل دخولك.' : 'Open this site on the capture phone and sign in.'}</li>
            <li>{language === 'ar' ? 'انسخ رسالة التحويل الحقيقية من تطبيق الرسائل أو الإشعارات.' : 'Copy the actual transfer message from SMS or notifications.'}</li>
            <li>{language === 'ar' ? 'اختر محفظة الاستقبال، والصق الرسالة، ثم احفظها للمراجعة.' : 'Select the receiving wallet, paste the message, and save it for review.'}</li>
          </ol>
          <button type="button" onClick={copyMobileLink} className="inline-flex items-center gap-2 rounded-lg border border-primary/25 px-3 py-2 text-label-sm font-semibold text-primary hover:bg-primary/10">
            <span className="material-symbols-outlined text-base">content_copy</span>{linkCopied ? (language === 'ar' ? 'تم نسخ رابط الموقع' : 'Link copied') : (language === 'ar' ? 'نسخ رابط الموقع للهاتف' : 'Copy mobile site link')}
          </button>
        </div>

        <form onSubmit={handleCapture} className="space-y-4">
          <div>
            <label htmlFor="manual-payment-source" className="block text-label-md font-semibold mb-1 text-on-surface">{language === 'ar' ? 'مصدر الاستقبال' : 'Receiving source'}</label>
            <select id="manual-payment-source" required value={paymentSourceId} onChange={(event) => setPaymentSourceId(event.target.value)} className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-on-surface">
              <option value="">{language === 'ar' ? 'اختر المحفظة أو حساب إنستاباي' : 'Choose wallet or InstaPay account'}</option>
              {rails.map((rail) => <option key={rail.id} value={rail.id}>{rail.name} · {rail.walletNumber}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="manual-payment-message" className="block text-label-md font-semibold mb-1 text-on-surface">{language === 'ar' ? 'نص رسالة التحويل' : 'Transfer message'}</label>
            <textarea id="manual-payment-message" required minLength={10} maxLength={2000} rows={5} value={rawContent} onChange={(event) => setRawContent(event.target.value)} placeholder={language === 'ar' ? 'الصق نص الرسالة كما وصل إلى هاتفك…' : 'Paste the message exactly as received on your phone…'} className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-on-surface resize-y" />
          </div>
          {error && <p role="alert" className="text-body-sm text-error">{error}</p>}
          {saved && <p role="status" className="text-body-sm text-emerald-600 dark:text-emerald-400">{language === 'ar' ? 'تم حفظ الرسالة في قائمة المراجعة. لا يُعتمد التحويل إلا بعد التحقق المستقل من البنك أو المحفظة.' : 'Saved to the review queue. Confirm the transfer independently with the bank or wallet before approval.'}</p>}
          {rails.length === 0 && <p className="text-body-sm text-on-surface-variant">{language === 'ar' ? 'أضف مصدر استقبال من صفحة المحافظ أولًا.' : 'Add a receiving source from the wallets page first.'}</p>}
          <button type="submit" disabled={loading || rails.length === 0} className="w-full rounded-lg bg-primary px-4 py-3 font-bold text-on-primary disabled:opacity-50">
            {loading ? (language === 'ar' ? 'جارٍ الحفظ…' : 'Saving…') : (language === 'ar' ? 'حفظ الرسالة للمراجعة' : 'Save message for review')}
          </button>
        </form>

        </>
        )}
      </section>
    </div>
  );
};
