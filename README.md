# AuraSpear SOC Backend

A multi-tenant **Security Information and Event Management (SIEM) Backend-for-Frontend** API built with NestJS 11. It powers the AuraSpear SOC dashboard, providing alert management, case tracking, threat hunting, threat intelligence, connector integrations, and AI-assisted analysis across isolated tenants.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)
- [Database Schema](#database-schema)
- [Authentication & Authorization](#authentication--authorization)
- [Guards, Decorators & Pipes](#guards-decorators--pipes)
- [API Modules & Endpoints](#api-modules--endpoints)
- [Connector Integrations](#connector-integrations)
- [Multi-Tenancy](#multi-tenancy)
- [Security](#security)
- [Error Handling](#error-handling)
- [Pagination](#pagination)
- [Audit Logging](#audit-logging)
- [Role Hierarchy](#role-hierarchy)
- [Seed Data](#seed-data)
- [Docker Infrastructure](#docker-infrastructure)
- [NPM Scripts](#npm-scripts)
- [Code Quality](#code-quality)

---

## Tech Stack

| Category         | Technology                           | Version |
| ---------------- | ------------------------------------ | ------- |
| Runtime          | Node.js                              | 22      |
| Framework        | NestJS                               | ^11.0.0 |
| Language         | TypeScript (strict mode)             | 5.7     |
| ORM              | Prisma                               | ^6.0.0  |
| Database         | PostgreSQL                           | 16      |
| Cache            | Redis (ioredis)                      | 7       |
| Validation       | Zod                                  | ^3.23.0 |
| Auth             | JWT (jsonwebtoken) + JWKS (jwks-rsa) | ^9.0.0  |
| Password Hashing | bcryptjs                             | ^3.0.3  |
| Logging          | nestjs-pino + pino-http              | ^4.0.0  |
| API Docs         | @nestjs/swagger                      | ^11.0.0 |
| Rate Limiting    | @nestjs/throttler                    | ^6.0.0  |
| Security Headers | helmet                               | ^8.0.0  |
| Cache Manager    | cache-manager                        | ^6.0.0  |
| HTTP             | express                              | ^5.0.0  |
| UUID             | uuid                                 | ^11.0.0 |

---

## Architecture Overview

```
Frontend (Next.js) ──► BFF (NestJS) ──┬──► Wazuh Manager API        (Security SIEM)
                                      ├──► Wazuh Indexer / OpenSearch (Alert search)
                                      ├──► Graylog                    (Log management)
                                      ├──► Velociraptor               (EDR / DFIR)
                                      ├──► Grafana                    (Metrics dashboards)
                                      ├──► InfluxDB                   (Time-series data)
                                      ├──► MISP                       (Threat intelligence)
                                      ├──► Shuffle                    (SOAR workflows)
                                      ├──► AWS Bedrock                (AI analysis)
                                      └──► PostgreSQL + Redis         (Config, cases, audit)
```

**Request path**: Every request passes through a guard chain:

1. `ThrottlerGuard` — Rate limiting (100 req/60s per IP)
2. `AuthGuard` — JWT verification + user active check
3. `TenantGuard` — Tenant context validation
4. `RolesGuard` — Role-based authorization
5. `AuditInterceptor` — Mutation logging (async, non-blocking)

---

## Prerequisites

- **Node.js** >= 18
- **Docker + Docker Compose** (for PostgreSQL, Redis, PgAdmin)
- **npm** >= 9

---

## Getting Started

```bash
# 1. Clone and install
git clone <repo-url> && cd auraspear-backend
npm install

# 2. Copy environment file and configure
cp .env.example .env
# Edit .env — set DATABASE_URL, REDIS_HOST, JWT_SECRET, CONFIG_ENCRYPTION_KEY

# 3. Start infrastructure (Postgres + Redis + PgAdmin)
npm run docker:dev

# 4. Run database migrations
npm run prisma:migrate

# 5. Seed database with test data
npm run prisma:seed

# 6. Start development server
npm run start:dev
```

- **API**: `http://localhost:4000/api/v1`
- **Swagger docs**: `http://localhost:4000/api/docs` (dev only)
- **PgAdmin**: `http://localhost:5050`

### Production Start

```bash
npm run build
npm start  # Runs migrations + seed + production server
```

---

## Environment Variables

Copy `.env.example` to `.env` and configure all required variables.

### Required

| Variable                | Description                                                     | Example                                                        |
| ----------------------- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| `DATABASE_URL`          | PostgreSQL connection string                                    | `postgresql://auraspear:password@localhost:5432/auraspear_soc` |
| `JWT_SECRET`            | Secret for signing JWTs — minimum 32 hex characters             | `a1b2c3d4...` (32+ chars)                                      |
| `CONFIG_ENCRYPTION_KEY` | AES-256-GCM key for encrypting connector secrets — 32 bytes hex | `0f1e2d3c...` (64 hex chars)                                   |

### Optional (with defaults)

| Variable             | Default                 | Description                                                        |
| -------------------- | ----------------------- | ------------------------------------------------------------------ |
| `PORT`               | `4000`                  | HTTP server port                                                   |
| `NODE_ENV`           | `development`           | `development` / `production` / `test`                              |
| `LOG_LEVEL`          | `info`                  | Pino log level: `fatal`, `error`, `warn`, `info`, `debug`, `trace` |
| `CORS_ORIGINS`       | `http://localhost:3000` | Comma-separated allowed CORS origins                               |
| `JWT_ACCESS_EXPIRY`  | `15m`                   | Access token time-to-live                                          |
| `JWT_REFRESH_EXPIRY` | `7d`                    | Refresh token time-to-live                                         |
| `REDIS_HOST`         | `localhost`             | Redis host                                                         |
| `REDIS_PORT`         | `6379`                  | Redis port                                                         |
| `REDIS_PASSWORD`     | —                       | Redis password (optional)                                          |

### OIDC / Microsoft Entra ID (optional — for SSO)

| Variable          | Description                                                |
| ----------------- | ---------------------------------------------------------- |
| `OIDC_ISSUER_URL` | e.g., `https://login.microsoftonline.com/{tenant-id}/v2.0` |
| `OIDC_AUDIENCE`   | e.g., `api://auraspear-soc`                                |
| `OIDC_JWKS_URI`   | JWKS endpoint for RS256 token validation                   |
| `OIDC_CLIENT_ID`  | OAuth client ID                                            |

### Connector Defaults (optional — can be overridden per-tenant in DB)

| Variable                | Example                       |
| ----------------------- | ----------------------------- |
| `WAZUH_MANAGER_URL`     | `https://wazuh-manager:55000` |
| `WAZUH_INDEXER_URL`     | `https://wazuh-indexer:9200`  |
| `GRAYLOG_BASE_URL`      | `http://graylog:9000`         |
| `VELOCIRAPTOR_BASE_URL` | `https://velociraptor:8003`   |
| `GRAFANA_BASE_URL`      | `http://grafana:3000`         |
| `INFLUXDB_BASE_URL`     | `http://influxdb:8086`        |
| `MISP_BASE_URL`         | `https://misp:443`            |
| `SHUFFLE_BASE_URL`      | `http://shuffle:3001`         |

### AWS Bedrock (optional — for AI features)

| Variable                | Default                                   | Description      |
| ----------------------- | ----------------------------------------- | ---------------- |
| `AWS_REGION`            | `us-east-1`                               | AWS region       |
| `AWS_ACCESS_KEY_ID`     | —                                         | IAM access key   |
| `AWS_SECRET_ACCESS_KEY` | —                                         | IAM secret key   |
| `AWS_BEDROCK_MODEL_ID`  | `anthropic.claude-3-sonnet-20240229-v1:0` | Bedrock model ID |

### PostgreSQL (for Docker Compose)

| Variable            | Default         |
| ------------------- | --------------- |
| `POSTGRES_DB`       | `auraspear_soc` |
| `POSTGRES_USER`     | `auraspear`     |
| `POSTGRES_PASSWORD` | —               |
| `POSTGRES_HOST`     | `localhost`     |
| `POSTGRES_PORT`     | `5432`          |
| `PGADMIN_EMAIL`     | —               |
| `PGADMIN_PASSWORD`  | —               |
| `PGADMIN_PORT`      | `5050`          |

---

## Project Structure

```
auraspear-backend/
├── prisma/
│   ├── schema.prisma               # Database models and enums
│   ├── seed.ts                     # Test data seeder
│   └── migrations/                 # Prisma migration files
├── src/
│   ├── app.module.ts               # Root NestJS module — all imports
│   ├── main.ts                     # Bootstrap: Swagger, Helmet, CORS, prefix
│   ├── common/
│   │   ├── decorators/             # @Public(), @CurrentUser(), @Roles(), @TenantId()
│   │   ├── exceptions/             # BusinessException (with messageKey)
│   │   ├── filters/                # GlobalExceptionFilter
│   │   ├── guards/                 # AuthGuard, TenantGuard, RolesGuard
│   │   ├── interceptors/           # AuditInterceptor
│   │   ├── interfaces/             # JwtPayload, AuthenticatedRequest
│   │   ├── pipes/                  # ZodValidationPipe
│   │   └── utils/
│   │       ├── encryption.util.ts  # AES-256-GCM encrypt/decrypt
│   │       ├── mask.util.ts        # Mask secrets in API responses
│   │       ├── ssrf.util.ts        # SSRF URL validation (block private IPs)
│   │       └── connector-http.util.ts  # Axios wrapper with retry + SSRF guard
│   ├── config/
│   │   └── env.validation.ts       # Zod schema for all env vars (validated at startup)
│   ├── modules/
│   │   ├── auth/                   # Login, token refresh, JWT verification
│   │   ├── tenants/                # Tenant CRUD + user management
│   │   ├── connectors/             # Connector CRUD + test + toggle
│   │   ├── alerts/                 # Alert search, triage, ingestion
│   │   ├── cases/                  # Case lifecycle management
│   │   ├── dashboards/             # Aggregated KPIs and charts
│   │   ├── hunts/                  # Threat hunting sessions
│   │   ├── intel/                  # MISP events + IOC search/sync
│   │   ├── ai/                     # AWS Bedrock AI analysis
│   │   ├── health/                 # System + connector health checks
│   │   ├── audit-logs/             # Audit log search
│   │   └── users/                  # Profile + preferences (self-service)
│   └── prisma/
│       ├── prisma.module.ts        # PrismaModule (global singleton)
│       └── prisma.service.ts       # PrismaClient wrapper
├── .env.example
├── docker-compose.yml
├── docker-compose.dev.yml
├── tsconfig.json
├── tsconfig.build.json
└── package.json
```

---

## Database Schema

### Enums

| Enum                | Values                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| `UserRole`          | `GLOBAL_ADMIN`, `TENANT_ADMIN`, `SOC_ANALYST_L2`, `SOC_ANALYST_L1`, `THREAT_HUNTER`, `EXECUTIVE_READONLY` |
| `UserStatus`        | `active`, `inactive`, `suspended`                                                                         |
| `ConnectorType`     | `wazuh`, `graylog`, `velociraptor`, `grafana`, `influxdb`, `misp`, `shuffle`, `bedrock`                   |
| `AuthType`          | `basic`, `api_key`, `token`, `iam`                                                                        |
| `CaseStatus`        | `open`, `in_progress`, `closed`                                                                           |
| `CaseSeverity`      | `critical`, `high`, `medium`, `low`                                                                       |
| `AlertSeverity`     | `critical`, `high`, `medium`, `low`, `info`                                                               |
| `AlertStatus`       | `new_alert`, `acknowledged`, `in_progress`, `resolved`, `closed`, `false_positive`                        |
| `HuntSessionStatus` | `running`, `completed`, `error`                                                                           |

### Models

#### `Tenant`

Multi-tenant container. All data is scoped to a tenant.

```
id          UUID (PK)
name        String
slug        String (unique) — URL-safe identifier (e.g., "aura-finance")
createdAt   DateTime
updatedAt   DateTime
```

Relations: → `TenantUser[]`, `ConnectorConfig[]`, `Case[]`, `Alert[]`, `AuditLog[]`, `AiAuditLog[]`, `IntelIOC[]`, `IntelMispEvent[]`, `HuntSession[]`, `SavedQuery[]`

#### `TenantUser`

User within a tenant. Can only belong to one tenant.

```
id            UUID (PK)
tenantId      UUID → Tenant
oidcSub       String?    — Entra ID subject (for SSO users)
email         String
name          String
role          UserRole
status        UserStatus (default: active)
passwordHash  String?    — bcrypt hash (for email/password users)
lastLoginAt   DateTime?
mfaEnabled    Boolean (default: false)
isProtected   Boolean (default: false) — cannot be deleted/blocked
createdAt     DateTime
updatedAt     DateTime
```

Unique constraints: `(tenantId, oidcSub)`, `(tenantId, email)`
Relation: → `UserPreference?`

#### `UserPreference`

Per-user UI preferences.

```
id                    UUID (PK)
userId                UUID (unique → TenantUser)
theme                 String (default: "system")
language              String (default: "en")
notificationsEmail    Boolean (default: true)
notificationsInApp    Boolean (default: true)
createdAt, updatedAt  DateTime
```

#### `ConnectorConfig`

Integration configuration — secrets encrypted at rest.

```
id              UUID (PK)
tenantId        UUID → Tenant
type            ConnectorType
name            String
enabled         Boolean (default: false)
authType        AuthType
encryptedConfig String — AES-256-GCM encrypted JSON
lastTestAt      DateTime?
lastTestOk      Boolean?
lastError       String?
createdAt       DateTime
updatedAt       DateTime
```

Unique constraint: `(tenantId, type)` — one connector per type per tenant

#### `Alert`

Security alerts ingested from connectors (Wazuh, Graylog, Velociraptor).

```
id                UUID (PK)
tenantId          UUID → Tenant
externalId        String? — original ID from source system
title             String
description       String?
severity          AlertSeverity
status            AlertStatus (default: new_alert)
source            String — "wazuh" | "graylog" | "velociraptor"
ruleName          String?
ruleId            String?
agentName         String?
sourceIp          String?
destinationIp     String?
mitreTactics      String[]
mitreTechniques   String[]
rawEvent          Json?    — full raw event for investigation
acknowledgedBy    String?
acknowledgedAt    DateTime?
resolution        String?
closedAt          DateTime?
closedBy          String?
timestamp         DateTime — when the event occurred
createdAt         DateTime
```

Indexes: `(tenantId, severity)`, `(tenantId, status)`, `(tenantId, timestamp)`, `(tenantId, source)`

#### `Case`

Security investigation case with lifecycle tracking.

```
id            UUID (PK)
tenantId      UUID → Tenant
caseNumber    String (unique) — format: "SOC-YYYY-NNN"
title         String
description   String?
severity      CaseSeverity
status        CaseStatus (default: open)
ownerUserId   String?
createdBy     String — email of creator
linkedAlerts  String[] — alert IDs
closedAt      DateTime?
createdAt     DateTime
updatedAt     DateTime
```

Relations: → `CaseNote[]`, `CaseTimeline[]`

#### `CaseNote`

Free-text comments on a case.

```
id, caseId → Case, author, body, createdAt
```

#### `CaseTimeline`

Audit trail of all actions on a case.

```
id, caseId → Case, type, actor, description, timestamp
```

#### `IntelIOC`

Indicators of compromise from MISP or manual entry.

```
id, tenantId, iocValue, iocType, source, severity, hitCount,
firstSeen, lastSeen, tags String[], active Boolean
```

Unique: `(tenantId, iocValue, iocType)`

#### `IntelMispEvent`

MISP threat intelligence events (cached from MISP API).

```
id, tenantId, mispEventId, organization, threatLevel, info, date,
tags Json, attributeCount, published Boolean
```

Unique: `(tenantId, mispEventId)`

#### `HuntSession`

Threat hunting session started by an analyst.

```
id, tenantId, query, status: HuntSessionStatus, startedAt, completedAt?,
startedBy, eventsFound Int, reasoning String[]
```

Relation: → `HuntEvent[]`

#### `HuntEvent`

Individual event found during a hunt session.

```
id, huntSessionId → HuntSession, timestamp, severity, eventId, sourceIp, user, description
```

#### `AuditLog`

Immutable record of all mutations (created by `AuditInterceptor`).

```
id, tenantId, actor (email), role, action, resource, resourceId, details, ipAddress, createdAt
```

Indexes: `(tenantId)`, `(tenantId, createdAt)`

#### `AiAuditLog`

AWS Bedrock AI request tracking with token usage.

```
id, tenantId, actor, action, model, inputTokens, outputTokens, prompt, response, durationMs
```

#### `SavedQuery`

Reusable threat hunting queries saved by analysts.

```
id, tenantId, name, query, description, createdBy, createdAt, updatedAt
```

---

## Authentication & Authorization

### Email/Password Authentication

```
POST /auth/login
  Body: { email, password }
  Response: { accessToken (15m), refreshToken (7d), user: JwtPayload }
```

1. `AuthService.login()` finds user by email + tenantId
2. Verifies `bcrypt.compare(password, passwordHash)`
3. Checks `status === 'active'` — blocked/inactive users get 401
4. Updates `lastLoginAt` timestamp
5. Signs tokens with `JWT_SECRET` (HS256)

### JWT Payload

```typescript
interface JwtPayload {
  sub: string // TenantUser.id
  email: string
  tenantId: string // UUID (not slug)
  tenantSlug: string
  role: UserRole
  iat?: number
  exp?: number
}
```

### Token Refresh

```
POST /auth/refresh
  Body: { refreshToken }
  Response: { accessToken, refreshToken }
```

Verifies refresh token, checks user still active, issues new token pair.

### Development Mode Bypass

In `NODE_ENV=development`, if no `Authorization` header is present, the `AuthGuard` injects a mock user using:

- `X-Tenant-Id` header → `tenantId`
- `X-Role` header → `role` (defaults to `GLOBAL_ADMIN`)

This allows API testing without a valid JWT during local development.

### OIDC / Microsoft Entra ID (optional)

When `OIDC_JWKS_URI` is configured, the `AuthGuard` also validates RS256 tokens from Entra ID via JWKS. The OIDC subject (`sub`) is matched to `TenantUser.oidcSub`.

---

## Guards, Decorators & Pipes

### Guards

**`AuthGuard`** — Applied globally to all routes.

- Extracts `Authorization: Bearer {token}` header
- Verifies token signature and expiry with `JWT_SECRET`
- Calls `validateUserActive()` — re-checks user exists and is `active` in DB on every request
- For GLOBAL_ADMIN: allows `X-Tenant-Id` header to override `tenantId` in request context
- Skips for routes decorated with `@Public()`
- Dev mode: injects mock user if no auth header

**`TenantGuard`** — Applied globally after AuthGuard.

- Ensures `request.user.tenantId` is populated
- Throws `403 Forbidden` if missing (shouldn't happen in practice)

**`RolesGuard`** — Applied globally after TenantGuard.

- Reads `@Roles()` metadata from the route handler
- Checks user's role position in `ROLE_HIERARCHY` array against required minimum role
- Higher index = lower permissions; user must have equal or lower index than required
- Throws `403 Forbidden` if insufficient permissions

### Decorators

| Decorator               | Usage                                 | Description                           |
| ----------------------- | ------------------------------------- | ------------------------------------- |
| `@Public()`             | `@Public() @Get('health')`            | Bypasses AuthGuard + TenantGuard      |
| `@Roles(...roles)`      | `@Roles(UserRole.TENANT_ADMIN)`       | Sets minimum required role            |
| `@CurrentUser()`        | `@CurrentUser() user: JwtPayload`     | Injects full JWT payload from request |
| `@CurrentUser('email')` | `@CurrentUser('email') email: string` | Injects single field from JWT payload |
| `@TenantId()`           | `@TenantId() tenantId: string`        | Shorthand for `request.user.tenantId` |

### Pipes

**`ZodValidationPipe`** — Validates request body/query against a Zod schema.

```typescript
@Post()
async create(@Body(new ZodValidationPipe(CreateCaseSchema)) dto: CreateCaseDto) { ... }
```

On validation failure, returns 400 with field-level i18n messageKeys:
`errors.validation.{fieldName}.{reason}` where reason is one of: `required`, `invalid`, `tooShort`, `tooLong`, `invalidEmail`, `invalidUuid`, `invalidFormat`, `invalidOption`.

---

## API Modules & Endpoints

Base path: `/api/v1`

### Auth Module (`/auth`)

| Method | Path            | Description                      | Auth   |
| ------ | --------------- | -------------------------------- | ------ |
| `POST` | `/auth/login`   | Email + password → tokens + user | Public |
| `GET`  | `/auth/me`      | Get current authenticated user   | Any    |
| `POST` | `/auth/refresh` | Refresh token → new token pair   | Any    |
| `POST` | `/auth/logout`  | Invalidate tokens                | Any    |

### Tenants Module (`/tenants`)

| Method   | Path                                       | Description                                  | Min Role     |
| -------- | ------------------------------------------ | -------------------------------------------- | ------------ |
| `GET`    | `/tenants`                                 | List all tenants                             | GLOBAL_ADMIN |
| `POST`   | `/tenants`                                 | Create new tenant                            | GLOBAL_ADMIN |
| `GET`    | `/tenants/current`                         | Get current tenant info                      | Any          |
| `PATCH`  | `/tenants/:id`                             | Update tenant name                           | GLOBAL_ADMIN |
| `DELETE` | `/tenants/:id`                             | Delete tenant                                | GLOBAL_ADMIN |
| `GET`    | `/tenants/:id/users`                       | List users (sortBy, sortOrder, role, status) | TENANT_ADMIN |
| `POST`   | `/tenants/:id/users`                       | Add user to tenant                           | TENANT_ADMIN |
| `PATCH`  | `/tenants/:tenantId/users/:userId`         | Update user role/name                        | TENANT_ADMIN |
| `DELETE` | `/tenants/:tenantId/users/:userId`         | Soft-delete user                             | TENANT_ADMIN |
| `POST`   | `/tenants/:tenantId/users/:userId/block`   | Suspend user                                 | TENANT_ADMIN |
| `POST`   | `/tenants/:tenantId/users/:userId/unblock` | Unsuspend user                               | TENANT_ADMIN |
| `POST`   | `/tenants/:tenantId/users/:userId/restore` | Restore deleted user                         | TENANT_ADMIN |
| `PATCH`  | `/tenants/:tenantId/users/:userId/role`    | Change user role                             | TENANT_ADMIN |

### Connectors Module (`/connectors`)

| Method   | Path                       | Description                          | Min Role       |
| -------- | -------------------------- | ------------------------------------ | -------------- |
| `GET`    | `/connectors`              | List all connectors (secrets masked) | Any            |
| `POST`   | `/connectors`              | Create new connector                 | TENANT_ADMIN   |
| `GET`    | `/connectors/:type`        | Get connector by type                | Any            |
| `PATCH`  | `/connectors/:type`        | Update connector config              | SOC_ANALYST_L2 |
| `DELETE` | `/connectors/:type`        | Delete connector                     | TENANT_ADMIN   |
| `POST`   | `/connectors/:type/test`   | Test connection + measure latency    | SOC_ANALYST_L2 |
| `POST`   | `/connectors/:type/toggle` | Enable/disable connector             | SOC_ANALYST_L2 |

**Config Encryption**: `encryptedConfig` is stored as AES-256-GCM ciphertext. When returned to clients, secrets are masked with `***` via `maskSecrets()` utility.

### Alerts Module (`/alerts`)

| Method | Path                      | Description                                   | Min Role       |
| ------ | ------------------------- | --------------------------------------------- | -------------- |
| `GET`  | `/alerts`                 | Search alerts (paginated)                     | Any            |
| `GET`  | `/alerts/:id`             | Get alert detail                              | Any            |
| `POST` | `/alerts/:id/acknowledge` | Acknowledge alert                             | SOC_ANALYST_L1 |
| `POST` | `/alerts/:id/investigate` | Mark as in-progress + add investigation notes | SOC_ANALYST_L2 |
| `POST` | `/alerts/:id/close`       | Close alert with resolution                   | SOC_ANALYST_L1 |
| `POST` | `/alerts/ingest/wazuh`    | Ingest alerts from Wazuh Indexer              | TENANT_ADMIN   |

**Search Query Parameters**:
| Parameter | Type | Description |
| --------- | ---- | ----------- |
| `query` | string | Full-text search on title + description + agentName |
| `severity` | string | Comma-separated severities: `critical,high,medium,low,info` |
| `status` | string | Alert status: `new_alert`, `acknowledged`, `in_progress`, etc. |
| `source` | string | Source connector: `wazuh`, `graylog`, `velociraptor` |
| `agentName` | string | Filter by agent hostname |
| `ruleGroup` | string | Filter by rule name prefix |
| `timeRange` | string | `24h`, `7d`, `30d` — filters by `timestamp` field |
| `from` | ISO datetime | Custom start datetime filter |
| `to` | ISO datetime | Custom end datetime filter |
| `sortBy` | string | `timestamp`, `severity`, `status`, `title`, `agentName` |
| `sortOrder` | string | `asc` or `desc` |
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page (default: 20, max: 100) |

### Cases Module (`/cases`)

| Method   | Path                    | Description                                  | Min Role       |
| -------- | ----------------------- | -------------------------------------------- | -------------- |
| `GET`    | `/cases`                | List cases (paginated, filterable, sortable) | Any            |
| `POST`   | `/cases`                | Create case (auto-generates caseNumber)      | SOC_ANALYST_L1 |
| `GET`    | `/cases/:id`            | Get case with notes + timeline               | Any            |
| `PATCH`  | `/cases/:id`            | Update case fields + add timeline entry      | SOC_ANALYST_L1 |
| `DELETE` | `/cases/:id`            | Delete case                                  | TENANT_ADMIN   |
| `POST`   | `/cases/:id/link-alert` | Link alert to case + timeline entry          | SOC_ANALYST_L1 |
| `GET`    | `/cases/:id/notes`      | Get case notes                               | Any            |
| `POST`   | `/cases/:id/notes`      | Add note to case + timeline entry            | SOC_ANALYST_L1 |

**Case Number Format**: `SOC-YYYY-NNN` (e.g., `SOC-2024-001`). Auto-incremented per tenant per year.

**Search Query Parameters**:
| Parameter | Description |
| --------- | ----------- |
| `query` | Full-text search on title, caseNumber, description |
| `status` | `open`, `in_progress`, `closed` |
| `severity` | `critical`, `high`, `medium`, `low` |
| `sortBy` | `createdAt`, `updatedAt`, `severity`, `status`, `caseNumber`, `title` |
| `sortOrder` | `asc` or `desc` |
| `page`, `limit` | Pagination |

### Dashboards Module (`/dashboards`)

| Method | Path                                | Description                                            | Auth |
| ------ | ----------------------------------- | ------------------------------------------------------ | ---- |
| `GET`  | `/dashboards/summary`               | KPI totals: alert counts by severity, open cases, MTTR | Any  |
| `GET`  | `/dashboards/alert-trend`           | Alert counts grouped by date (timeRange: 24h/7d/30d)   | Any  |
| `GET`  | `/dashboards/severity-distribution` | Alert count per severity level                         | Any  |
| `GET`  | `/dashboards/mitre-top-techniques`  | Top MITRE ATT&CK techniques with counts                | Any  |
| `GET`  | `/dashboards/top-targeted-assets`   | Most targeted agent hostnames                          | Any  |
| `GET`  | `/dashboards/pipeline-health`       | Enabled connector status + latency                     | Any  |

### Hunts Module (`/hunts`)

| Method | Path                     | Description                          | Min Role      |
| ------ | ------------------------ | ------------------------------------ | ------------- |
| `POST` | `/hunts/run`             | Start a new threat hunt session      | THREAT_HUNTER |
| `GET`  | `/hunts/runs`            | List hunt sessions (paginated)       | Any           |
| `GET`  | `/hunts/runs/:id`        | Get hunt session detail + reasoning  | Any           |
| `GET`  | `/hunts/runs/:id/events` | Get events found in hunt (paginated) | Any           |

**Hunt Payload**: `{ query: string, description?: string }`

The hunt service queries the Wazuh Indexer/OpenSearch connector (if configured) using the natural language query. Results are stored as `HuntEvent` records.

### Threat Intelligence Module (`/ti`)

| Method | Path                    | Description                                                           | Min Role       |
| ------ | ----------------------- | --------------------------------------------------------------------- | -------------- |
| `GET`  | `/ti/events/recent`     | Recent MISP events (page, limit, sortBy, sortOrder)                   | Any            |
| `GET`  | `/ti/iocs/search`       | Search IOC database (q, type, source, page, limit, sortBy, sortOrder) | Any            |
| `POST` | `/ti/iocs/match-alerts` | Cross-reference IOCs against recent alerts                            | SOC_ANALYST_L1 |
| `POST` | `/ti/sync/misp`         | Sync events + attributes from MISP                                    | TENANT_ADMIN   |

### AI Module (`/ai`)

| Method | Path              | Description                            | Requirement               |
| ------ | ----------------- | -------------------------------------- | ------------------------- |
| `POST` | `/ai/hunt`        | AI-assisted threat hunt query          | Bedrock connector enabled |
| `POST` | `/ai/investigate` | AI analysis of an alert                | Bedrock connector enabled |
| `POST` | `/ai/explain`     | Explain a MITRE technique or log event | Bedrock connector enabled |

If no Bedrock connector is configured, returns `400` with `messageKey: errors.ai.notEnabled`.
All AI requests are logged to `AiAuditLog` with model name, token counts, and duration.

### Audit Logs Module (`/audit-logs`)

| Method | Path          | Description                   | Min Role     |
| ------ | ------------- | ----------------------------- | ------------ |
| `GET`  | `/audit-logs` | Search audit logs (paginated) | TENANT_ADMIN |

**Query Parameters**: `actor`, `action`, `resource`, `from` (ISO datetime), `to` (ISO datetime), `sortBy`, `sortOrder`, `page`, `limit`

### Health Module (`/health`)

| Method | Path               | Description                       | Auth   |
| ------ | ------------------ | --------------------------------- | ------ |
| `GET`  | `/health`          | System health: DB + Redis ping    | Public |
| `GET`  | `/health/services` | Per-connector health with latency | Any    |

### Users Module (`/users`)

| Method  | Path                     | Description                            | Auth |
| ------- | ------------------------ | -------------------------------------- | ---- |
| `GET`   | `/users/profile`         | Get own full profile                   | Any  |
| `PATCH` | `/users/profile`         | Update own name                        | Any  |
| `POST`  | `/users/change-password` | Change password (verify current first) | Any  |
| `GET`   | `/users/preferences`     | Get UI preferences                     | Any  |
| `PATCH` | `/users/preferences`     | Upsert UI preferences                  | Any  |

---

## Connector Integrations

Each connector type has a dedicated service class that wraps real HTTP/gRPC calls. Connector credentials are fetched from `ConnectorConfig.encryptedConfig` (decrypted at runtime), so credentials never appear in env vars per tenant.

### Wazuh Manager

- `testConnection(config)` → `POST {url}/security/user/authenticate` (basic auth)
- `getAgents(config)` → `GET {url}/agents?status=active`
- Token caching: JWT tokens cached for 10 minutes (like CoPilot pattern)

### Wazuh Indexer / OpenSearch

- `testConnection(config)` → `GET {url}/_cluster/health` (basic auth)
- `search(config, index, dsl)` → `POST {url}/{index}/_search` (Elasticsearch DSL)
- Alert ingestion: queries `wazuh-alerts-*` index with time-range DSL, upserts into `Alert` table

### Graylog

- `testConnection(config)` → `GET {url}/api/system/cluster/nodes` (basic auth + `X-Requested-By: AuraSpear`)
- `searchEvents(config, filter)` → `POST {url}/api/events/search`
- `getEventDefinitions(config)` → `GET {url}/api/events/definitions`

### Velociraptor

- `testConnection(config)` → gRPC connection test with client cert from config
- `runVQL(config, vql)` → execute VQL query via gRPC stub

### Grafana

- `testConnection(config)` → `GET {url}/api/health` with API key header
- `getDashboards(config)` → `GET {url}/api/search?type=dash-db`

### InfluxDB

- `testConnection(config)` → `GET {url}/ping` with bearer token
- `query(config, flux)` → `POST {url}/api/v2/query` (Flux query body)

### MISP

- `testConnection(config)` → `GET {url}/servers/getPyMISPVersion.json` with `Authorization: {authKey}`
- `getEvents(config, limit)` → `GET {url}/events?limit=N&sort=date&direction=desc`
- `searchAttributes(config, query)` → `POST {url}/attributes/restSearch`

### Shuffle

- `testConnection(config)` → `GET {url}/api/v1/apps/authentication` with bearer token
- `getWorkflows(config)` → `GET {url}/api/v1/workflows`
- `executeWorkflow(config, workflowId, data)` → `POST {url}/api/v1/workflows/{id}/execute`

### AWS Bedrock

- `testConnection(config)` → `ListFoundationModels` API call
- `invoke(config, prompt)` → `InvokeModel` with `anthropic.claude-3-*` model
- Uses `@aws-sdk/client-bedrock-runtime`

**SSRF Protection**: All connector URLs pass through `validateUrl()` in `ssrf.util.ts` which blocks private IP ranges (10.x, 172.16-31.x, 192.168.x, 127.x, ::1) and `localhost` — preventing attackers from pointing connectors at internal services.

---

## Multi-Tenancy

All data in the database is tenant-scoped. Tenant isolation is enforced at multiple layers:

1. **JWT payload** contains `tenantId` (UUID) — set at login, cannot be changed by the user
2. **`TenantGuard`** ensures every authenticated request has a non-null `tenantId`
3. **All service methods** receive `tenantId` as first parameter and include it in every Prisma query: `where: { tenantId, id }`
4. **`ConnectorConfig` unique constraint** `(tenantId, type)` prevents cross-tenant connector sharing
5. **GLOBAL_ADMIN tenant switching**: The `AuthGuard` checks if `request.user.role === 'GLOBAL_ADMIN'`. If `X-Tenant-Id` header is present and the tenant exists, it overrides `request.user.tenantId`. This allows GLOBAL_ADMIN to view and manage any tenant's data while regular users are locked to their own tenant.

---

## Security

### Encryption

Connector secrets (passwords, API keys, tokens) are encrypted with **AES-256-GCM** before storage.

Format stored in DB: `base64(IV):base64(authTag):base64(ciphertext)`

- IV: 16 random bytes (generated per encryption — never reused)
- Auth Tag: 16 bytes AEAD integrity check
- Key: `CONFIG_ENCRYPTION_KEY` env var (32 bytes / 64 hex chars)

When returning connectors to clients, the `maskSecrets()` utility replaces all sensitive field values with `***` so secrets never leave the server.

### Rate Limiting

Global `ThrottlerGuard`: 100 requests per 60 seconds per IP. Individual endpoints can override with `@Throttle(limit, ttl)`.

### Security Headers

`helmet()` middleware in `main.ts` sets `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, etc.

### SSRF Protection

`ssrf.util.ts` validates all user-supplied URLs before making HTTP requests. Blocks:

- `localhost`, `127.0.0.1`, `::1`
- Private IPv4: `10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`
- Link-local: `169.254.x.x`

### Audit Trail

`AuditInterceptor` logs every `POST`, `PUT`, `PATCH`, `DELETE` request asynchronously:

```json
{
  "tenantId": "uuid",
  "actor": "user@example.com",
  "role": "TENANT_ADMIN",
  "action": "PATCH /connectors/wazuh",
  "resource": "ConnectorsController",
  "resourceId": "wazuh",
  "ipAddress": "1.2.3.4",
  "createdAt": "2024-03-02T..."
}
```

Request headers (`Authorization`, `Cookie`) are redacted from pino logs.

### Threat Model

| Threat                    | Mitigation                                                      |
| ------------------------- | --------------------------------------------------------------- |
| Cross-tenant data leakage | TenantGuard + `tenantId` in every Prisma query                  |
| SSRF via connector URLs   | `ssrf.util.ts` blocks private IPs                               |
| Secret exposure in logs   | pino redact config + `maskSecrets()`                            |
| Privilege escalation      | Role hierarchy array — position-based comparison                |
| SQL injection             | Prisma parameterized queries (no raw SQL)                       |
| JWT forgery               | JWKS-based RS256 verification (OIDC) + HS256 with strong secret |
| Brute-force login         | ThrottlerGuard (100 req/60s) + bcrypt (10 rounds)               |
| Replay attacks            | Short access token TTL (15 min) + refresh token rotation        |

---

## Error Handling

All errors pass through `GlobalExceptionFilter` which returns a consistent JSON structure:

```json
{
  "statusCode": 400,
  "message": "Human-readable error description",
  "messageKey": "errors.validation.email.invalidEmail",
  "error": "Bad Request",
  "timestamp": "2024-03-02T12:34:56.789Z",
  "path": "/api/v1/users",
  "errors": ["errors.validation.email.invalidEmail", "errors.validation.name.required"]
}
```

The `messageKey` field uses the pattern `errors.<module>.<errorName>` and directly maps to i18n keys in the frontend translation files.

**`BusinessException`** — Custom exception used throughout services:

```typescript
throw new BusinessException('User not found', 'errors.users.notFound', 404)
```

**Common HTTP Codes**:

- `400` — Validation failed (ZodValidationPipe)
- `401` — Invalid/expired token, user inactive/blocked
- `403` — Insufficient role, missing tenant context, protected user action
- `404` — Resource not found
- `409` — Conflict (duplicate connector type)
- `429` — Rate limit exceeded
- `500` — Internal server error (unexpected)
- `503` — Service unavailable (health check fails)

---

## Pagination

All list endpoints use a consistent pagination contract.

**Input** (ZodValidationPipe on query params):

```typescript
{
  page: number // default: 1, min: 1
  limit: number // default: 20, min: 1, max: 100
}
```

**Output**:

```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8,
    "hasNext": true,
    "hasPrev": false
  }
}
```

Helper: `buildPaginationMeta(page, limit, total)` returns the pagination object. Used by every service that returns lists.

---

## Audit Logging

`AuditInterceptor` is a global `NestInterceptor` that fires on all mutation HTTP methods.

**What is logged**:

- `tenantId` — from `request.user.tenantId`
- `actor` — user email from `request.user.email`
- `role` — user role from `request.user.role`
- `action` — `${method} ${url}` (e.g., `PATCH /connectors/wazuh`)
- `resource` — controller class name
- `resourceId` — extracted from URL params
- `ipAddress` — from `X-Forwarded-For` or `request.ip`
- `createdAt` — server timestamp

**What is NOT logged**: GET requests (read-only operations don't affect the audit trail).

Writes are asynchronous and non-blocking — audit failures don't affect the request response.

---

## Role Hierarchy

```
GLOBAL_ADMIN       (index 0 — highest)
  └─► TENANT_ADMIN
        └─► SOC_ANALYST_L2
              └─► THREAT_HUNTER
                    └─► SOC_ANALYST_L1
                          └─► EXECUTIVE_READONLY  (index 5 — lowest)
```

`RolesGuard` compares role array indices. `@Roles(UserRole.TENANT_ADMIN)` allows GLOBAL_ADMIN and TENANT_ADMIN (indices 0 and 1), but not SOC_ANALYST_L2 (index 2) and below.

**Role Capabilities**:

| Capability               | GLOBAL | TENANT | L2  | HUNTER | L1  | EXEC |
| ------------------------ | :----: | :----: | :-: | :----: | :-: | :--: |
| Manage all tenants       |   ✓    |        |     |        |     |      |
| Manage tenant users      |   ✓    |   ✓    |     |        |     |      |
| View audit logs          |   ✓    |   ✓    |     |        |     |      |
| Configure connectors     |   ✓    |   ✓    |     |        |     |      |
| Update connectors / test |   ✓    |   ✓    |  ✓  |        |     |      |
| Run threat hunts         |   ✓    |   ✓    |  ✓  |   ✓    |     |      |
| Use AI features          |   ✓    |   ✓    |  ✓  |        |     |      |
| Create/update cases      |   ✓    |   ✓    |  ✓  |        |  ✓  |      |
| Acknowledge/close alerts |   ✓    |   ✓    |  ✓  |        |  ✓  |      |
| View all data            |   ✓    |   ✓    |  ✓  |   ✓    |  ✓  |  ✓   |

---

## Seed Data

`prisma/seed.ts` populates the database with realistic test data for development and testing.

### Tenants

Three test tenants:

- `aura-finance` — financial services
- `aura-health` — healthcare
- `aura-enterprise` — enterprise

### Users (per tenant)

One user per role: GLOBAL_ADMIN (protected), TENANT_ADMIN, SOC_ANALYST_L2, SOC_ANALYST_L1, THREAT_HUNTER, EXECUTIVE_READONLY.

**Default password for all test users**: `Admin@123`

Example users for `aura-finance`:

- `global-admin@auraspear.io` / `Admin@123` — GLOBAL_ADMIN (protected)
- `tenant-admin-test@aura-finance.io` / `Admin@123` — TENANT_ADMIN
- `soc-l2-test@aura-finance.io` / `Admin@123` — SOC_ANALYST_L2

### Alert Templates

15 realistic alert templates including:

- Brute force SSH login attempts
- Suspicious PowerShell execution
- DNS data exfiltration
- Privilege escalation via sudo
- RDP lateral movement
- C2 beacon communication
- SQL injection attempt
- Unauthorized file access
- Process spawning chain
- Port scan detection
- Credential dumping (Mimikatz)
- Malware detection
- Registry modification
- Service creation
- Scheduled task persistence

Alerts span 30 days with varied severities (critical/high/medium/low), statuses, and MITRE techniques.

### Cases (per tenant)

5 investigation cases with notes and timeline entries.

### Hunt Sessions (per tenant)

2-3 completed hunt sessions with events.

### Threat Intelligence (per tenant)

- 10 MISP events from various threat actors
- 15 IOCs (IPs, domains, file hashes, URLs)

---

## Docker Infrastructure

### `docker-compose.yml` (production)

```
postgres:16-alpine
  ├── Port: 5432
  ├── Volume: pgdata (persistent)
  └── Healthcheck: pg_isready

redis:7-alpine
  ├── Port: 6379
  └── Healthcheck: redis-cli ping

pgadmin:latest
  ├── Port: 5050 (web UI)
  └── Depends on: postgres (healthy)
```

### Commands

```bash
npm run docker:up    # Start all services (detached)
npm run docker:down  # Stop and remove containers
npm run docker:dev   # Start with dev overrides (docker-compose.dev.yml)
```

### Volumes

- `pgdata` — PostgreSQL data (survives container restarts)
- `pgadmin_data` — PgAdmin configuration and saved connections

---

## NPM Scripts

| Script                        | Description                                           |
| ----------------------------- | ----------------------------------------------------- |
| `npm run build`               | Compile TypeScript to `dist/`                         |
| `npm start`                   | Run migrations + seed + start production server       |
| `npm run start:dev`           | Start in watch mode with hot reload                   |
| `npm run start:debug`         | Start in debug mode with watch                        |
| `npm run start:prod`          | Start compiled production build                       |
| `npm run lint`                | Run ESLint                                            |
| `npm run lint:strict`         | Run ESLint — zero warnings                            |
| `npm run lint:fix`            | Auto-fix lint issues                                  |
| `npm run format`              | Format with Prettier                                  |
| `npm run format:check`        | Check formatting                                      |
| `npm run typecheck`           | TypeScript strict check                               |
| `npm run typecheck:watch`     | TypeScript in watch mode                              |
| `npm run validate`            | Full pipeline: typecheck + lint:strict + format:check |
| `npm run validate:fix`        | Auto-fix: lint:fix + format                           |
| `npm run test`                | Run Jest unit tests                                   |
| `npm run test:watch`          | Jest in watch mode                                    |
| `npm run test:cov`            | Jest with coverage report                             |
| `npm run prisma:generate`     | Regenerate Prisma client types                        |
| `npm run prisma:migrate`      | Run pending migrations (dev)                          |
| `npm run prisma:migrate:prod` | Run migrations (production — no dev prompts)          |
| `npm run prisma:seed`         | Run seed script                                       |
| `npm run prisma:studio`       | Open Prisma Studio (localhost:5555)                   |

---

## Code Quality

### TypeScript Strict Mode

All strict flags enabled. Key additions beyond `strict: true`:

- `noUncheckedIndexedAccess` — array/object index access returns `T | undefined`
- `noImplicitOverride` — subclass methods must use `override`
- `useUnknownInCatchVariables` — catch blocks use `unknown` instead of `any`

### ESLint

Same strict config as the frontend. Key enforced rules:

- `no-explicit-any: error` — no `any` anywhere
- `no-non-null-assertion: error` — no `!` operator
- `eqeqeq: error` — always `===`/`!==`
- `no-console: warn` — only `console.warn`/`console.error`
- All `eslint-plugin-security` rules — SSRF, injection, ReDoS

### Prettier

Same config as frontend: no semicolons, single quotes, 100 char width, trailing comma ES5.

### Environment Validation

On application startup, `env.validation.ts` validates all env vars against a Zod schema. If any required variable is missing or invalid (e.g., `JWT_SECRET` is too short, `DATABASE_URL` is missing), the app fails to start with a clear, detailed error message listing exactly what's wrong.

---

## License

UNLICENSED — Proprietary. All rights reserved.
