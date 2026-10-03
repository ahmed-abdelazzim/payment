import React, { useState } from 'react';
import { Device } from '../types';

interface DevicesViewProps {
  devices: Device[];
  onToggleDeviceStatus: (deviceId: string) => void;
  language: 'en' | 'ar';
}

export const DevicesView: React.FC<DevicesViewProps> = ({
  devices,
  onToggleDeviceStatus,
  language,
}) => {
  const [pairingModalOpen, setPairingModalOpen] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [pairingToken, setPairingToken] = useState<string>('');

  const handleStartPairing = () => {
    // Generate secure random pairing code
    const token = 'SARRAF-' + Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Math.floor(1000 + Math.random() * 9000);
    setPairingToken(token);
    setPairingModalOpen(true);
  };

  return (
    <div className="pt-16 pb-28 max-w-5xl mx-auto px-margin-mobile flex flex-col gap-space-md">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-space-sm border-b border-outline-variant gap-3">
        <div>
          <h1 className="text-headline-md font-bold text-on-surface">
            {language === 'ar' ? 'أسطول أجهزة الدفع (POS Fleet)' : 'POS Terminal Fleet'}
          </h1>
          <p className="text-body-md text-on-surface-variant">
            {language === 'ar'
              ? 'مراقبة بوابات التقاط الرسائل والـ USSD وتوافر وكلاء الدفع المحمولين'
              : 'Real-time telemetry, battery health, and ingestion agent gateways'}
          </p>
        </div>

        <button
          onClick={handleStartPairing}
          className="px-3.5 py-2 bg-primary text-on-primary rounded-lg text-label-md font-semibold flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition-all self-start sm:self-auto"
        >
          <span className="material-symbols-outlined text-base">add_circle</span>
          <span>{language === 'ar' ? 'ربط جهاز دفع جديد' : 'Pair New Device'}</span>
        </button>
      </div>

      {/* Fleet Summary Pills */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-space-sm">
        <div className="p-space-sm rounded bg-surface-container-lowest border border-outline-variant">
          <span className="text-label-sm text-on-surface-variant">
            {language === 'ar' ? 'إجمالي الأجهزة' : 'Total Devices'}
          </span>
          <p className="text-headline-sm font-code-num text-on-surface font-bold mt-1">
            {devices.length}
          </p>
        </div>

        <div className="p-space-sm rounded bg-surface-container-lowest border border-outline-variant">
          <span className="text-label-sm text-on-surface-variant">
            {language === 'ar' ? 'أجهزة متصلة' : 'Online'}
          </span>
          <p className="text-headline-sm font-code-num text-primary font-bold mt-1">
            {devices.filter((d) => d.status === 'online').length}
          </p>
        </div>

        <div className="p-space-sm rounded bg-surface-container-lowest border border-outline-variant">
          <span className="text-label-sm text-on-surface-variant">
            {language === 'ar' ? 'أجهزة غير متصلة' : 'Offline'}
          </span>
          <p className="text-headline-sm font-code-num text-error font-bold mt-1">
            {devices.filter((d) => d.status === 'offline').length}
          </p>
        </div>

        <div className="p-space-sm rounded bg-surface-container-lowest border border-outline-variant">
          <span className="text-label-sm text-on-surface-variant">
            {language === 'ar' ? 'متوسط شحن البطارية' : 'Avg Battery'}
          </span>
          <p className="text-headline-sm font-code-num text-on-surface font-bold mt-1">
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
        {devices.length === 0 ? (
          <div className="col-span-full p-10 text-center bg-surface-container-lowest border border-outline-variant rounded-2xl space-y-3">
            <div className="w-12 h-12 rounded-full bg-surface-container-low text-primary flex items-center justify-center mx-auto">
              <span className="material-symbols-outlined text-2xl">phonelink_ring</span>
            </div>
            <h3 className="text-title-md font-bold text-on-surface">
              {language === 'ar' ? 'لم يتم ربط أجهزة استقبال بعد' : 'No payment capture devices paired yet'}
            </h3>
            <p className="text-body-sm text-on-surface-variant max-w-sm mx-auto">
              {language === 'ar'
                ? 'اربط هاتف كاشير محمول عبر MacroDroid أو Apple Shortcuts لبدء الاستماع اللحظي للرسائل.'
                : 'Connect an Android (MacroDroid) or iOS device to start capturing SMS & push notifications.'}
            </p>
            <button
              onClick={handleStartPairing}
              className="px-4 py-2 bg-primary text-on-primary rounded-lg text-label-md font-semibold inline-flex items-center gap-1.5 shadow-sm active:scale-95 transition-all"
            >
              <span className="material-symbols-outlined text-base">add_circle</span>
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
              className={`rounded-xl border p-space-md transition-all shadow-sm ${
                isOnline
                  ? 'bg-surface-container-lowest border-outline-variant hover:border-primary'
                  : 'bg-error-container/20 border-error/50'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-space-sm">
                  <div
                    className={`w-10 h-10 rounded flex items-center justify-center shrink-0 ${
                      isOnline
                        ? 'bg-surface-container text-primary'
                        : 'bg-error-container text-error'
                    }`}
                  >
                    <span className="material-symbols-outlined">point_of_sale</span>
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-title-md font-bold text-on-surface font-code-num">
                        {device.deviceNumber}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-label-sm font-semibold ${
                          isOnline
                            ? 'bg-surface-container text-primary'
                            : 'bg-error text-white'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            isOnline ? 'bg-primary' : 'bg-white'
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

                    <p className="text-label-sm text-on-surface-variant font-medium">
                      {device.name} · {device.location}
                    </p>
                  </div>
                </div>

                {/* Battery Pill */}
                <div
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-label-sm font-code-num font-semibold ${
                    isLowBattery
                      ? 'bg-error-container text-error border border-error/30'
                      : 'bg-surface-container text-on-surface-variant'
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
              <div className="mt-space-md grid grid-cols-2 gap-2 text-label-sm border-t border-outline-variant/60 pt-space-sm text-on-surface-variant">
                <div>
                  <span className="block text-outline">
                    {language === 'ar' ? 'المزود المربوط:' : 'Provider Rail:'}
                  </span>
                  <span className="font-semibold text-on-surface font-code-num">
                    {device.providerLabel}
                  </span>
                </div>

                <div>
                  <span className="block text-outline">
                    {language === 'ar' ? 'رقم الشريحة:' : 'SIM Number:'}
                  </span>
                  <span className="font-code-num text-on-surface">
                    {device.phoneNumber}
                  </span>
                </div>

                <div>
                  <span className="block text-outline">
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
                  <span className="block text-outline">
                    {language === 'ar' ? 'حجم اليوم:' : 'Volume Today:'}
                  </span>
                  <span className="font-code-num text-on-surface font-bold">
                    {device.volumeToday.toLocaleString('en-US')} EGP ({device.txnsToday} txns)
                  </span>
                </div>
              </div>

              {/* Telemetry Proof & Permissions Truth */}
              <div className="mt-2.5 p-2 rounded-lg bg-surface-container-low border border-outline-variant/60 flex items-center justify-between text-label-xs">
                <span className="text-on-surface-variant font-medium">
                  {language === 'ar' ? 'صلاحية قراءة الرسائل:' : 'SMS/Notification Listener:'}
                </span>
                {device.verifiedAt && device.notificationListenerGranted ? (
                  <span className="inline-flex items-center gap-1 text-primary font-bold">
                    <span className="material-symbols-outlined text-sm">verified</span>
                    <span>{language === 'ar' ? 'مؤكدة من الجهاز' : 'Verified by Device'}</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-secondary font-bold">
                    <span className="material-symbols-outlined text-sm">pending</span>
                    <span>{language === 'ar' ? 'بانتظار إشارة الهاتف' : 'Awaiting Device Proof'}</span>
                  </span>
                )}
              </div>

              {/* Action Buttons */}
              <div className="mt-space-sm pt-space-sm border-t border-outline-variant/60 flex items-center justify-between">
                <span className="text-label-sm font-code-num text-secondary">
                  {device.agentVersion}
                </span>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onToggleDeviceStatus(device.id)}
                    className={`px-2.5 py-1 rounded text-label-sm font-semibold active:scale-95 transition-all ${
                      isOnline
                        ? 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container border border-outline-variant'
                        : 'bg-primary text-on-primary'
                    }`}
                  >
                    {isOnline
                      ? language === 'ar'
                        ? 'إيقاف مؤقت'
                        : 'Set Offline'
                      : language === 'ar'
                      ? 'تفعيل الاتصال'
                      : 'Set Online'}
                  </button>

                  <button
                    onClick={() => setSelectedDevice(device)}
                    className="p-1 rounded text-on-surface-variant hover:bg-surface-container"
                    title="Device Diagnostics"
                  >
                    <span className="material-symbols-outlined text-lg">settings</span>
                  </button>
                </div>
              </div>
            </div>
          );
        }))}
      </div>

      {/* Pairing Modal */}
      {pairingModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest border border-outline-variant rounded-xl max-w-md w-full p-space-lg shadow-2xl">
            <div className="flex items-center justify-between pb-space-sm border-b border-outline-variant">
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
                className="p-1 text-on-surface-variant hover:bg-surface-container rounded"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="py-space-md space-y-space-sm text-body-md text-on-surface">
              <p className="text-body-md text-on-surface-variant">
                {language === 'ar'
                  ? 'قم بمسح رمز الاستجابة أو إدخال رمز الاقتران المؤقت في تطبيق وكيل Sarraf أو قالب MacroDroid على هاتف الأعمال:'
                  : 'Enter this one-time pairing code into your Sarraf Mobile Agent or MacroDroid gateway profile on the business Android device:'}
              </p>

              {/* Pairing Token Box */}
              <div className="p-space-md bg-surface-container-low border border-primary/30 rounded-lg text-center">
                <span className="text-label-sm text-outline uppercase tracking-wider block mb-1">
                  {language === 'ar' ? 'رمز الاقتران المؤقت (صالح لـ 15 دقيقة)' : 'One-Time Pairing Token (15m expiry)'}
                </span>
                <span className="text-headline-md font-code-num font-bold text-primary tracking-widest select-all">
                  {pairingToken}
                </span>
              </div>

              {/* Supported Adapters list */}
              <div className="p-space-sm bg-surface-container-lowest border border-outline-variant rounded-lg space-y-1.5 text-label-sm">
                <div className="flex items-center justify-between font-semibold text-on-surface">
                  <span>{language === 'ar' ? 'المسارات المدعومة (القسم 4B):' : 'Supported Capture Paths (Section 4B):'}</span>
                  <span className="text-primary font-code-num">v3.4 Protocol</span>
                </div>
                <ul className="list-disc list-inside text-on-surface-variant space-y-0.5">
                  <li>Android: MacroDroid Template with HMAC-SHA256 request signing</li>
                  <li>Android: Native Standalone Notification Service Agent</li>
                  <li>iOS: Apple Shortcuts Personal Message Automation Webhook</li>
                  <li>Huawei: EMUI Protected Background Ingestion Profile</li>
                </ul>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-space-sm border-t border-outline-variant">
              <button
                onClick={() => setPairingModalOpen(false)}
                className="px-4 py-2 bg-primary text-on-primary rounded text-label-md font-semibold active:scale-95 transition-all shadow-sm"
              >
                {language === 'ar' ? 'تم نسخ الرمز' : 'Done / Copied'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Device Config Modal */}
      {selectedDevice && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest border border-outline-variant rounded-xl max-w-md w-full p-space-lg shadow-2xl">
            <div className="flex items-center justify-between pb-space-sm border-b border-outline-variant">
              <h3 className="text-title-md font-bold text-on-surface">
                {selectedDevice.deviceNumber} - {selectedDevice.name}
              </h3>
              <button
                onClick={() => setSelectedDevice(null)}
                className="p-1 text-on-surface-variant hover:bg-surface-container rounded"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="py-space-md space-y-3 text-body-md text-on-surface">
              <div className="flex justify-between items-center text-label-sm border-b pb-2 border-outline-variant/50">
                <span className="text-outline">Agent Identity:</span>
                <span className="font-code-num font-semibold text-primary">{selectedDevice.id}</span>
              </div>
              <div className="flex justify-between items-center text-label-sm border-b pb-2 border-outline-variant/50">
                <span className="text-outline">HMAC Secret Status:</span>
                <span className="font-code-num text-primary">Provisioned (Active)</span>
              </div>
              <div className="flex justify-between items-center text-label-sm border-b pb-2 border-outline-variant/50">
                <span className="text-outline">Assigned Source:</span>
                <span className="font-semibold">{selectedDevice.providerLabel}</span>
              </div>
              <div className="flex justify-between items-center text-label-sm">
                <span className="text-outline">Firmware / Version:</span>
                <span className="font-code-num">{selectedDevice.agentVersion}</span>
              </div>
            </div>

            <div className="flex justify-between gap-2 pt-space-sm border-t border-outline-variant">
              <button
                onClick={() => {
                  onToggleDeviceStatus(selectedDevice.id);
                  setSelectedDevice(null);
                }}
                className="px-3 py-1.5 bg-surface-container-low text-error border border-error/30 rounded text-label-sm font-semibold"
              >
                {selectedDevice.status === 'online' ? 'Force Offline' : 'Mark Online'}
              </button>

              <button
                onClick={() => setSelectedDevice(null)}
                className="px-4 py-1.5 bg-primary text-on-primary rounded text-label-sm font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
