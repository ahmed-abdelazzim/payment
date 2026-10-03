# Architecture Decision Records (ADRs)

## ADR-001: Primary Relational Database Selection
- **Decision**: PostgreSQL with Row-Level Security (RLS).
- **Status**: Approved.
- **Context**: The existing system uses Google Sheets, which lacks atomicity, concurrency control, and relational integrity.
- **Alternatives Considered**: MongoDB, MySQL, SQLite, Cloud Firestore.
- **Why Chosen**: PostgreSQL provides native RLS for airtight multi-tenant isolation, exact `NUMERIC` decimal arithmetic, row-level locking (`FOR UPDATE`) for per-account reconciliation, and transactional outbox patterns.
- **Consequences**: Requires structured migrations and connection pooling (PgBouncer).

## ADR-002: Modular Monolith vs Microservices
- **Decision**: Modular Monolith in Node.js / TypeScript.
- **Status**: Approved.
- **Context**: Early-stage SaaS targeting 10 to 1,000 organizations.
- **Alternatives Considered**: Kubernetes Microservices (Ingestion Service, Parser Service, Notification Service).
- **Why Chosen**: Microservices introduce distributed transaction complexity, network overhead, and high cloud costs without justification at this stage. A clean modular monolith with distinct domains satisfies all scaling requirements.

## ADR-003: Ingestion Device Authentication
- **Decision**: Cryptographic HMAC-SHA256 request signatures with timestamps and nonces.
- **Status**: Approved.
- **Context**: The legacy ingestion endpoint is unauthenticated, allowing trivial payment forgery.
- **Alternatives Considered**: Simple static API Key, OAuth2 mTLS.
- **Why Chosen**: Static API keys are vulnerable to replay attacks and packet inspection. HMAC-SHA256 protects body integrity, prevents replays via nonces, and can be implemented on Android and capable gateways without high handshake overhead.

## ADR-004: Ingestion Pipeline & Outbox Pattern
- **Decision**: Store raw event immutably and enqueue work in transactional outbox in single DB transaction.
- **Status**: Approved.
- **Context**: Need to acknowledge device uploads immediately without risking lost jobs if downstream workers crash.
- **Alternatives Considered**: Synchronous processing during HTTP request, external Kafka cluster.
- **Why Chosen**: Synchronous processing causes device timeouts. Kafka is massive overengineering for early SaaS. PostgreSQL transactional outbox provides guaranteed at-least-once processing.

## ADR-005: Separation of Financial Limits vs Plan Quotas (Section 4A)
- **Decision**: Separate regulatory financial capacity trackers from billing subscription quotas.
- **Status**: Approved.
- **Context**: Merchants have regulatory CBE wallet ceilings (e.g. 60,000 EGP daily) that exist independently of whether they are on the SaaS Starter or Pro plan.
