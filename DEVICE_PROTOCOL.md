# Mobile Agent Protocol & Device Ingestion Specification (Section 53)

## 1. Overview & Protocol Principles
The Sarraf Ops Ingestion Protocol defines the contract between payment capture adapters (Android MacroDroid, Native Android Agent, iOS Apple Shortcuts, Huawei EMUI profiles) and the SaaS API Gateway.

### Core Invariants:
1. **Zero Unauthenticated Traffic**: Every ingestion request must authenticate via HMAC-SHA256 signature using the provisioned device secret.
2. **Freshness vs. Financial Event Time**: A request signature validates the HTTP transport freshness (`X-Timestamp` within ±300s of server time). The original payment event time (`captured_at` or `provider_occurred_at`) inside the body can be hours old if uploaded from an offline backlog.
3. **Idempotent Acknowledgment**: A retransmitted event with an identical `client_event_id` or `external_trx_id` must return an HTTP 200 Duplicate Acknowledged response and NEVER create a duplicate transaction or duplicate notification.

---

## 2. Cryptographic Request Signing Specification

### 2.1 Required HTTP Request Headers
```http
POST /api/v1/devices/ingest HTTP/1.1
Host: api.sarrafops.com
Content-Type: application/json
X-Device-ID: 01948b30-2211-7391-a1e0-88b901289123
X-Timestamp: 1790858282
X-Nonce: 4f9b8c2d1e0a7f3b89c1d2e3f4a5b6c7
X-Signature: a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8
```

### 2.2 Canonical String Construction
The signature is computed as:
```
canonical_string = METHOD + "\n" + PATH + "\n" + TIMESTAMP + "\n" + NONCE + "\n" + SHA256(REQUEST_BODY)
X-Signature = HMAC-SHA256(canonical_string, device_secret_bytes)
```
- **Validation Rules**:
  - `abs(server_time - X-Timestamp) <= 300 seconds`.
  - `X-Nonce` must be unique across all requests from this organization within a 24-hour sliding window (stored in Redis or Postgres `idx_raw_events_nonce`).

---

## 3. Device Pairing Protocol

### 3.1 Handshake Flow
```
1. Operator creates device in SaaS UI -> System issues short-lived pairing token (e.g. "SARRAF-EG-4912", 15-minute TTL).
2. Adapter submits pairing request:
   POST /api/v1/devices/pair
   {
     "pairing_token": "SARRAF-EG-4912",
     "device_identifier": "Device #01",
     "device_hardware_model": "Samsung Galaxy A14",
     "adapter_type": "macrodroid",
     "adapter_version": "v3.4.1-eg",
     "operating_system": "Android 14"
   }
3. Server validates token, binds device to organization, and issues permanent credentials:
   HTTP 201 Created
   {
     "device_id": "01948b30-2211-7391-a1e0-88b901289123",
     "hmac_secret": "sec_live_9f8e7d6c5b4a3a2b1c0d9e8f7a6b5c4d",
     "organization_id": "org_cairo_logistics",
     "ingestion_endpoint": "https://api.sarrafops.com/api/v1/devices/ingest"
   }
4. Device stores credentials in secure hardware-backed storage (Android Keystore / encrypted preferences).
```

---

## 4. Ingestion Event Payload Schema

```json
{
  "protocol_version": "3.4.1-eg",
  "client_event_id": "evt_local_881920",
  "device_id": "01948b30-2211-7391-a1e0-88b901289123",
  "capture_channel": "sms",
  "adapter_type": "macrodroid",
  "bound_payment_address": "01019283921",
  "battery_level": 94,
  "device_captured_at": "2026-09-30T14:36:11+02:00",
  "provider_hint": "vodafone_cash",
  "raw_content": "تم استلام مبلغ 1,450 جنيه من 01029182921. رصيد فودافون كاش الحالي 29,970 جنيه. رقم العملية: VF-882910",
  "sender_identity": "VodafoneCash",
  "metadata": {
    "carrier_network": "Vodafone Egypt",
    "sim_slot": 1,
    "ussd_verification_available": true
  }
}
```

---

## 5. Server Response Specifications

### 5.1 Durable Receipt Accepted (HTTP 202 Accepted)
Indicates that the raw event and outbox job are safely committed to the database. Does NOT imply payment confirmation:
```json
{
  "status": "accepted",
  "server_event_id": "srv_evt_1192841",
  "receipt_timestamp": "2026-09-30T14:36:11.118Z",
  "processing_state": "queued_for_reconciliation"
}
```

### 5.2 Duplicate Retransmission (HTTP 200 OK)
Returned when a retransmission of a previously committed payload is received:
```json
{
  "status": "duplicate_acknowledged",
  "original_event_id": "srv_evt_1192841",
  "reconciliation_state": "consistent",
  "message": "Payload was already safely committed to immutable ledger."
}
```

### 5.3 Error Codes
- `HTTP 401 Unauthorized`: Invalid HMAC signature, expired timestamp, or revoked device.
- `HTTP 409 Conflict`: Nonce replayed with differing payload.
- `HTTP 429 Too Many Requests`: Ingestion rate limit exceeded for device.
