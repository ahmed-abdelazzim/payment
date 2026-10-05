# PostgreSQL target migrations

These files describe the PostgreSQL production target for Sarraf Ops. They do
**not** switch the checked-in Express server from SQLite to PostgreSQL. The
server must first receive a PostgreSQL data-access implementation, transaction
scoping, and integration tests before a deployment uses these migrations.

Apply `001_initial_schema.sql` first, then
`002_runtime_entities_and_rls.sql`, with a migration role that owns the
application tables. The second migration is rerunnable: it backfills direct
tenant ownership for child rows, stops if a row cannot be attributed safely,
and replaces its named RLS policies and triggers.

`002` adds the production-target records that the SQLite bridge already models:
hashed session/reset/verification/invitation/pairing tokens, subscription
orders and entitlements, platform billing settings, durable outbox state, and
webhook delivery history. It seeds the product catalogue with the 7-day,
one-device trial plus the 499 EGP/3-device, 799 EGP/5-device, and 7,990 EGP
annual/10-device plans. The default platform InstaPay number is `01551234263`.
Raw tokens and integration secrets are intentionally not represented as
plaintext target columns.

## Required runtime contract after the PostgreSQL port

Use separate database roles for the web application, authentication/provisioning
flow, ingestion/audit path, and outbox worker. The end-user web role must not
own the tables and must not receive `SELECT` permission on `users.password_hash`
or device/integration secret columns. At the start of every request transaction, after authentication,
the web application must execute:

```sql
SET LOCAL app.current_user_id = '<authenticated-user-uuid>';
```

The RLS helpers use this setting plus `organization_members` to select the
tenant. A missing or invalid setting sees no tenant rows. The background roles
must be narrowly provisioned: they need either approved security-definer
procedures or `BYPASSRLS` only when their job requires cross-tenant work. Do
not expose either role or its credentials to browser code.

Before cutover, run the migration in staging, verify tenant A cannot read tenant
B under the web role, validate session expiry/revocation and token hashing, and
exercise the outbox lease/retry path with more than one worker. PostgreSQL RLS
is not active in the current SQLite runtime.
