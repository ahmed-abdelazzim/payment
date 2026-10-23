/**
 * UI & Telemetry helper functions shared across views and testable in isolation.
 */

/**
 * BUG-007: Computes target scrollTop offset taking fixed header height into account
 */
export function computeScrollTargetOffset(elementTop: number, headerHeight: number = 64, margin: number = 16): number {
  return Math.max(0, elementTop - headerHeight - margin);
}

/**
 * BUG-008: Maps password visibility boolean to HTML input type
 */
export function getPasswordInputType(showPassword: boolean): 'password' | 'text' {
  return showPassword ? 'text' : 'password';
}

/**
 * BUG-009: Translates authentication network errors into clear localized message
 */
export function formatAuthErrorMessage(err: unknown, language: 'ar' | 'en', isOnline: boolean = true): string {
  const errObj = err as any;
  const isNetworkError =
    !isOnline ||
    errObj?.message === 'Failed to fetch' ||
    errObj?.name === 'TypeError' ||
    String(errObj?.message || '').toLowerCase().includes('network') ||
    String(errObj?.message || '').toLowerCase().includes('fetch');

  if (isNetworkError) {
    return language === 'ar'
      ? 'تعذر الاتصال بالخادم. يرجى التحقق من اتصالك بالإنترنت والمحاولة مجدداً.'
      : 'Unable to connect to the server. Please check your internet connection and try again.';
  }

  return errObj?.message || (language === 'ar' ? 'فشل تسجيل الدخول' : 'Login failed');
}

/**
 * BUG-010: Computes next focus index for a modal focus trap on Tab / Shift+Tab
 */
export function getNextFocusIndex(currentIndex: number, totalElements: number, isShift: boolean): number {
  if (totalElements <= 0) return -1;
  if (isShift) {
    return currentIndex <= 0 ? totalElements - 1 : currentIndex - 1;
  }
  return currentIndex >= totalElements - 1 ? 0 : currentIndex + 1;
}

/**
 * BUG-012: Resolves telemetry state on fetch completion to prevent false empty states
 */
export function resolveTelemetryStateOnFetch<T>(
  isSuccess: boolean,
  previousData: T[],
  newData?: T[]
): { data: T[]; isError: boolean; fetchError: string | null } {
  if (!isSuccess) {
    return {
      data: previousData, // Retain existing data on network failure!
      isError: true,
      fetchError: 'FETCH_FAILED',
    };
  }
  return {
    data: newData || [],
    isError: false,
    fetchError: null,
  };
}

/**
 * BUG-001: Evaluates if onboarding limits and alerts step is completed based on workspace configuration
 */
export function isLimitsStepCompleted(workspace: any): boolean {
  return Boolean(
    workspace?.hasAlertsConfigured ||
    workspace?.telegramBotToken ||
    workspace?.webhookUrl
  );
}

/**
 * BUG-002: Serializes current tab into window URL query parameters
 */
export function syncTabToUrl(currentHref: string, tab: string): string {
  const url = new URL(currentHref);
  if (tab === 'dashboard') {
    url.searchParams.delete('tab');
  } else {
    url.searchParams.set('tab', tab);
  }
  return url.toString();
}

/**
 * BUG-004: Validates that daily turnover limit does not exceed monthly turnover limit
 */
export function validateDailyMonthlyLimits(daily: number, monthly: number): boolean {
  if (daily <= 0 || monthly <= 0) return false;
  return daily <= monthly;
}

/**
 * BUG-013: Copies text to clipboard safely with error notification fallback
 */
export async function copyToClipboardSafely(
  text: string,
  label: string,
  language: 'ar' | 'en',
  showToast: (msg: string) => void,
  customWriter?: (t: string) => Promise<void>
): Promise<boolean> {
  try {
    if (customWriter) {
      await customWriter(text);
    } else if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      throw new Error('CLIPBOARD_UNAVAILABLE');
    }
    showToast(language === 'ar' ? `تم نسخ ${label} بنجاح!` : `${label} copied to clipboard!`);
    return true;
  } catch {
    showToast(language === 'ar' ? 'تعذر النسخ تلقائياً، يرجى نسخ الرمز يدوياً' : 'Failed to copy automatically. Please copy manually.');
    return false;
  }
}

/**
 * A11Y-003: Computes relative luminance of an sRGB hex color according to WCAG 2.1 specifications
 */
export function getRelativeLuminance(hexColor: string): number {
  const cleanHex = hexColor.replace(/^#/, '').trim();
  let r = 0;
  let g = 0;
  let b = 0;
  if (cleanHex.length === 3) {
    r = parseInt(cleanHex[0] + cleanHex[0], 16) / 255;
    g = parseInt(cleanHex[1] + cleanHex[1], 16) / 255;
    b = parseInt(cleanHex[2] + cleanHex[2], 16) / 255;
  } else if (cleanHex.length === 6) {
    r = parseInt(cleanHex.slice(0, 2), 16) / 255;
    g = parseInt(cleanHex.slice(2, 4), 16) / 255;
    b = parseInt(cleanHex.slice(4, 6), 16) / 255;
  } else {
    return 0;
  }

  const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * A11Y-003: Calculates the contrast ratio between two hex colors according to WCAG AA / AAA
 */
export function calculateContrastRatio(foregroundHex: string, backgroundHex: string): number {
  const lum1 = getRelativeLuminance(foregroundHex);
  const lum2 = getRelativeLuminance(backgroundHex);
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  const ratio = (lighter + 0.05) / (darker + 0.05);
  return Number(ratio.toFixed(2));
}

/**
 * A11Y-003: Checks whether color contrast meets WCAG AA (4.5:1 for regular text, 3:1 for large text/UI components)
 */
export function isWcagAaCompliant(foregroundHex: string, backgroundHex: string, isLargeText: boolean = false): boolean {
  const ratio = calculateContrastRatio(foregroundHex, backgroundHex);
  return isLargeText ? ratio >= 3.0 : ratio >= 4.5;
}
