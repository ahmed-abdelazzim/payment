# Documentation of Current Legacy System

## 1. High-Level Flow
The existing system operates as follows:
```
Android Phone (with Wallet SIM) 
  --> Receives SMS / App Push Notification
  --> MacroDroid Trigger captures notification text
  --> HTTP POST to Google Apps Script Web App URL
  --> doPost(e) handler
  --> Regex Parser & Scoring Function
  --> If Confidence > Threshold:
        Append row to "Transactions" Google Sheet
        Send Telegram Broadcast to Bot Subscribers
      Else:
        Append row to "Draft" Google Sheet (no notification)
```

## 2. Ingestion Details
- **Entry Point**: Google Apps Script `doPost(e)` function published as a public Web App ("Anyone, even anonymous").
- **Authentication**: NONE. The endpoint is completely unauthenticated. Anyone with the URL can POST arbitrary JSON payloads.
- **Telegram Webhook**: The same endpoint doubles as a Telegram bot webhook, checking if `e.postData` contains a Telegram `update_id`.

## 3. Parser & Transaction Scoring
- Uses regular expressions designed for Egyptian telecom messages (Vodafone Cash, Orange Cash, Etisalat Cash, and InstaPay).
- Supports Arabic and English numbers, currency strings (EGP, ج.م, جنيه).
- Calculates a heuristic score based on presence of amount, sender phone, transaction ID, and balance string.

## 4. Storage & Deduplication
- **Storage**: Google Sheets acting as a database.
- **Duplicate Prevention**: Linear scan over the last N rows of the "Transactions" sheet comparing the Transaction ID. Highly inefficient and prone to race conditions under concurrent uploads.

## 5. Major Deficiencies for SaaS Commercialization
1. **Zero Multi-Tenancy**: Single hardcoded Google Sheet and single Telegram bot.
2. **Critical Security Hole**: No request signing, no device authentication, open to forged transactions.
3. **No Out-of-Order Handling**: Assumes messages arrive sequentially.
4. **No Financial Limit Tracking**: Does not know when a wallet is about to hit the CBE monthly limit.
5. **MacroDroid Hard Dependency**: No documented path for non-MacroDroid users or iOS merchants.
