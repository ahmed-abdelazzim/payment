/**
 * Egyptian Telecom Mobile Wallet & InstaPay Transaction Parser
 * Supports Vodafone Cash, InstaPay (IPN), Orange Cash, Etisalat Cash, and WE Pay.
 * Includes intelligent filtering for Personal SMS, OTP codes, and Telecom Marketing Promos.
 */

export type MessageCategory =
  | 'inbound_credit' // Real customer transfer/payment received (Recorded to ledger)
  | 'outbound_debit' // Cash withdrawal, purchase, debit (Filtered out of merchant revenue)
  | 'telecom_promo' // Marketing ads, recharge offers, internet packages (Filtered out)
  | 'otp_security' // One-time verification codes, login tokens (Filtered out)
  | 'personal_chat'; // Regular personal conversation / non-financial SMS (Filtered out)

export interface ParsedTransaction {
  amount: number;
  currency: string;
  senderPhone: string;
  senderName: string;
  statedBalance?: number;
  externalTrxId: string;
  provider: 'vodafone_cash' | 'instapay' | 'orange_cash' | 'etisalat_cash' | 'we_pay';
  confidenceScore: number;
  isFinancialTransaction: boolean;
  messageCategory: MessageCategory;
  ignoreReason?: string;
  unverifiedWarning?: string;
}

// Convert Eastern Arabic numerals (٠-٩) to Western Arabic (0-9)
export function normalizeNumerals(input: string): string {
  const eastern = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  let output = input;
  for (let i = 0; i < 10; i++) {
    output = output.replaceAll(eastern[i], i.toString());
  }
  return output;
}

export function parseEgyptianPaymentMessage(rawMessage: string, providerHint?: string): ParsedTransaction {
  const normalized = normalizeNumerals(rawMessage || '').trim();

  // ========================================================
  // FILTER 1: OTP & SECURITY VERIFICATION CODES (FILTER OUT)
  // ========================================================
  const isOtpPattern =
    /(?:كود\s*(?:تأكيد|التحقق|التفعيل|الأمان|سري)|رمز\s*(?:التحقق|الأمان|التأكيد|الدخول)|(?:verification|security|confirm(?:ation)?|otp)\s*(?:code|pin)|لا\s*تشارك\s*هذا\s*الرمز|do\s*not\s*share|one[- ]time\s*password)/i.test(
      normalized
    );

  if (isOtpPattern && !/(?:تم\s*استلام\s*مبلغ|رصيدك\s*الحالي)/i.test(normalized)) {
    return {
      amount: 0,
      currency: 'EGP',
      senderPhone: 'System',
      senderName: 'OTP Service',
      externalTrxId: '',
      provider: 'vodafone_cash',
      confidenceScore: 0,
      isFinancialTransaction: false,
      messageCategory: 'otp_security',
      ignoreReason: 'كود تحقق أمني / OTP (تم التصفية تلقائياً)',
    };
  }

  // ========================================================
  // FILTER 2: TELECOM ADS, PROMOS & BUNDLE OFFERS (FILTER OUT)
  // ========================================================
  const isPromoPattern =
    /(?:عرض\s*(?:الضعف|اليوم|خاص|الصيف|الشتاء|مؤقت|الأسعار)|اشحن\s*(?:بـ|كارت)?\s*\d*\s*(?:واحصل|واكسب|ليصلك|دقيقة)|مبروك\s*(?:كسبت|ليك)|دقائق\s*(?:وميجابايتس|لكل\s*الشبكات)|ميجابايت|باقة\s*(?:الإنترنت|فليكس|كومبو)|جدد\s*باقتك|للاشتراك\s*اطلب|صلاحية\s*العرض|كلم\s*#\d+|كاش\s*باك\s*\d+%?)/i.test(
      normalized
    );

  if (isPromoPattern && !/(?:تم\s*استلام\s*مبلغ|تم\s*إيداع|رصيدك\s*الحالي\s*هو)/i.test(normalized)) {
    return {
      amount: 0,
      currency: 'EGP',
      senderPhone: 'Telecom Carrier',
      senderName: 'Promo Ad',
      externalTrxId: '',
      provider: 'vodafone_cash',
      confidenceScore: 0,
      isFinancialTransaction: false,
      messageCategory: 'telecom_promo',
      ignoreReason: 'إعلان ترويجي أو باقة شبكة (تم التصفية تلقائياً)',
    };
  }

  // ========================================================
  // FILTER 3: OUTBOUND DEBIT / CASH WITHDRAWAL (FILTER OUT)
  // ========================================================
  const isDebitPattern =
    /(?:تم\s*سحب|تم\s*خصم|تم\s*شراء\s*كارت|دفع\s*فاتورة|سداد\s*فاتورة|تحويل\s*مبلغ\s*\d+.*?\s*إلى\s*رقم|سحب\s*نقدي|من\s*ماكينة\s*(?:ATM|صراف))/i.test(
      normalized
    ) && !/(?:تم\s*استلام|تم\s*إيداع|تم\s*إضافة|استلمت|تحويل\s*من)/i.test(normalized);

  if (isDebitPattern) {
    return {
      amount: 0,
      currency: 'EGP',
      senderPhone: 'System',
      senderName: 'Debit Event',
      externalTrxId: '',
      provider: 'vodafone_cash',
      confidenceScore: 0,
      isFinancialTransaction: false,
      messageCategory: 'outbound_debit',
      ignoreReason: 'عملية سحب أو خصم أو سداد فاتورة (ليست إيداعاً وارداً)',
    };
  }

  // ========================================================
  // 1. DETECT PROVIDER
  // ========================================================
  let provider: 'vodafone_cash' | 'instapay' | 'orange_cash' | 'etisalat_cash' | 'we_pay' = 'vodafone_cash';
  if (providerHint && ['vodafone_cash', 'instapay', 'orange_cash', 'etisalat_cash', 'we_pay'].includes(providerHint)) {
    provider = providerHint as any;
  } else if (/instapay|ipn|شبكة المدفوعات اللحظية/i.test(normalized)) {
    provider = 'instapay';
  } else if (/orange|أورنج/i.test(normalized)) {
    provider = 'orange_cash';
  } else if (/etisalat|اتصالات|e&/i.test(normalized)) {
    provider = 'etisalat_cash';
  } else if (/we\s*pay|وي\s*باي|المصرية للاتصالات/i.test(normalized)) {
    provider = 'we_pay';
  } else {
    provider = 'vodafone_cash';
  }

  // ========================================================
  // 2. EXTRACT AMOUNT
  // ========================================================
  let amount = 0;
  const amountMatch =
    normalized.match(/(?:مبلغ|قيمة|بقيمة|إيداع|استلمت|تم\s*استلام|تحويل|EGP)\s*[:]?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i) ||
    normalized.match(/([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:جم|جنيه|ج\.م|EGP|LE|L\.E)/i);

  if (amountMatch) {
    amount = parseFloat(amountMatch[1].replace(/,/g, ''));
  }

  // ========================================================
  // 3. CHECK INBOUND CREDIT KEYWORDS
  // ========================================================
  const hasInboundKeywords =
    /(?:تم\s*(?:استلام|إيداع|إضافة|تحويل)|استلمت|وصلك|received|credited)/i.test(normalized) ||
    /(?:رصيدك\s*(?:الحالي|الآن)|رصيد\s*محفظتك|رصيد\s*فودافون\s*كاش|الرصيد\s*المتاح)/i.test(normalized) ||
    /(?:instapay|ipn|شبكة\s*المدفوعات\s*اللحظية)/i.test(normalized);

  // If there's no amount or no credit keywords -> CLASSIFY AS PERSONAL CHAT
  if (amount <= 0 || !hasInboundKeywords) {
    return {
      amount: 0,
      currency: 'EGP',
      senderPhone: 'Personal',
      senderName: 'Personal Message',
      externalTrxId: '',
      provider,
      confidenceScore: 0,
      isFinancialTransaction: false,
      messageCategory: 'personal_chat',
      ignoreReason: 'رسالة شخصية / محادثة غير مالية (تم التصفية تلقائياً)',
    };
  }

  // ========================================================
  // 4. EXTRACT STATED BALANCE
  // ========================================================
  let statedBalance: number | undefined;
  const balanceMatch = normalized.match(
    /(?:رصيد.*?الآن|رصيد.*?الحالي|رصيدك.*?الآن|رصيدك.*?الحالي)\s*[:]?\s*(?:هو\s*)?([0-9,]+(?:\.[0-9]{1,2})?)/i
  );
  if (balanceMatch) {
    statedBalance = parseFloat(balanceMatch[1].replace(/,/g, ''));
  }

  // ========================================================
  // 5. EXTRACT SENDER PHONE OR ALIAS
  // ========================================================
  let senderPhone = 'Unknown';
  const phoneMatch =
    normalized.match(/(?:من|من رقم|من محفظة|from)\s*[:]?\s*(?:\+?20)?(01[0125][0-9]{8})/i) ||
    normalized.match(/\((?:\+?20)?(01[0125][0-9]{8})\)/) ||
    normalized.match(/(?:\+?20)?(01[0125][0-9]{8})/);
  if (phoneMatch) {
    senderPhone = phoneMatch[1];
  } else {
    // Check for email / InstaPay address e.g. tarek@instapay
    const vpaMatch = normalized.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+)/);
    if (vpaMatch) {
      senderPhone = vpaMatch[1];
    }
  }

  // ========================================================
  // 6. EXTRACT SENDER NAME
  // ========================================================
  let senderName = 'Unknown Sender';
  const nameMatch = normalized.match(/(?:من|تحويل من)\s+([A-Za-z\u0600-\u06FF\s]{3,25}?)(?:\s+بقيمة|\s+برقم|\s+عبر|\s*\(|\s*\.)/);
  if (nameMatch && !nameMatch[1].includes('01')) {
    senderName = nameMatch[1].trim();
  }

  // ========================================================
  // 7. EXTRACT EXTERNAL TRANSACTION ID
  // ========================================================
  let externalTrxId = '';
  const trxMatch = normalized.match(/(?:رقم العملية|المرجع|Reference|رقم المعاملة|مرجع المعاملة)\s*[:#]?\s*([A-Za-z0-9_-]{5,25})/i);
  if (trxMatch) {
    externalTrxId = trxMatch[1].trim();
  } else {
    // Generate deterministic fingerprint if ID is absent
    const hashStr = `${provider}_${amount}_${senderPhone}_${normalized.substring(0, 30)}`;
    let hash = 0;
    for (let i = 0; i < hashStr.length; i++) {
      hash = ((hash << 5) - hash) + hashStr.charCodeAt(i);
      hash |= 0;
    }
    externalTrxId = `GEN-${Math.abs(hash)}`;
  }

  // ========================================================
  // 8. CONFIDENCE & ANOMALY DETECTION
  // ========================================================
  let confidenceScore = 70.0;
  let unverifiedWarning: string | undefined;

  if (amount > 0) confidenceScore += 15;
  if (senderPhone !== 'Unknown') confidenceScore += 5;
  if (statedBalance !== undefined) confidenceScore += 5;
  if (trxMatch) confidenceScore += 5;

  confidenceScore = Math.min(confidenceScore, 99.5);

  // Warning detection for unverified USSD SMS
  if (normalized.includes('تأكد من رصيدك') || normalized.includes('#115#') || normalized.includes('#9*')) {
    unverifiedWarning = 'SMS notification unverified against USSD string';
    confidenceScore = Math.min(confidenceScore, 88.0);
  } else if (normalized.includes('غير مؤكد') || normalized.includes('تحذير')) {
    unverifiedWarning = 'Needs operator confirmation · SMS mismatch warning';
    confidenceScore = Math.min(confidenceScore, 85.0);
  }

  return {
    amount,
    currency: 'EGP',
    senderPhone,
    senderName,
    statedBalance,
    externalTrxId,
    provider,
    confidenceScore,
    isFinancialTransaction: true,
    messageCategory: 'inbound_credit',
    unverifiedWarning,
  };
}
