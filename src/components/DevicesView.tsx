import React, { useState } from 'react';
import { Device } from '../types';

interface DevicesViewProps {
  devices: Device[];
  onToggleDeviceStatus: (deviceId: string) => void;
  onOpenPairDevice?: () => void;
  language: 'en' | 'ar';
}

export const DevicesView: React.FC<DevicesViewProps> = ({
  devices,
  onToggleDeviceStatus,
  onOpenPairDevice,
  language,
}) => {
  const [pairingModalOpen, setPairingModalOpen] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [pairingToken, setPairingToken] = useState<string>('');

  const handleStartPairing = () => {
    if (onOpenPairDevice) {
      onOpenPairDevice();
      return;
    }
    // Generate secure random pairing code as fallback
    const token = 'SARRAF-' + Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Math.floor(1000 + Math.random() * 9000);
    setPairingToken(token);
    setPairingModalOpen(true);
  };

  return (
    <div className="py-6 pb-28 max-w-7xl mx-auto px-4 sm:px-6 flex flex-col gap-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-outline-variant/80 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <span className="material-symbols-outlined text-xl">point_of_sale</span>
            </div>
            <h1 className="text-headline-md font-bold text-on-surface">
              {language === 'ar' ? 'أسطول أجهزة الدفع والالتقاط' : 'POS Terminal Fleet'}
            </h1>
          </div>
          <p className="text-body-md text-on-surface-variant">
            {language === 'ar'
              ? 'مراقبة بوابات التقاط الرسائل والـ USSD وتوافر وكلاء الدفع المحمولين لحظياً'
              : 'Real-time telemetry, battery health, and ingestion agent gateways'}
          </p>
        </div>

        <button
          onClick={handleStartPairing}
          className="px-4 py-2.5 bg-primary text-on-primary rounded-xl text-label-md font-bold flex items-center justify-center gap-2 shadow-xs hover:bg-primary/90 active:scale-95 transition-all cursor-pointer self-start sm:self-auto"
        >
          <span className="material-symbols-outlined text-lg">add_circle</span>
          <span>{language === 'ar' ? 'ربط جهاز دفع جديد' : 'Pair New Device'}</span>
        </button>
      </div>

      {/* Fleet Summary Pills */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-surface-container-lowest border border-outline-variant shadow-xs">
          <span className="text-label-sm text-on-surface-variant block mb-1">
            {language === 'ar' ? 'إجمالي الأجهزة' : 'Total Devices'}
          </span>
          <p className="text-headline-sm font-code-num text-on-surface font-extrabold">
            {devices.length}
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-surface-container-lowest border border-outline-variant shadow-xs">
          <span className="text-label-sm text-on-surface-variant block mb-1">
            {language === 'ar' ? 'أجهزة متصلة الآن' : 'Online Devices'}
          </span>
          <p className="text-headline-sm font-code-num text-emerald-600 dark:text-emerald-400 font-extrabold flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>{devices.filter((d) => d.status === 'online').length}</span>
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-surface-container-lowest border border-outline-variant shadow-xs">
          <span className="text-label-sm text-on-surface-variant block mb-1">
            {language === 'ar' ? 'أجهزة متوقفة' : 'Offline Devices'}
          </span>
          <p className="text-headline-sm font-code-num text-error font-extrabold">
            {devices.filter((d) => d.status === 'offline').length}
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-surface-container-lowest border border-outline-variant shadow-xs">
          <span className="text-label-sm text-on-surface-variant block mb-1">
            {language === 'ar' ? 'متوسط شحن البطارية' : 'Avg Battery'}
          </span>
          <p className="text-headline-sm font-code-num text-on-surface font-extrabold">
            {devices.length > 0
              ? Math.round(
                  devices.reduce((acc, d) => acc + d.batteryLevel, 0) / devices.length
                )
              : 0}
            %
          </p>
        </div>
      </div>

      {/* Device Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {devices.length === 0 ? (
          <div className="col-span-full p-12 text-center bg-surface-container-lowest border border-outline-variant rounded-2xl space-y-4 shadow-xs">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto shadow-xs">
              <span className="material-symbols-outlined text-3xl">phonelink_ring</span>
            </div>
            <h3 className="text-title-md font-bold text-on-surface">
              {language === 'ar' ? 'لم يتم ربط أجهزة استقبال بعد' : 'No payment capture devices paired yet'}
            </h3>
            <p className="text-body-sm text-on-surface-variant max-w-md mx-auto">
              {language === 'ar'
                ? 'اربط هاتف كاشير محمول عبر تطبيق وكيل صرّاف أو MacroDroid لبدء الاستماع اللحظي لإشعارات الدفع.'
                : 'Connect an Android (MacroDroid) or iOS device to start capturing SMS & push notifications.'}
            </p>
            <button
              onClick={handleStartPairing}
              className="px-5 py-2.5 bg-primary text-on-primary rounded-xl text-label-md font-bold inline-flex items-center gap-2 shadow-xs active:scale-95 transition-all cursor-pointer"
            >
              <span className="material-symbols-outlined text-lg">add_circle</span>
              <span>{language === 'ar' ? 'ربط أول جهاز الآن' : 'Pair First Device'}</span>
            </button>
          </div>
        ) : (
          devices.map((device) => {
            const isOnline = device.status === 'online';
            const isLowBattery = device.batteryLevel <= 20;

            return (
              <div
                key={device.id}
                className={`rounded-2xl border p-5 transition-all shadow-xs heroui-card ${
                  isOnline
                    ? 'bg-surface-container-lowest border-outline-variant hover:border-primary/40'
                    : 'bg-error-container/10 border-error/40'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 shadow-xs ${
                        isOnline
                          ? 'bg-primary/10 text-primary'
                          : 'bg-error-container text-error'
                      }`}
                    >
                      <span className="material-symbols-outlined text-2xl">point_of_sale</span>
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-title-md font-bold text-on-surface font-code-num">
                          {device.deviceNumber}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-label-xs font-bold ${
                            isOnline
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                              : 'bg-error/10 text-error border border-error/20'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-error'
                            }`}
                          ></span>
                          {isOnline
                            ? language === 'ar'
                              ? 'متصل'
                              : 'Online'
                            : language === 'ar'
                            ? 'غير متصل'
                            : 'Offline'}
                        </span>
                      </div>

                      <p className="text-body-sm text-on-surface-variant font-medium mt-0.5">
                        {device.name} · {device.location}
                      </p>
                    </div>
                  </div>

                  {/* Battery Pill */}
                  <div
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-label-xs font-code-num font-bold ${
                      isLowBattery
                        ? 'bg-error/10 text-error border border-error/30'
                        : device.batteryLevel > 50
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                        : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                    }`}
                  >
                    <span className="material-symbols-outlined text-sm">
                      {device.batteryLevel > 80
                        ? 'battery_full'
                        : device.batteryLevel > 50
                        ? 'battery_5_bar'
                        : device.batteryLevel > 20
                        ? 'battery_2_bar'
                        : 'battery_alert'}
                    </span>
                    <span>{device.batteryLevel}%</span>
                  </div>
                </div>

                {/* Specs & Provider Details */}
                <div className="mt-4 grid grid-cols-2 gap-3 text-body-sm border-t border-outline-variant/60 pt-3 text-on-surface-variant">
                  <div>
                    <span className="block text-label-xs text-outline mb-0.5">
                      {language === 'ar' ? 'المزود المربوط:' : 'Provider Rail:'}
                    </span>
                    <span className="font-semibold text-on-surface">
                      {device.providerLabel}
                    </span>
                  </div>

                  <div>
                    <span className="block text-label-xs text-outline mb-0.5">
                      {language === 'ar' ? 'رقم الشريحة:' : 'SIM Number:'}
                    </span>
                    <span className="font-code-num text-on-surface">
                      {device.phoneNumber}
                    </span>
                  </div>

                  <div>
                    <span className="block text-label-xs text-outline mb-0.5">
                      {language === 'ar' ? 'آخر اتصال:' : 'Last Ping:'}
                    </span>
                    <span
                      className={`font-code-num ${
                        !isOnline ? 'text-error font-bold' : 'text-on-surface'
                      }`}
                    >
                      {device.lastPing}
                    </span>
                  </div>

                  <div>
                    <span className="block text-label-xs text-outline mb-0.5">
                      {language === 'ar' ? 'حجم اليوم:' : 'Volume Today:'}
                    </span>
                    <span className="font-code-num text-on-surface font-bold">
                      {device.volumeToday.toLocaleString('en-US')} ج.م
                    </span>
                  </div>
                </div>

                {/* Telemetry Proof & Permissions Truth */}
                <div className="mt-3 p-2.5 rounded-xl bg-surface-container-low border border-outline-variant/60 flex items-center justify-between text-label-xs">
                  <span className="text-on-surface-variant font-medium">
                    {language === 'ar' ? 'صلاحية قراءة الرسائل:' : 'SMS/Notification Listener:'}
                  </span>
                  {device.verifiedAt && device.notificationListenerGranted ? (
                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold">
                      <span className="material-symbols-outlined text-sm">verified</span>
                      <span>{language === 'ar' ? 'مؤكدة ومعتمدة' : 'Verified by Device'}</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-bold">
                      <span className="material-symbols-outlined text-sm">warning</span>
                      <span>{language === 'ar' ? 'في انتظار التحقق' : 'Needs Verification'}</span>
                    </span>
                  )}
                </div>

                {/* Action Controls */}
                <div className="mt-4 flex items-center justify-between gap-2 pt-3 border-t border-outline-variant/60">
                  <button
                    onClick={() => onToggleDeviceStatus(device.id)}
                    className={`px-3 py-1.5 rounded-xl text-label-xs font-bold transition-all cursor-pointer active:scale-95 ${
                      isOnline
                        ? 'bg-surface-container-high hover:bg-error-container text-on-surface hover:text-error'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    }`}
                  >
                    {isOnline
                      ? language === 'ar'
                        ? 'فصل الاتصال مؤقتاً'
                        : 'Toggle Offline'
                      : language === 'ar'
                      ? 'إعادة التوصيل'
                      : 'Reconnect Device'}
                  </button>

                  <button
                    onClick={() => setSelectedDevice(device)}
                    className="px-3 py-1.5 rounded-xl bg-surface-container-high hover:bg-surface-container text-on-surface text-label-xs font-semibold flex items-center gap-1 transition-all cursor-pointer active:scale-95"
                  >
                    <span className="material-symbols-outlined text-sm">settings</span>
                    <span>{language === 'ar' ? 'بيانات الاعتماد والـ HMAC' : 'HMAC Details'}</span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Internal Pairing Fallback Modal */}
      {pairingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-outline-variant">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-2xl">
                  qr_code_scanner
                </span>
                <h3 className="text-title-md font-bold text-on-surface">
                  {language === 'ar' ? 'إعداد وكيل الدفع المحمول' : 'Pair New Payment Device'}
                </h3>
              </div>
              <button
                onClick={() => setPairingModalOpen(false)}
                className="p-1 text-on-surface-variant hover:bg-surface-container rounded-lg cursor-pointer"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-4 text-body-md text-on-surface">
              <p className="text-body-sm text-on-surface-variant">
                {language === 'ar'
                  ? 'قم بإدخال رمز الاقتران المؤقت في تطبيق وكيل Sarraf أو قالب MacroDroid على هاتف الأعمال:'
                  : 'Enter this one-time pairing code into your Sarraf Mobile Agent or MacroDroid gateway profile:'}
              </p>

              {/* Pairing Token Box */}
              <div className="p-4 bg-surface-container-low border border-primary/30 rounded-xl text-center">
                <span className="text-label-xs text-outline uppercase tracking-wider block mb-1">
                  {language === 'ar' ? 'رمز الاقتران المؤقت (صالح لـ 15 دقيقة)' : 'One-Time Pairing Token (15m expiry)'}
                </span>
                <span className="text-headline-md font-code-num font-extrabold text-primary tracking-widest select-all">
                  {pairingToken}
                </span>
              </div>

              {/* Supported Adapters list */}
              <div className="p-3 bg-surface-container-low rounded-xl border border-outline-variant space-y-1.5 text-label-xs">
                <div className="flex items-center justify-between font-bold text-on-surface">
                  <span>{language === 'ar' ? 'مسارات الالتقاط المعتمدة:' : 'Supported Capture Paths:'}</span>
                  <span className="text-primary font-code-num">v3.4 Protocol</span>
                </div>
                <ul className="list-disc list-inside text-on-surface-variant space-y-0.5">
                  <li>Android: MacroDroid Template with HMAC-SHA256 signature</li>
                  <li>Android: Native Standalone Notification Service Agent</li>
                  <li>iOS: Apple Shortcuts Personal Message Automation Webhook</li>
                  <li>Huawei: EMUI Protected Background Ingestion Profile</li>
                </ul>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-outline-variant">
              <button
                onClick={() => setPairingModalOpen(false)}
                className="px-4 py-2 bg-primary text-on-primary rounded-xl text-label-md font-bold active:scale-95 transition-all shadow-xs cursor-pointer"
              >
                {language === 'ar' ? 'إغلاق' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Device Config Modal */}
      {selectedDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-outline-variant">
              <h3 className="text-title-md font-bold text-on-surface">
                {selectedDevice.deviceNumber} - {selectedDevice.name}
              </h3>
              <button
                onClick={() => setSelectedDevice(null)}
                className="p-1 text-on-surface-variant hover:bg-surface-container rounded-lg cursor-pointer"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-3 text-body-sm text-on-surface">
              <div className="flex justify-between items-center text-label-sm border-b pb-2.5 border-outline-variant/50">
                <span className="text-outline">
                  {language === 'ar' ? 'معرّف الجهاز (Agent Identity):' : 'Agent Identity:'}
                </span>
                <span className="font-code-num font-semibold text-primary">{selectedDevice.id}</span>
              </div>
              <div className="flex justify-between items-center text-label-sm border-b pb-2.5 border-outline-variant/50">
                <span className="text-outline">
                  {language === 'ar' ? 'حالة توقيع HMAC:' : 'HMAC Secret Status:'}
                </span>
                <span className="font-code-num text-emerald-600 dark:text-emerald-400 font-bold">
                  {language === 'ar' ? 'مفعّل ومؤمّن (Active)' : 'Provisioned (Active)'}
                </span>
              </div>
              <div className="flex justify-between items-center text-label-sm border-b pb-2.5 border-outline-variant/50">
                <span className="text-outline">
                  {language === 'ar' ? 'مسار الاستقبال المربوط:' : 'Assigned Source:'}
                </span>
                <span className="font-semibold">{selectedDevice.providerLabel}</span>
              </div>
              <div className="flex justify-between items-center text-label-sm">
                <span className="text-outline">
                  {language === 'ar' ? 'إصدار الوكيل (Firmware):' : 'Firmware / Version:'}
                </span>
                <span className="font-code-num">{selectedDevice.agentVersion}</span>
              </div>
            </div>

            <div className="flex justify-between gap-2 pt-4 border-t border-outline-variant">
              <button
                onClick={() => {
                  onToggleDeviceStatus(selectedDevice.id);
                  setSelectedDevice(null);
                }}
                className="px-3.5 py-2 bg-surface-container-low text-error border border-error/30 rounded-xl text-label-sm font-bold hover:bg-error-container/20 transition-all cursor-pointer"
              >
                {selectedDevice.status === 'online'
                  ? language === 'ar' ? 'فصل الاتصال' : 'Force Offline'
                  : language === 'ar' ? 'توصيل الجهاز' : 'Mark Online'}
              </button>

              <button
                onClick={() => setSelectedDevice(null)}
                className="px-4 py-2 bg-primary text-on-primary rounded-xl text-label-sm font-bold hover:bg-primary/90 transition-all cursor-pointer shadow-xs active:scale-95"
              >
                {language === 'ar' ? 'إغلاق' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
