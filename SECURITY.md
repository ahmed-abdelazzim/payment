# Security Architecture & Threat Model (Section 25)

> **تنبيه حالة:** الملف يحدد هدف الحماية. التطبيق الحالي يطبق HMAC والجلسات والقيود العلائقية المحلية، لكن RLS لا يتوفر في SQLite. لا تعتبر ذكر PostgreSQL في هذا الملف دليلًا على أن ترحيل الإنتاج أو التحقق الفيزيائي من الأجهزة قد اكتمل؛ راجع `docs/PRODUCT_CONTRACT.md`.

## 1. Threat Modeling & Attack Vectors

| Attack Vector | Impact | Mitigations in Sarraf Ops Architecture |
|---|---|---|
| **Forged Ingestion POST** | Attacker creates phantom transactions | Mandatory HMAC-SHA256 request signing with device-specific secret. No unauthenticated endpoints. |
| **Replay Attack** | Attacker re-submits a captured genuine HTTP request | Nonce tracking (`idx_raw_events_nonce`) combined with a strict timestamp freshness window (±300 seconds). |
| **Spoofed Telecom SMS** | Attacker fakes SMS from "Vodafone" or "Orange" with valid sender header | Rule: SMS text is never trusted alone. Dual-channel verification via background USSD balance inquiry (`*9#`) or IPN package verification required for auto-confirmation. |
| **Balance Arithmetic Trick** | Attacker crafts SMS with mathematically matching numbers | Section 12A trust boundary: Arithmetic consistency is a necessary condition, but NOT sufficient for settlement confirmation. |
| **Cross-Tenant Leakage** | Tenant A queries Tenant B's financial data | Scoped queries وقيود علاقات المؤسسة في التنفيذ المحلي؛ PostgreSQL RLS + سياق المؤسسة داخل المعاملة مطلوبة قبل التشغيل متعدد النسخ. |
| **Compromised Capture Device** | Rogue device sends garbage | Instant revocation endpoint in Admin UI; immediate termination of device credentials. |
| **Customer Webhook Tampering** | MITM alters webhook payload | Webhooks signed with `X-Sarraf-Signature: sha256=...` using tenant webhook secret. |

## 2. Ingestion Request Signing Specification
Every request from a capture adapter must include:
- `X-Device-ID`: The assigned UUID of the registered device.
- `X-Timestamp`: Epoch timestamp in seconds. Must be within ±300s of server time.
- `X-Nonce`: Random cryptographic string (minimum 16 bytes base64/hex).
- `X-Signature`: `HMAC-SHA256(canonical_string, device_secret)`
```
canonical_string = "POST\n" + request_path + "\n" + timestamp + "\n" + nonce + "\n" + sha256(request_body)
```
If the signature fails or the nonce was previously seen for this organization within the last 24 hours, the request is immediately dropped with HTTP 401 Unauthorized.
