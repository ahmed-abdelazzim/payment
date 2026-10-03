# Cross-Platform Capture Adapters & Capability Matrix (Section 4B)

## 1. Executive Adapter Capability Matrix

| Adapter Path | Target Environment | Technical Ingestion Method | Automation Degree | Trust Level | Status & Evidence |
|---|---|---|---|---|---|
| **Android MacroDroid Bridge** | Android 8.0 - 15 (Standard & Non-GMS) | Inbound SMS/Notification Trigger -> HTTP POST with HMAC-SHA256 | 100% Autonomous | High (Signed) | **Verified (Working Baseline)** |
| **Android Native Agent APK** | Android 8.0+ | `NotificationListenerService` + `BroadcastReceiver` -> Encrypted SQLite Outbox | 100% Autonomous | Highest (Signed + Device Key) | **Architecture Defined** (Task SAAS-025) |
| **iOS Apple Shortcuts Automation** | iOS 16.4 - 18+ (iPhone) | Personal Automation Trigger ("Message Contains...") -> Webhook POST | Semi-autonomous to Autonomous | Moderate (Token-based) | **Requires Prototype Validation** |
| **Dedicated Business SIM Phone** | Merchant uses any device; SIM in dedicated Android gateway | MacroDroid / Native Agent on dedicated station phone | 100% Autonomous | High (Signed) | **Verified Operational Pattern** |
| **Huawei EMUI Profile (No GMS)** | EMUI 10 - 14 / HarmonyOS | Direct HTTPS via Native APK or MacroDroid APK with Manual Launch | 100% Autonomous | High (Signed) | **Requires Hardware Validation** |
| **Manual Submission / Paste** | Web Dashboard on any browser | Merchant pastes raw SMS text or uploads screenshot | Manual Action | Low (Quarantined) | **Fallback Only** (Always Review Required) |

---

## 2. iOS Apple Shortcuts Evaluation (Prototype Validation Path)

### 2.1 The Architectural Opportunity
Rather than declaring iOS impossible or asserting that an Android phone is the only solution, Sarraf Ops treats Apple Shortcuts Personal Automations as an active validation candidate:
- **Capability Basis**: Apple Shortcuts allows creating a Personal Automation triggered by incoming messages matching specific sender keywords (e.g. `VodafoneCash`, `OrangeCash`, `InstaPay`).
- **Automation Execution**: In iOS 17+, Apple introduced the ability to toggle off "Ask Before Running" and "Notify When Run" for message automations, allowing background execution.

### 2.2 Strict Technical Constraints to Validate (Test Gate SAAS-010)
A physical iOS device running iOS 17/18 must be tested against these exact criteria before production release:
1. **Locked-Screen Network POST**: Does iOS permit background network transmission (HTTPS POST) while the device has been locked and asleep for over 30 minutes?
2. **Payload Completeness**: Does the shortcut variable capture the full message body text, sender identity, and exact arrival timestamp without truncation?
3. **Network Failure & Retry Durability**: If the iPhone loses cellular/Wi-Fi connection during payment arrival, does Apple Shortcuts drop the execution, or can it queue the payload locally?
4. **Cryptographic Signing Feasibility**: Can native Shortcuts actions calculate an HMAC-SHA256 signature, or must it use a scoped revocable ingestion token over TLS?
- **Conclusion**: Shortcuts is classified as **Requires Prototype Validation**. If validation fails on background durability, the customer is transparently guided to the dedicated business SIM pattern.

---

## 3. Huawei Devices (EMUI / HarmonyOS without GMS)

### 3.1 Architectural GMS-Independence
The Sarraf Ops capture protocol relies entirely on standard HTTPS and does NOT require Google Play Services, Firebase Cloud Messaging (FCM), or Google Sign-In.

### 3.2 EMUI Background Retention Policy
Huawei's "PowerGenie" and aggressive battery optimization must be configured manually by the merchant during onboarding:
1. **App Launch Configuration**:
   - Navigate to: `Settings -> Battery -> App Launch`.
   - Locate the capture adapter and toggle from "Manage automatically" to "Manage manually".
   - Enable all three permissions:
     - `Auto-launch` (تشغيل تلقائي)
     - `Secondary launch` (تشغيل ثانوي)
     - `Run in background` (تشغيل في الخلفية)
2. **Battery Optimization Whitelist**:
   - `Settings -> Apps -> Special access -> Battery optimization -> All apps`.
   - Set the adapter to `Don't allow` (which allows background consumption).
3. **Validation Test Gate (Task SAAS-011)**:
   - Must be verified on physical non-GMS hardware (e.g. Huawei Y7a / Nova series) simulating device restart, 4-hour screen-off sleep, and network reconnection.

---

## 4. Dedicated Business Gateway Phone Pattern
For merchants who prefer not to run automations on their personal phones (whether iPhone or Android):
- The merchant retains their personal phone for viewing the Sarraf Ops web dashboard.
- The business wallet SIM is housed in an affordable dedicated Android phone ($40-$60 hardware cost) connected to permanent power and Wi-Fi at the office or cash desk.
- This pattern guarantees 99.9% uptime, uninhibited background execution, and complete isolation from the merchant's personal communications.
