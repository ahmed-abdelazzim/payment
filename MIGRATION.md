# Phased Migration Strategy: From Google Sheets to SaaS Core

## Phase 0: Legacy Preservation & Baseline Golden Master (Week 1)
- Preserve current working Apps Script codebase in `legacy/` directory.
- Build automated regression fixtures from existing Google Sheets rows.
- Verify that extracting the regexes into TypeScript causes zero regressions.

## Phase 1: Dual-Write / Shadow Ingestion (Week 2 - 3)
- Update MacroDroid to split POST events: one to legacy Google Apps Script, one to new Sarraf Ops Ingestion Gateway.
- Compare outputs in shadow mode: reconcile parsed amounts, sender phones, and transaction IDs between PostgreSQL and Google Sheets.
- Do NOT turn off the legacy Telegram bot during this phase.

## Phase 2: Canary Tenant Cutover (Week 4)
- Migrate 2 internal merchant organizations entirely to Sarraf Ops.
- Activate PostgreSQL RLS and HMAC device signing.
- Validate Section 12A out-of-order handling under peak traffic hours.

## Phase 3: General Production Cutover & Retirement (Week 5 - 6)
- Connect optional Google Sheets bi-directional export for merchants who still desire spreadsheet backups.
- Retire legacy Apps Script endpoint.
