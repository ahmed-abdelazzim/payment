import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';

interface AuditLogEntry {
  id: string;
  time: string;
  actor: string;
  action: string;
  resource: string;
  status: 'success' | 'warning' | 'error';
  ip: string;
  details: string;
}

interface RawEventEntry {
  id: string;
  adapter_type: string;
  client_timestamp: string;
  server_received_at: string;
  raw_payload: string;
  processing_status: string;
  device_name?: string;
  device_number?: string;
}

interface AuditLogsViewProps {
  language: 'en' | 'ar';
}

export const AuditLogsView: React.FC<AuditLogsViewProps> = ({ language }) => {
  const [activeTab, setActiveTab] = useState<'raw_events' | 'security_audit'>('raw_events');
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [rawEvents, setRawEvents] = useState<RawEventEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchAllData = async () => {
    setLoading(true);
    try {
      const [auditRes, rawRes] = await Promise.all([
        apiFetch('/api/v1/audit'),
        apiFetch('/api/v1/raw-events?limit=100'),
      ]);

      if (auditRes.ok) {
        const raw = await auditRes.json();
        if (Array.isArray(raw)) {
          setLogs(
            raw.map((item: any) => ({
              id: item.id || `log_${Math.random()}`,
              time: item.createdAt
                ? new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : 'Just now',
              actor: item.actorIdentity || 'System Engine',
              action: item.action || 'SECURITY_EVENT',
              resource: `${item.resourceType || 'Record'}:${item.resourceId || 'N/A'}`,
              status:
                item.action?.includes('REJECTED') || item.action?.includes('ERROR') || item.action?.includes('FAILED')
                  ? 'error'
                  : item.action?.includes('REVIEW') || item.action?.includes('PAUSED')
                  ? 'warning'
                  : 'success',
              ip: item.originIp || 'Internal Gateway',
              details: typeof item.details === 'object' ? JSON.stringify(item.details) : (item.details || item.action),
            }))
          );
        }
      }

      if (rawRes.ok) {
        const eventsData = await rawRes.json();
        if (Array.isArray(eventsData)) {
          setRawEvents(eventsData);
        }
      }
    } catch {
      // offline fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  return (
    <div className="pt-16 pb-28 max-w-5xl mx-auto px-margin-mobile flex flex-col gap-space-md">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-space-sm border-b border-outline-variant">
        <div>
          <h1 className="text-headline-md font-bold text-on-surface">
            {language === 'ar' ? 'سجلات الأمان والتدقيق غير القابلة للتعديل' : 'Immutable Security & Audit Trail'}
          </h1>
          <p className="text-body-md text-on-surface-variant">
            {language === 'ar'
              ? 'سجل غير قابل للتعديل لعمليات التحقق من توقيع HMAC، تسجيل الأجهزة، تغيير المسارات، واعتماد المشغلين'
              : 'Tamper-evident audit trail of HMAC signatures, device registration, routing switches, and operator actions'}
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          <button
            onClick={fetchAllData}
            disabled={loading}
            className="px-3.5 py-1.5 rounded-lg border border-outline-variant bg-surface-container-low hover:bg-surface-container text-label-md font-medium text-on-surface transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <span className={`material-symbols-outlined text-base ${loading ? 'animate-spin' : ''}`}>refresh</span>
            <span>{language === 'ar' ? 'تحديث السجلات' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Tab Switcher */}
      <div className="flex items-center gap-2 border-b border-outline-variant pb-2">
        <button
          onClick={() => setActiveTab('raw_events')}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'raw_events'
              ? 'bg-primary text-on-primary shadow-xs'
              : 'bg-surface-container-low hover:bg-surface-container text-on-surface-variant'
          }`}
        >
          <span className="material-symbols-outlined text-base">sms</span>
          <span>{language === 'ar' ? 'سجل جميع الرسائل الواردة (قاعدة البيانات)' : 'Incoming SMS Feed (Database)'}</span>
          <span className="px-2 py-0.5 rounded-full text-xs bg-surface-container-highest/60 font-mono">
            {rawEvents.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('security_audit')}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'security_audit'
              ? 'bg-primary text-on-primary shadow-xs'
              : 'bg-surface-container-low hover:bg-surface-container text-on-surface-variant'
          }`}
        >
          <span className="material-symbols-outlined text-base">security</span>
          <span>{language === 'ar' ? 'سجلات الأمان والعمليات' : 'Security Audit Trail'}</span>
          <span className="px-2 py-0.5 rounded-full text-xs bg-surface-container-highest/60 font-mono">
            {logs.length}
          </span>
        </button>
      </div>

      {/* View Content */}
      {activeTab === 'raw_events' ? (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-on-surface-variant space-y-2">
              <span className="material-symbols-outlined text-3xl animate-spin text-primary">progress_activity</span>
              <p className="text-body-sm">{language === 'ar' ? 'جاري تحميل سجل الرسائل...' : 'Loading raw message stream...'}</p>
            </div>
          ) : rawEvents.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <div className="w-12 h-12 rounded-xl bg-surface-container-high text-primary mx-auto flex items-center justify-center">
                <span className="material-symbols-outlined text-2xl">sms</span>
              </div>
              <h3 className="text-title-sm font-bold text-on-surface">
                {language === 'ar' ? 'لا توجد رسائل مسجلة في قاعدة البيانات حتى الآن' : 'No Messages Recorded Yet'}
              </h3>
              <p className="text-body-sm text-on-surface-variant max-w-sm mx-auto">
                {language === 'ar'
                  ? 'أي رسالة يستقبلها هاتفك عبر MacroDroid ستُحفظ هنا فوراً بنصها الأصلي وحالة تصفيتها.'
                  : 'Every SMS dispatched from your terminals will be permanently archived here.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-outline-variant">
              {rawEvents.map((evt) => {
                let badgeLabel = evt.processing_status;
                let badgeClass = 'bg-surface-container text-on-surface';

                if (evt.processing_status === 'filtered_personal_chat') {
                  badgeLabel = language === 'ar' ? '💬 رسالة شخصية (مستبعدة)' : 'Personal Chat (Filtered)';
                  badgeClass = 'bg-surface-container-high text-on-surface-variant';
                } else if (evt.processing_status === 'filtered_otp_security') {
                  badgeLabel = language === 'ar' ? '🔐 كود تحقق OTP (مستبعد)' : 'OTP Security (Filtered)';
                  badgeClass = 'bg-amber-500/15 text-amber-400 border border-amber-500/30';
                } else if (evt.processing_status === 'filtered_telecom_promo') {
                  badgeLabel = language === 'ar' ? '📢 إعلان وعروض شبكة (مستبعد)' : 'Promo Ad (Filtered)';
                  badgeClass = 'bg-blue-500/15 text-blue-400 border border-blue-500/30';
                } else if (evt.processing_status === 'filtered_outbound_debit') {
                  badgeLabel = language === 'ar' ? '💳 سحب / مصروفات (مستبعد)' : 'Outbound Debit (Filtered)';
                  badgeClass = 'bg-rose-500/15 text-rose-400 border border-rose-500/30';
                } else if (evt.processing_status === 'reconciled' || evt.processing_status === 'confirmed') {
                  badgeLabel = language === 'ar' ? '💰 تحويل مالي وارد (مقبول ومطابق)' : 'Inbound Payment (Reconciled)';
                  badgeClass = 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-bold';
                }

                return (
                  <div key={evt.id} className="p-4 hover:bg-surface-container-low transition-colors space-y-2">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${badgeClass}`}>
                          {badgeLabel}
                        </span>
                        <span className="text-xs text-on-surface-variant flex items-center gap-1 font-medium">
                          <span className="material-symbols-outlined text-xs">smartphone</span>
                          <span>{evt.device_name || evt.device_number || 'Mobile Terminal'}</span>
                        </span>
                      </div>
                      <span className="text-xs font-mono text-on-surface-variant">
                        {evt.server_received_at || evt.client_timestamp || 'Recently'}
                      </span>
                    </div>

                    <div className="bg-surface-container-lowest p-3 rounded-lg border border-outline-variant/60 font-mono text-xs text-on-surface break-words select-all">
                      {evt.raw_payload}
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-outline font-mono">
                      <span>Event ID: {evt.id}</span>
                      <span>Adapter: {evt.adapter_type}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-on-surface-variant space-y-2">
              <span className="material-symbols-outlined text-3xl animate-spin text-primary">progress_activity</span>
              <p className="text-body-sm">{language === 'ar' ? 'جاري تحميل سجلات التدقيق...' : 'Loading audit trail...'}</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <div className="w-12 h-12 rounded-xl bg-surface-container-high text-primary mx-auto flex items-center justify-center">
                <span className="material-symbols-outlined text-2xl">verified_user</span>
              </div>
              <h3 className="text-title-sm font-bold text-on-surface">
                {language === 'ar' ? 'لا توجد سجلات تدقيق حتى الآن' : 'No Audit Events Yet'}
              </h3>
              <p className="text-body-sm text-on-surface-variant max-w-sm mx-auto">
                {language === 'ar'
                  ? 'سيتم تسجيل أي إجراء حقيقي (مثل تسجيل دخول، ربط جهاز، اعتماد تحويل) تلقائياً هنا في سجل تدقيق محمي.'
                  : 'Every security event, device pairing, and operator approval will be immutably recorded here.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-outline-variant">
              {logs.map((log) => (
                <div key={log.id} className="p-space-md hover:bg-surface-container-low transition-colors">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-label-sm font-semibold ${
                          log.status === 'success'
                            ? 'bg-surface-container text-primary'
                            : log.status === 'warning'
                            ? 'bg-surface-container-high text-secondary'
                            : 'bg-error-container text-error'
                        }`}
                      >
                        {log.action}
                      </span>
                      <span className="text-body-md font-semibold text-on-surface">{log.resource}</span>
                    </div>
                    <span className="text-label-sm font-code-num text-on-surface-variant">{log.time}</span>
                  </div>

                  <p className="text-body-md text-on-surface-variant font-code-num">{log.details}</p>

                  <div className="mt-2 flex items-center justify-between text-label-sm text-outline font-code-num">
                    <span>Actor: {log.actor}</span>
                    <span>Origin IP: {log.ip}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
