import { useState, useCallback, useEffect, useRef } from 'react';
import { Transaction, Device, ProviderRail, CurrentSubscription } from '../types';
import { apiFetch } from '../api';

interface UseTelemetryOptions {
  enabled: boolean;
  pollIntervalMs?: number;
  onDeviceListFetched?: (devices: Device[]) => void;
}

export function useTelemetry({ enabled, pollIntervalMs = 3000, onDeviceListFetched }: UseTelemetryOptions) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [rails, setRails] = useState<ProviderRail[]>([]);
  const [currentSub, setCurrentSub] = useState<CurrentSubscription | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const onDeviceListFetchedRef = useRef(onDeviceListFetched);
  onDeviceListFetchedRef.current = onDeviceListFetched;

  const refreshBackendData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [txRes, devRes, railRes, subRes] = await Promise.all([
        apiFetch('/api/v1/transactions'),
        apiFetch('/api/v1/devices'),
        apiFetch('/api/v1/sources'),
        apiFetch('/api/v1/subscriptions/current'),
      ]);

      if (subRes.ok) {
        const subData = await subRes.json();
        setCurrentSub(subData);
      }

      if (txRes.ok && devRes.ok && railRes.ok) {
        const txData = await txRes.json();
        const devData = await devRes.json();
        const railData = await railRes.json();

        setTransactions(
          Array.isArray(txData)
            ? txData.map((t: any) => ({
                id: t.id,
                trxId: t.trxId || t.external_trx_id || t.id,
                amount: t.amount,
                currency: t.currency || 'EGP',
                provider: t.provider,
                providerLabel:
                  t.provider === 'vodafone_cash'
                    ? 'Vodafone Cash'
                    : t.provider === 'instapay'
                    ? 'InstaPay (IPN)'
                    : t.provider === 'orange_cash'
                    ? 'Orange Cash'
                    : 'e& Cash',
                senderName: t.senderName || 'Anonymous Customer',
                senderPhone: t.senderPhone || '',
                timeAgo: 'Recently',
                timestamp: t.timestamp || new Date().toISOString(),
                status: t.status,
                confidenceScore: t.confidenceScore ? Math.round(t.confidenceScore * 100) : 95,
                deviceId: t.deviceId || 'DEV-POS',
                deviceName: t.deviceName || 'Terminal Gate',
                reviewReason: t.reviewReason,
                rawMessage: t.rawMessage,
                signature: t.signature,
              }))
            : []
        );

        const mappedDevices: Device[] = Array.isArray(devData)
          ? devData.map((d: any) => ({
              id: d.id,
              deviceNumber: d.device_number,
              name: d.friendly_name,
              location: d.location || 'Terminal',
              provider: 'vodafone_cash',
              providerLabel: 'Vodafone Cash',
              phoneNumber: '01019283921',
              status: d.status,
              batteryLevel: d.battery_level,
              lastPing: d.last_seen_at || 'Just now',
              txnsToday: d.txns_count || 0,
              volumeToday: 0,
              agentVersion: d.agent_version || 'v3.4.1-eg',
              configVersion: d.config_version || 'cfg-v1.4',
              verifiedAt: d.verified_at,
              notificationListenerGranted: Boolean(d.notification_listener_granted),
              batteryOptimizationExempt: Boolean(d.battery_optimization_exempt),
            }))
          : [];

        setDevices(mappedDevices);
        if (onDeviceListFetchedRef.current) {
          onDeviceListFetchedRef.current(mappedDevices);
        }

        setRails(
          Array.isArray(railData)
            ? railData.map((r: any) => ({
                id: r.id,
                provider: r.provider,
                name: r.name || r.provider,
                sharePercentage: r.sharePercentage || 0,
                volume: r.volume || 0,
                target: r.dailyLimit || 60000,
                txnsCount: r.txnsCount || 0,
                color: r.color || '#1e3a8a',
                walletNumber: r.walletNumber || r.primaryAddress || '',
                dailyLimit: r.dailyLimit || 60000,
                monthlyLimit: r.monthlyLimit || 200000,
                dailyIntake: r.dailyIntake,
                monthlyIntake: r.monthlyIntake,
                dailyPercentage: r.dailyPercentage,
                monthlyPercentage: r.monthlyPercentage,
                isPaused: r.isPaused || false,
              }))
            : []
        );
      }
    } catch {
      // Offline / network glitch
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Initial fetch when enabled
  useEffect(() => {
    if (enabled) {
      refreshBackendData();
    }
  }, [enabled, refreshBackendData]);

  // Live polling (auto-paused when tab is hidden or disabled)
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      refreshBackendData();
    }, pollIntervalMs);
    return () => clearInterval(interval);
  }, [enabled, pollIntervalMs, refreshBackendData]);

  const clearTelemetry = useCallback(() => {
    setTransactions([]);
    setDevices([]);
    setRails([]);
    setCurrentSub(null);
  }, []);

  return {
    transactions,
    setTransactions,
    devices,
    setDevices,
    rails,
    setRails,
    currentSub,
    setCurrentSub,
    isRefreshing,
    refreshBackendData,
    clearTelemetry,
  };
}
