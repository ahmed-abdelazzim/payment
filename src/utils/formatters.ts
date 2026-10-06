/**
 * Standard formatters and validators for Sarraf Ops.
 * Handles dual-language localization (Arabic / English) and Egyptian financial standards.
 */

export const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/**
 * Converts Eastern Arabic numerals (٠-٩) to Latin numerals (0-9) and removes whitespace/hyphens.
 */
export function normalizeDigits(input: string): string {
  if (!input) return '';
  return input
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/[\s-]/g, '');
}

/**
 * Validates an 11-digit Egyptian mobile phone number (Vodafone, Orange, Etisalat, WE).
 * Accepts raw input with spaces, hyphens, or Eastern Arabic numerals.
 */
export function validateEgyptianPhone(phone: string): boolean {
  const normalized = normalizeDigits(phone);
  return /^01[0125]\d{8}$/.test(normalized);
}

/**
 * Validates an InstaPay receiving identifier:
 * Either an 11-digit Egyptian mobile number or a VPA handle (e.g. name@instapay).
 */
export function validateInstapayAddress(address: string): boolean {
  const normalized = normalizeDigits(address);
  if (/^01[0125]\d{8}$/.test(normalized)) return true;
  return /^[A-Za-z0-9._-]{3,64}@[A-Za-z]{2,32}$/.test(address.trim());
}

/**
 * Formats an amount in Egyptian Pounds (EGP).
 */
export function formatEGP(amount: number | string | undefined | null, language: 'en' | 'ar' = 'ar'): string {
  const numeric = typeof amount === 'string' ? parseFloat(amount) : Number(amount ?? 0);
  if (isNaN(numeric)) return language === 'ar' ? '٠ ج.م' : '0 EGP';
  
  const formatted = numeric.toLocaleString('en-US', {
    minimumFractionDigits: numeric % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });

  return language === 'ar' ? `${formatted} ج.م` : `${formatted} EGP`;
}

/**
 * Formats a date or ISO string with the appropriate locale.
 */
export function formatDate(
  isoOrDate: string | Date | undefined | null,
  language: 'en' | 'ar' = 'ar',
  options?: Intl.DateTimeFormatOptions
): string {
  if (!isoOrDate) return language === 'ar' ? 'غير محدد' : 'N/A';
  try {
    const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
    if (isNaN(d.getTime())) return String(isoOrDate);
    
    const defaultOptions: Intl.DateTimeFormatOptions = options || {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    };
    return d.toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', defaultOptions);
  } catch {
    return String(isoOrDate);
  }
}

/**
 * Formats a timestamp into a friendly localized "time ago" string.
 */
export function formatTimeAgo(isoOrDate: string | Date | undefined | null, language: 'en' | 'ar' = 'ar'): string {
  if (!isoOrDate) return language === 'ar' ? 'منذ قليل' : 'Just now';
  try {
    const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);

    if (diffSec < 45) {
      return language === 'ar' ? 'منذ قليل' : 'Just now';
    }
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) {
      if (language === 'ar') {
        if (diffMin === 1) return 'منذ دقيقة';
        if (diffMin === 2) return 'منذ دقيقتين';
        if (diffMin <= 10) return `منذ ${diffMin} دقائق`;
        return `منذ ${diffMin} دقيقة`;
      }
      return `${diffMin} min ago`;
    }
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) {
      if (language === 'ar') {
        if (diffHours === 1) return 'منذ ساعة';
        if (diffHours === 2) return 'منذ ساعتين';
        if (diffHours <= 10) return `منذ ${diffHours} ساعات`;
        return `منذ ${diffHours} ساعة`;
      }
      return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    }
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) {
      if (language === 'ar') {
        if (diffDays === 1) return 'أمس';
        if (diffDays === 2) return 'منذ يومين';
        if (diffDays <= 10) return `منذ ${diffDays} أيام`;
        return `منذ ${diffDays} يوم`;
      }
      return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    }
    return formatDate(d, language);
  } catch {
    return language === 'ar' ? 'منذ قليل' : 'Just now';
  }
}
