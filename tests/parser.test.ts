import test from 'node:test';
import assert from 'node:assert';
import { parseEgyptianPaymentMessage, normalizeNumerals } from '../server/parser/engine';

test('Numeral Normalization: converts Eastern Arabic digits to Western digits', () => {
  assert.strictEqual(normalizeNumerals('مبلغ ١٤٥٠ جنيه'), 'مبلغ 1450 جنيه');
  assert.strictEqual(normalizeNumerals('رقم ٠١٠١٩٢٨٣٩٢١'), 'رقم 01019283921');
});

test('Parser: Vodafone Cash Standard Credit Message', () => {
  const msg = 'تم استلام مبلغ 1,450 جنيه من 01029182921. رصيد فودافون كاش الحالي 29,970 جنيه. رقم العملية: VF-882910';
  const parsed = parseEgyptianPaymentMessage(msg);

  assert.strictEqual(parsed.provider, 'vodafone_cash');
  assert.strictEqual(parsed.amount, 1450.0);
  assert.strictEqual(parsed.senderPhone, '01029182921');
  assert.strictEqual(parsed.statedBalance, 29970.0);
  assert.strictEqual(parsed.externalTrxId, 'VF-882910');
  assert.strictEqual(parsed.isFinancialTransaction, true);
  assert.ok(parsed.confidenceScore >= 90.0);
});

test('Parser: InstaPay IPN Credit Notification', () => {
  const msg = 'InstaPay: EGP 4,200.00 received from Sherif Adel (01129384342) via IPN. Reference: IPN-8930219.';
  const parsed = parseEgyptianPaymentMessage(msg, 'instapay');

  assert.strictEqual(parsed.provider, 'instapay');
  assert.strictEqual(parsed.amount, 4200.0);
  assert.strictEqual(parsed.externalTrxId, 'IPN-8930219');
  assert.strictEqual(parsed.isFinancialTransaction, true);
  assert.ok(parsed.confidenceScore >= 90.0);
});

test('Parser: Orange Cash Unverified USSD Anomaly Detection', () => {
  const msg = 'تم تحويل مبلغ 850 جنيه من محفظة 01201928610. برجاء التأكد من رصيدك عبر #115#.';
  const parsed = parseEgyptianPaymentMessage(msg, 'orange_cash');

  assert.strictEqual(parsed.provider, 'orange_cash');
  assert.strictEqual(parsed.amount, 850.0);
  assert.strictEqual(parsed.unverifiedWarning, 'SMS notification unverified against USSD string');
  assert.ok(parsed.confidenceScore <= 88.0, 'Confidence score must be penalized when USSD handshake is missing');
});

test('Parser: e& Cash (Etisalat) Standard Inbound', () => {
  const msg = 'استلمت 520.00 جنيه من سلمى هشام عبر اتصالات كاش. رقم المعاملة: ET-40918';
  const parsed = parseEgyptianPaymentMessage(msg, 'etisalat_cash');

  assert.strictEqual(parsed.provider, 'etisalat_cash');
  assert.strictEqual(parsed.amount, 520.0);
  assert.strictEqual(parsed.externalTrxId, 'ET-40918');
  assert.strictEqual(parsed.isFinancialTransaction, true);
});

test('Filter: Personal Messages are detected and filtered out', () => {
  const personal1 = 'ازيك يا احمد عامل ايه؟ طمني عليك اول ما تشوف الرسالة';
  const res1 = parseEgyptianPaymentMessage(personal1);
  assert.strictEqual(res1.isFinancialTransaction, false);
  assert.strictEqual(res1.messageCategory, 'personal_chat');

  const personal2 = 'فينك يا صاحبي انا مستنيك على القهوة ومعايا 01012345678';
  const res2 = parseEgyptianPaymentMessage(personal2);
  assert.strictEqual(res2.isFinancialTransaction, false);
  assert.strictEqual(res2.messageCategory, 'personal_chat');
});

test('Filter: OTP and Security Codes are detected and filtered out', () => {
  const otp1 = 'كود التأكيد الخاص بك هو 582910. لا تشارك هذا الرمز مع أي شخص.';
  const res1 = parseEgyptianPaymentMessage(otp1);
  assert.strictEqual(res1.isFinancialTransaction, false);
  assert.strictEqual(res1.messageCategory, 'otp_security');

  const otp2 = 'Your verification code is 849201. One-time password valid for 5 minutes.';
  const res2 = parseEgyptianPaymentMessage(otp2);
  assert.strictEqual(res2.isFinancialTransaction, false);
  assert.strictEqual(res2.messageCategory, 'otp_security');
});

test('Filter: Telecom Promos and Marketing Ads are filtered out', () => {
  const promo1 = 'عرض اليوم من فودافون! اشحن كارت بـ 10 واحصل على 300 دقيقة وميجابايت لكل الشبكات. كلم #10*';
  const res1 = parseEgyptianPaymentMessage(promo1);
  assert.strictEqual(res1.isFinancialTransaction, false);
  assert.strictEqual(res1.messageCategory, 'telecom_promo');

  const promo2 = 'مبروك كسبت 500 ميجابايت هدية صالحة حتى نهاية اليوم';
  const res2 = parseEgyptianPaymentMessage(promo2);
  assert.strictEqual(res2.isFinancialTransaction, false);
  assert.strictEqual(res2.messageCategory, 'telecom_promo');
});

test('Filter: Outbound Debit and Cash Withdrawals are filtered out', () => {
  const debit1 = 'تم سحب مبلغ 500 جنيه من محفظتك من ماكينة ATM بنك مصر.';
  const res1 = parseEgyptianPaymentMessage(debit1);
  assert.strictEqual(res1.isFinancialTransaction, false);
  assert.strictEqual(res1.messageCategory, 'outbound_debit');

  const debit2 = 'تم سداد فاتورة الكهرباء بمبلغ 320.00 جنيه بنجاح.';
  const res2 = parseEgyptianPaymentMessage(debit2);
  assert.strictEqual(res2.isFinancialTransaction, false);
  assert.strictEqual(res2.messageCategory, 'outbound_debit');
});

