export type TransactionStatus = 'confirmed' | 'review_required' | 'failed';

export type ProviderType = 'vodafone_cash' | 'instapay' | 'orange_cash' | 'etisalat_cash';

export interface AuditStep {
  time: string;
  title: string;
  detail: string;
}

export interface Transaction {
  id: string;
  trxId: string;
  amount: number;
  currency: string;
  provider: ProviderType;
  providerLabel: string;
  senderName: string;
  senderPhone: string;
  timeAgo: string;
  timestamp: string;
  status: TransactionStatus;
  confidenceScore?: number;
  deviceId: string;
  deviceName: string;
  reviewReason?: string;
  rawMessage?: string;
  signature?: string;
  auditTimeline?: AuditStep[];
  balanceAfter?: number;
}

export interface Device {
  id: string;
  deviceNumber: string;
  name: string;
  location: string;
  provider: ProviderType;
  providerLabel: string;
  phoneNumber: string;
  status: 'online' | 'offline' | 'warning';
  batteryLevel: number;
  lastPing: string;
  offlineDuration?: string;
  txnsToday: number;
  volumeToday: number;
  agentVersion: string;
  configVersion: string;
  verifiedAt?: string;
  notificationListenerGranted?: boolean;
  batteryOptimizationExempt?: boolean;
}

export interface ProviderRail {
  /** Persistent payment_sources.id. A workspace may have more than one source per provider. */
  id: string;
  provider: ProviderType;
  name: string;
  sharePercentage: number;
  volume: number;
  target: number;
  txnsCount: number;
  color: string;
  walletNumber: string;
  dailyLimit: number;
  monthlyLimit: number;
  /** Usage comes from the verified source-specific Cairo-period counter. */
  dailyIntake?: number;
  monthlyIntake?: number;
  dailyPercentage?: number;
  monthlyPercentage?: number;
  isPaused?: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  nameAr: string;
  subTitle: string;
  initials: string;
  slug?: string;
  defaultTimezone?: string;
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: 'owner' | 'admin' | 'manager' | 'viewer';
  organizationId?: string;
  emailVerified?: boolean;
  isPlatformAdmin?: boolean;
}

export interface TeamMember {
  id: string;
  email: string;
  fullName: string;
  role: 'owner' | 'admin' | 'manager' | 'viewer';
  joinedAt: string;
}

export interface OnboardingState {
  hasCompletedOnboarding: boolean;
  activeStep: number;
}

export interface SubscriptionPlan {
  id: string;
  name_en: string;
  name_ar: string;
  billing_cycle: 'monthly' | 'annual';
  price_egp: number;
  device_limit: number;
  features_json: string;
  is_active: number;
  created_at?: string;
  updated_at?: string;
}

export interface CurrentSubscription {
  hasSubscription: boolean;
  id?: string;
  planId?: string;
  planNameAr: string;
  planNameEn: string;
  billingCycle?: 'monthly' | 'annual';
  priceEgp?: number;
  status: 'inactive' | 'active' | 'expired' | 'grace_period' | 'trial' | 'trial_expired';
  isTrial?: boolean;
  trialExpired?: boolean;
  hoursRemaining?: number;
  deviceLimit: number;
  devicesUsed: number;
  devicesRemaining: number;
  startsAt: string | null;
  endsAt: string | null;
  daysRemaining: number;
  features: string[];
  lastOrderId?: string;
}

export interface SubscriptionOrder {
  id: string;
  order_number: string;
  organization_id: string;
  user_id: string;
  plan_id: string;
  plan_name_en: string;
  plan_name_ar: string;
  billing_cycle: 'monthly' | 'annual';
  price_egp: number;
  currency: string;
  device_limit: number;
  features_json: string;
  instapay_target_number: string;
  status: 'pending_payment' | 'payment_reported' | 'in_review' | 'confirmed' | 'rejected' | 'expired';
  reported_transfer_ref?: string;
  reported_sender_info?: string;
  reported_sender_phone?: string;
  reported_transfer_time?: string;
  reported_notes?: string;
  reported_at?: string;
  matched_transaction_id?: string;
  approved_by_user_id?: string;
  approval_type?: 'automatic' | 'manual';
  rejection_reason?: string;
  review_notes?: string;
  expires_at: string;
  confirmed_at?: string;
  created_at: string;
  updated_at: string;
  // Joins in platform view
  org_name?: string;
  org_name_ar?: string;
  user_email?: string;
  user_full_name?: string;
}

export interface SubscriptionReceipt {
  id: string;
  receipt_number: string;
  order_id: string;
  organization_id: string;
  plan_id: string;
  plan_name_ar?: string;
  plan_name_en?: string;
  org_name?: string;
  org_name_ar?: string;
  amount_paid: number;
  currency: string;
  payment_method: string;
  matched_external_trx_id?: string;
  billing_cycle: 'monthly' | 'annual';
  period_start: string;
  period_end: string;
  issued_at: string;
}

export interface PlatformOverview {
  totalRevenueEgp: number;
  activeSubscriptions: number;
  pendingReviewOrders: number;
  totalOrders: number;
  totalMerchants: number;
  platformDevice?: Device | null;
}
