# AuraSpear SOC — Backend Installation Guide

## Table of Contents

1. [System Requirements](#1-system-requirements)
2. [Quick Start](#2-quick-start)
3. [Step-by-Step Installation](#3-step-by-step-installation)
4. [Environment Variables](#4-environment-variables)
5. [Docker Services](#5-docker-services)
6. [Database Setup](#6-database-setup)
7. [Seed Data Reference](#7-seed-data-reference)
8. [NPM Scripts Reference](#8-npm-scripts-reference)
9. [API Overview](#9-api-overview)
10. [Health Verification](#10-health-verification)
11. [Code Quality Tools](#11-code-quality-tools)
12. [Project Structure](#12-project-structure)
13. [Windows-Specific Notes](#13-windows-specific-notes)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. System Requirements

| Requirement        | Version | Notes                        |
| ------------------ | ------- | ---------------------------- |
| **Node.js**        | >= 22   | LTS recommended              |
| **npm**            | >= 9    | Comes with Node.js           |
| **Docker**         | >= 24   | For PostgreSQL + Redis       |
| **Docker Compose** | >= 2.20 | Included with Docker Desktop |
| **Git**            | Any     | For cloning                  |

**Infrastructure services (via Docker):**

| Service            | Version   | Port |
| ------------------ | --------- | ---- |
| PostgreSQL         | 16 Alpine | 5432 |
| Redis              | 7 Alpine  | 6379 |
| PgAdmin (optional) | latest    | 5050 |

> **Note:** PostgreSQL and Redis are run as Docker containers. You do not need to install them locally.

---

## 2. Quick Start

```bash
# 1. Clone and install
git clone <repository-url>
cd auraspear-backend
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — set JWT_SECRET and CONFIG_ENCRYPTION_KEY (see Section 4)

# 3. Start Docker infrastructure
npm run docker:dev

# 4. Start the dev server (auto-runs migrations and seed)
npm run start:dev

# API is now live at http://localhost:4000/api/v1
# Swagger docs at  http://localhost:4000/api/docs
```

---

## 3. Step-by-Step Installation

### Step 1 — Clone the Repository

```bash
git clone <repository-url>
cd auraspear-backend
```

### Step 2 — Install Node.js Dependencies

```bash
npm install
```

This also runs `prisma generate` automatically via the `postinstall` script, generating the Prisma client types from `prisma/schema.prisma`.

### Step 3 — Generate Secrets

Generate cryptographically secure values for the two required secrets:

```bash
# JWT signing secret (minimum 32 bytes → 64 hex chars)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# AES-256-GCM encryption key for connector credentials (exactly 32 bytes → 64 hex chars)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy each output value into `.env` as `JWT_SECRET` and `CONFIG_ENCRYPTION_KEY` respectively.

### Step 4 — Configure Environment Variables

```bash
cp .env.example .env
```

Open `.env` and fill in at minimum:

- `JWT_SECRET` — generated in Step 3
- `CONFIG_ENCRYPTION_KEY` — generated in Step 3
- `DATABASE_URL` — PostgreSQL connection string (see Section 4)

See [Section 4](#4-environment-variables) for the complete variable reference.

### Step 5 — Start Docker Infrastructure

```bash
npm run docker:dev
```

This starts PostgreSQL (port 5432), Redis (port 6379), and PgAdmin (port 5050) in the background. Wait for health checks to pass (about 10–15 seconds):

```bash
docker-compose ps
# Both postgres and redis should show status "healthy"
```

### Step 6 — Start the Development Server

```bash
npm run start:dev
```

On first start, the app automatically:

1. Runs all pending Prisma migrations
2. Seeds the database with test data (tenants, users, alerts, cases, connectors, etc.)
3. Starts the NestJS server on port 4000

### Step 7 — Verify

```bash
curl http://localhost:4000/health
# Expected: {"status":"ok","database":"connected","redis":"connected","timestamp":"..."}
```

Open Swagger UI: **http://localhost:4000/api/docs**

---

## 4. Environment Variables

### Copy Template

```bash
cp .env.example .env
```

### Required Variables

These must be set — the app refuses to start without them (validated by Zod on startup):

| Variable                | Description                                                  | How to generate                                                                                              |
| ----------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `JWT_SECRET`            | HMAC-SHA256 key for signing access and refresh tokens        | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` — must be 64 hex chars (32 bytes) |
| `CONFIG_ENCRYPTION_KEY` | AES-256-GCM key for encrypting connector credentials at rest | Same command as above — must be exactly 64 hex chars                                                         |
| `DATABASE_URL`          | Full PostgreSQL connection string                            | See PostgreSQL section below                                                                                 |

### PostgreSQL Connection

| Variable            | Default              | Description                                                           |
| ------------------- | -------------------- | --------------------------------------------------------------------- |
| `POSTGRES_DB`       | `auraspear_soc`      | Database name                                                         |
| `POSTGRES_USER`     | `auraspear`          | Database user                                                         |
| `POSTGRES_PASSWORD` | `auraspear_secret`   | Database password — **change in production**                          |
| `POSTGRES_HOST`     | `localhost`          | Host for local dev. Use `postgres` when running the app inside Docker |
| `POSTGRES_PORT`     | `5432`               | PostgreSQL port                                                       |
| `DATABASE_URL`      | Assembled from above | Full Prisma connection string                                         |

Example `DATABASE_URL` for local dev (app outside Docker, DB inside Docker):

```
DATABASE_URL="postgresql://auraspear:auraspear_secret@localhost:5432/auraspear_soc?schema=public"
```

Example `DATABASE_URL` for fully Dockerized deployment (app + DB in same network):

```
DATABASE_URL="postgresql://auraspear:auraspear_secret@postgres:5432/auraspear_soc?schema=public"
```

### PgAdmin (Optional Admin UI)

| Variable           | Default              | Description                                   |
| ------------------ | -------------------- | --------------------------------------------- |
| `PGADMIN_EMAIL`    | `admin@auraspear.io` | PgAdmin login email                           |
| `PGADMIN_PASSWORD` | `admin`              | PgAdmin login password — change in production |
| `PGADMIN_PORT`     | `5050`               | Web UI port — http://localhost:5050           |

### Redis

| Variable         | Default     | Description                                        |
| ---------------- | ----------- | -------------------------------------------------- |
| `REDIS_HOST`     | `localhost` | Redis host. Use `redis` when running inside Docker |
| `REDIS_PORT`     | `6379`      | Redis port                                         |
| `REDIS_PASSWORD` | (empty)     | Redis AUTH password — leave empty for local dev    |

### Application Settings

| Variable             | Default                 | Description                                                                                             |
| -------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `PORT`               | `4000`                  | HTTP server port                                                                                        |
| `NODE_ENV`           | `development`           | `development`, `production`, or `test`                                                                  |
| `LOG_LEVEL`          | `info`                  | `fatal`, `error`, `warn`, `info`, `debug`, `trace`                                                      |
| `CORS_ORIGINS`       | `http://localhost:3000` | Allowed CORS origins — comma-separated for multiple: `http://localhost:3000,https://app.yourdomain.com` |
| `JWT_ACCESS_EXPIRY`  | `15m`                   | Access token lifetime (e.g., `15m`, `1h`)                                                               |
| `JWT_REFRESH_EXPIRY` | `7d`                    | Refresh token lifetime (e.g., `7d`, `30d`)                                                              |

### OIDC / Microsoft Entra ID (Optional)

Required only when using Microsoft SSO. Leave empty to use email/password authentication.

| Variable          | Description                             | Example                                                             |
| ----------------- | --------------------------------------- | ------------------------------------------------------------------- |
| `OIDC_ISSUER_URL` | OAuth 2.0 issuer URL                    | `https://login.microsoftonline.com/{tenant-id}/v2.0`                |
| `OIDC_AUDIENCE`   | API audience identifier                 | `api://auraspear-soc`                                               |
| `OIDC_JWKS_URI`   | JWKS endpoint for public key validation | `https://login.microsoftonline.com/{tenant-id}/discovery/v2.0/keys` |
| `OIDC_CLIENT_ID`  | Azure AD application client ID          | `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`                              |

### Connector Defaults (Optional)

Fallback URLs used when a connector is not explicitly configured per-tenant. Per-tenant configuration stored in the database always takes precedence.

| Variable                | Description                       | Example                       |
| ----------------------- | --------------------------------- | ----------------------------- |
| `WAZUH_MANAGER_URL`     | Wazuh Manager REST API            | `https://wazuh-manager:55000` |
| `WAZUH_INDEXER_URL`     | Wazuh Indexer / OpenSearch        | `https://wazuh-indexer:9200`  |
| `GRAYLOG_BASE_URL`      | Graylog SIEM API                  | `http://graylog:9000`         |
| `VELOCIRAPTOR_BASE_URL` | Velociraptor EDR gRPC endpoint    | `https://velociraptor:8003`   |
| `GRAFANA_BASE_URL`      | Grafana metrics API               | `http://grafana:3000`         |
| `INFLUXDB_BASE_URL`     | InfluxDB time-series API          | `http://influxdb:8086`        |
| `MISP_BASE_URL`         | MISP threat intelligence REST API | `https://misp:443`            |
| `SHUFFLE_BASE_URL`      | Shuffle SOAR API                  | `http://shuffle:3001`         |

### AWS Bedrock (Optional — AI features)

Required only when using AI-assisted alert investigation or threat hunting. Leave empty to disable AI features.

| Variable                | Default                                   | Description                         |
| ----------------------- | ----------------------------------------- | ----------------------------------- |
| `AWS_REGION`            | `us-east-1`                               | AWS region where Bedrock is enabled |
| `AWS_ACCESS_KEY_ID`     | (empty)                                   | IAM access key ID                   |
| `AWS_SECRET_ACCESS_KEY` | (empty)                                   | IAM secret access key               |
| `AWS_BEDROCK_MODEL_ID`  | `anthropic.claude-3-sonnet-20240229-v1:0` | Bedrock model to invoke             |

### Complete `.env` Example

```env
# ───────────────────────────────────────────────
# PostgreSQL
# ───────────────────────────────────────────────
POSTGRES_DB=auraspear_soc
POSTGRES_USER=auraspear
POSTGRES_PASSWORD=auraspear_secret
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
DATABASE_URL="postgresql://auraspear:auraspear_secret@localhost:5432/auraspear_soc?schema=public"

# ───────────────────────────────────────────────
# Redis
# ───────────────────────────────────────────────
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# ───────────────────────────────────────────────
# PgAdmin (optional admin UI)
# ───────────────────────────────────────────────
PGADMIN_EMAIL=admin@auraspear.io
PGADMIN_PASSWORD=admin
PGADMIN_PORT=5050

# ───────────────────────────────────────────────
# Application
# ───────────────────────────────────────────────
PORT=4000
NODE_ENV=development
LOG_LEVEL=debug
CORS_ORIGINS=http://localhost:3000

# ───────────────────────────────────────────────
# JWT — REQUIRED (generate with crypto.randomBytes(32).toString('hex'))
# ───────────────────────────────────────────────
JWT_SECRET=REPLACE_WITH_64_HEX_CHARS
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# ───────────────────────────────────────────────
# Encryption — REQUIRED (same generation command)
# ───────────────────────────────────────────────
CONFIG_ENCRYPTION_KEY=REPLACE_WITH_64_HEX_CHARS

# ───────────────────────────────────────────────
# OIDC / Microsoft Entra ID (optional — leave empty for email/password auth)
# ───────────────────────────────────────────────
OIDC_ISSUER_URL=
OIDC_AUDIENCE=
OIDC_JWKS_URI=
OIDC_CLIENT_ID=

# ───────────────────────────────────────────────
# Connector Defaults (optional)
# ───────────────────────────────────────────────
WAZUH_MANAGER_URL=https://wazuh-manager:55000
WAZUH_INDEXER_URL=https://wazuh-indexer:9200
GRAYLOG_BASE_URL=http://graylog:9000
VELOCIRAPTOR_BASE_URL=https://velociraptor:8003
GRAFANA_BASE_URL=http://grafana:3000
INFLUXDB_BASE_URL=http://influxdb:8086
MISP_BASE_URL=https://misp:443
SHUFFLE_BASE_URL=http://shuffle:3001

# ───────────────────────────────────────────────
# AWS Bedrock (optional — leave empty to disable AI)
# ───────────────────────────────────────────────
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_BEDROCK_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0
```

### Validation on Startup

All environment variables are validated by a Zod schema in `src/config/env.validation.ts`. If any required variable is missing or malformed, the app exits immediately with a descriptive error:

```
[EnvValidation] Environment validation failed:
  JWT_SECRET: String must contain at least 32 character(s)
  CONFIG_ENCRYPTION_KEY: Invalid length — must be 64 hex characters
  DATABASE_URL: Invalid url format
```

---

## 5. Docker Services

### Starting Services

```bash
# Start all services in background (recommended for dev)
npm run docker:dev

# Or use standard up
npm run docker:up

# Stop all services
npm run docker:down
```

### Service Reference

| Service      | Image                   | Local Port | Volume         | Health Check                               |
| ------------ | ----------------------- | ---------- | -------------- | ------------------------------------------ |
| **postgres** | `postgres:16-alpine`    | `5432`     | `pgdata`       | `pg_isready -U auraspear -d auraspear_soc` |
| **redis**    | `redis:7-alpine`        | `6379`     | none           | `redis-cli ping`                           |
| **pgadmin**  | `dpage/pgadmin4:latest` | `5050`     | `pgadmin_data` | none                                       |

### Check Service Status

```bash
# View running containers
docker-compose ps

# Stream logs for a specific service
docker-compose logs -f postgres
docker-compose logs -f redis

# Check PostgreSQL is accepting connections
docker-compose exec postgres pg_isready -U auraspear -d auraspear_soc

# Check Redis is responding
docker-compose exec redis redis-cli ping
# → PONG
```

### PgAdmin Database Browser

Open **http://localhost:5050** and log in with:

- Email: `admin@auraspear.io` (or value of `PGADMIN_EMAIL`)
- Password: `admin` (or value of `PGADMIN_PASSWORD`)

Add a new server with:

- Host: `postgres` (service name in Docker network)
- Port: `5432`
- Database: `auraspear_soc`
- Username: `auraspear`
- Password: `auraspear_secret`

### Prisma Studio (Alternative DB Browser)

```bash
npm run prisma:studio
# Opens at http://localhost:5555
# Visual table browser with editing capability
```

---

## 6. Database Setup

### Automatic (recommended)

`npm run start:dev` and `npm start` automatically run migrations and seed before starting the server:

```bash
# These commands are automatically run on server start:
prisma migrate deploy  # Apply pending migrations
prisma db seed         # Insert test data if tables are empty
```

### Manual Migration Commands

```bash
# Apply all pending migrations (production — no prompts)
npm run prisma:migrate:prod

# Apply + create new migration (development — prompts for migration name)
npm run prisma:migrate

# Regenerate Prisma client types (after schema changes)
npm run prisma:generate

# Seed the database manually
npm run prisma:seed
```

### Migration History

| Migration                                      | Description                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| `20260301224907_add_password_auth`             | Password-based authentication fields                             |
| `20260302000000_full_real_backend`             | Full schema (all 15 models)                                      |
| `20260302030353_add_user_status_lastlogin_mfa` | User status tracking, last login timestamp, MFA flag             |
| `20260302121946_add_user_is_protected`         | Protected user flag (prevents deletion/blocking of system users) |

### Database Models

| Model             | Description                                                  |
| ----------------- | ------------------------------------------------------------ |
| `Tenant`          | Top-level multi-tenant container                             |
| `TenantUser`      | User account scoped to a tenant with role                    |
| `UserPreference`  | Per-user UI preferences (theme, language, notifications)     |
| `ConnectorConfig` | Encrypted third-party integration credentials                |
| `Alert`           | Security alerts from Wazuh, Graylog, Velociraptor, etc.      |
| `Case`            | Investigation cases with auto-generated case numbers         |
| `CaseNote`        | Analyst notes attached to cases                              |
| `CaseTimeline`    | Immutable audit trail of case changes                        |
| `IntelIOC`        | Indicators of compromise (IPs, domains, file hashes, emails) |
| `IntelMispEvent`  | MISP threat intelligence events                              |
| `HuntSession`     | Threat hunting session records                               |
| `HuntEvent`       | Individual events found during a hunt                        |
| `AuditLog`        | Immutable record of all mutating API calls                   |
| `AiAuditLog`      | Record of AWS Bedrock AI invocations                         |
| `SavedQuery`      | Reusable hunt queries saved by analysts                      |

---

## 7. Seed Data Reference

The seeder (`prisma/seed.ts`) creates comprehensive test data across all models.

### Default Credentials

**All seeded users share the same password:** `Admin@123`

### Tenants

| Slug              | Display Name    | Industry           |
| ----------------- | --------------- | ------------------ |
| `aura-finance`    | Aura Finance    | Financial services |
| `aura-health`     | Aura Health     | Healthcare         |
| `aura-enterprise` | Aura Enterprise | Enterprise         |

### Users Per Tenant

Multiply the pattern below by each tenant:

| Email                  | Role                 | Notes                                    |
| ---------------------- | -------------------- | ---------------------------------------- |
| `admin@{slug}.io`      | `GLOBAL_ADMIN`       | Protected — cannot be deleted or blocked |
| `analyst.l2@{slug}.io` | `SOC_ANALYST_L2`     | Senior SOC analyst                       |
| `analyst.l1@{slug}.io` | `SOC_ANALYST_L1`     | Junior SOC analyst                       |
| `hunter@{slug}.io`     | `THREAT_HUNTER`      | Threat hunting specialist                |
| `exec@{slug}.io`       | `EXECUTIVE_READONLY` | Read-only executive view                 |

**Example for `aura-finance`:**

```
admin@aura-finance.io         / Admin@123   → GLOBAL_ADMIN
analyst.l2@aura-finance.io    / Admin@123   → SOC_ANALYST_L2
analyst.l1@aura-finance.io    / Admin@123   → SOC_ANALYST_L1
hunter@aura-finance.io        / Admin@123   → THREAT_HUNTER
exec@aura-finance.io          / Admin@123   → EXECUTIVE_READONLY
```

### Alerts (25 per tenant)

12 realistic alert templates spanning 30 days with varied severity, status, MITRE ATT&CK mappings, and source agents:

| Template                        | Severity | MITRE Tactic         |
| ------------------------------- | -------- | -------------------- |
| Brute force SSH login           | high     | Credential Access    |
| Suspicious PowerShell execution | critical | Execution            |
| DNS data exfiltration           | high     | Exfiltration         |
| Privilege escalation via sudo   | critical | Privilege Escalation |
| RDP lateral movement            | high     | Lateral Movement     |
| C2 beacon communication         | critical | Command and Control  |
| SQL injection attack            | high     | Initial Access       |
| Unauthorized file access        | medium   | Collection           |
| Suspicious process spawning     | medium   | Defense Evasion      |
| Port scan detection             | low      | Reconnaissance       |
| Credential dumping              | critical | Credential Access    |
| Malware detection               | high     | Execution            |

Statuses distributed across: `new_alert`, `acknowledged`, `in_progress`, `resolved`, `closed`.

### Cases (8 per tenant)

Each case has linked alerts, timeline entries, and notes:

| Case Title                 | Severity |
| -------------------------- | -------- |
| Ransomware Investigation   | critical |
| Phishing Campaign Response | high     |
| Insider Threat Review      | high     |
| Network Intrusion Analysis | critical |
| Malware Containment        | high     |
| DDoS Mitigation Review     | medium   |
| Credential Leak Response   | high     |
| Vulnerability Exploitation | critical |

### Hunt Sessions (3 per tenant)

Completed sessions with reasoning trail and events:

| Query                   | Events Found |
| ----------------------- | ------------ |
| SSH brute force pattern | 5–20         |
| Suspicious PowerShell   | 5–20         |
| Known Tor exit nodes    | 5–20         |

### Threat Intelligence (per tenant)

| Type                   | Count | Examples                         |
| ---------------------- | ----- | -------------------------------- |
| IOCs (IP addresses)    | 4     | C2 IPs, scanner IPs              |
| IOCs (domains)         | 4     | Phishing domains, C2 domains     |
| IOCs (file hashes MD5) | 3     | Malware hashes                   |
| IOCs (email addresses) | 2     | Phishing senders                 |
| IOCs (CIDR ranges)     | 1     | Malicious network range          |
| IOCs (filenames)       | 1     | Malware filename                 |
| MISP events            | 10    | APT28, LockBit 3.0, Emotet, etc. |

### Connectors (8 per tenant)

Pre-configured with placeholder encrypted credentials:

| Type           | Status   | Auth Method                    |
| -------------- | -------- | ------------------------------ |
| `wazuh`        | enabled  | Basic auth (username/password) |
| `graylog`      | enabled  | Basic auth                     |
| `velociraptor` | disabled | API key                        |
| `grafana`      | enabled  | API key                        |
| `influxdb`     | enabled  | Bearer token                   |
| `misp`         | enabled  | API key header                 |
| `shuffle`      | disabled | API key                        |
| `bedrock`      | enabled  | IAM access key                 |

> Credentials are placeholders. Replace with real values through the Connectors admin UI or directly in the database.

### Role Hierarchy

| Role                 | Level       | Capabilities                                                       |
| -------------------- | ----------- | ------------------------------------------------------------------ |
| `GLOBAL_ADMIN`       | 6 (highest) | Full system access, cross-tenant management, protected system user |
| `TENANT_ADMIN`       | 5           | Full access within own tenant, user management                     |
| `SOC_ANALYST_L2`     | 4           | Close cases, run hunts, manage connectors                          |
| `SOC_ANALYST_L1`     | 3           | Acknowledge/investigate alerts, create cases, add notes            |
| `THREAT_HUNTER`      | 2           | Run threat hunts, read-only on other modules                       |
| `EXECUTIVE_READONLY` | 1           | Dashboard and reporting only                                       |

---

## 8. NPM Scripts Reference

### Development

| Script                | Description                                                      |
| --------------------- | ---------------------------------------------------------------- |
| `npm run start:dev`   | Development server with hot reload (auto-runs migrations + seed) |
| `npm run start:debug` | Debug mode — attach Node.js inspector on `localhost:9229`        |

### Production

| Script               | Description                                    |
| -------------------- | ---------------------------------------------- |
| `npm run build`      | Compile TypeScript to `dist/`                  |
| `npm start`          | Run compiled app (auto-runs migrations + seed) |
| `npm run start:prod` | Run compiled app without auto-migrations       |

### Code Quality

| Script                    | Description                                           |
| ------------------------- | ----------------------------------------------------- |
| `npm run lint`            | Run ESLint on all files                               |
| `npm run lint:strict`     | ESLint with zero warnings allowed                     |
| `npm run lint:fix`        | Auto-fix ESLint violations                            |
| `npm run format`          | Format all files with Prettier                        |
| `npm run format:check`    | Check formatting without modifying files              |
| `npm run typecheck`       | Full TypeScript check (`tsc --noEmit`)                |
| `npm run typecheck:watch` | TypeScript in watch mode                              |
| `npm run validate`        | Full pipeline: typecheck + lint:strict + format:check |
| `npm run validate:fix`    | Auto-fix: lint:fix + format                           |

### Database

| Script                        | Description                                         |
| ----------------------------- | --------------------------------------------------- |
| `npm run prisma:generate`     | Regenerate Prisma client from schema                |
| `npm run prisma:migrate`      | Create and apply migration (dev — prompts for name) |
| `npm run prisma:migrate:prod` | Apply pending migrations (prod — no prompts)        |
| `npm run prisma:seed`         | Run seed script                                     |
| `npm run prisma:studio`       | Open Prisma Studio at http://localhost:5555         |

### Testing

| Script               | Description               |
| -------------------- | ------------------------- |
| `npm run test`       | Run Jest unit tests       |
| `npm run test:watch` | Jest in watch mode        |
| `npm run test:cov`   | Jest with coverage report |
| `npm run test:e2e`   | End-to-end tests          |

### Docker

| Script                | Description                                    |
| --------------------- | ---------------------------------------------- |
| `npm run docker:up`   | Start Docker services (`docker compose up -d`) |
| `npm run docker:down` | Stop and remove Docker containers              |
| `npm run docker:dev`  | Start with dev overrides                       |

---

## 9. API Overview

### Base URL

```
http://localhost:4000/api/v1
```

### Swagger Documentation

Available in development only:

```
http://localhost:4000/api/docs
```

### Public Endpoints (no authentication required)

| Method | Path                   | Description                                 |
| ------ | ---------------------- | ------------------------------------------- |
| `GET`  | `/health`              | System health (DB + Redis)                  |
| `POST` | `/api/v1/auth/login`   | Email/password login                        |
| `POST` | `/api/v1/auth/refresh` | Exchange refresh token for new access token |

### Authentication

All protected endpoints require a Bearer token in the `Authorization` header:

```
Authorization: Bearer <access-token>
```

Multi-tenant requests (GLOBAL_ADMIN switching tenants) additionally require:

```
X-Tenant-Id: <target-tenant-uuid>
```

### Key Endpoints

**Auth:**

```
POST /auth/login           { email, password } → { accessToken, refreshToken, user }
POST /auth/refresh         { refreshToken } → { accessToken }
GET  /auth/me              → user profile
POST /auth/logout
```

**Alerts:**

```
GET  /alerts               ?page&limit&severity&status&timeRange&query&agentName&ruleGroup&sortBy&sortOrder
GET  /alerts/:id
POST /alerts/:id/acknowledge
POST /alerts/:id/investigate
POST /alerts/:id/close     { resolution }
```

**Cases:**

```
GET  /cases                ?page&limit&severity&status&sortBy&sortOrder
POST /cases                { title, description, severity, assignee, linkedAlertIds? }
GET  /cases/:id
PATCH /cases/:id
POST /cases/:id/notes      { content }
POST /cases/:id/link-alert { alertId }
```

**Connectors:**

```
GET  /connectors
POST /connectors           { type, config }
PATCH /connectors/:type    { config }
POST /connectors/:type/test
POST /connectors/:type/toggle
DELETE /connectors/:type
```

**Threat Intelligence:**

```
GET  /ti/events/recent     ?page&limit
GET  /ti/iocs/search       ?query&type&source&page&limit
POST /ti/sync/misp
```

**Threat Hunting:**

```
POST /hunts/run            { query }
GET  /hunts/runs           ?page&limit
GET  /hunts/runs/:id
```

**Dashboard:**

```
GET  /dashboards/summary
GET  /dashboards/alert-trend        ?days
GET  /dashboards/severity-distribution
GET  /dashboards/mitre-top-techniques
GET  /dashboards/top-targeted-assets
GET  /dashboards/pipeline-health
```

**Users (self-service):**

```
GET  /users/profile
PATCH /users/profile       { name }
POST /users/change-password { currentPassword, newPassword }
GET  /users/preferences
PATCH /users/preferences   { theme, language, notificationsEmail, notificationsInApp }
```

**Admin (TENANT_ADMIN+):**

```
GET  /tenants                                            → GLOBAL_ADMIN only
POST /tenants                                            → GLOBAL_ADMIN only
GET  /tenants/:id/users
POST /tenants/:id/users
GET  /tenants/:tenantId/users/:userId
PATCH /tenants/:tenantId/users/:userId
DELETE /tenants/:tenantId/users/:userId
POST /tenants/:tenantId/users/:userId/block
POST /tenants/:tenantId/users/:userId/unblock
PATCH /tenants/:tenantId/users/:userId/role
GET  /audit-logs           ?actor&action&resource&from&to&page&limit
```

### Response Format

All responses follow a consistent envelope:

**Success:**

```json
{
  "data": { ... },
  "pagination": {
    "total": 75,
    "page": 1,
    "limit": 10,
    "totalPages": 8
  }
}
```

**Error:**

```json
{
  "statusCode": 404,
  "message": "Alert not found",
  "messageKey": "errors.alerts.notFound",
  "timestamp": "2026-03-02T12:34:56.789Z",
  "path": "/api/v1/alerts/invalid-id"
}
```

The `messageKey` is used by the frontend to look up the translated error message via `next-intl`.

---

## 10. Health Verification

### System Health (no auth)

```bash
curl http://localhost:4000/health
```

```json
{
  "status": "ok",
  "database": "connected",
  "redis": "connected",
  "timestamp": "2026-03-02T12:34:56.789Z"
}
```

Possible values for `status`: `ok`, `degraded`, `error`

### Test Login

```bash
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@aura-finance.io","password":"Admin@123"}'
```

Expected response includes `accessToken`, `refreshToken`, and `user` object with `tenantId` (UUID).

### Test Authenticated Request

```bash
TOKEN="<access-token-from-login>"

curl http://localhost:4000/api/v1/alerts?page=1&limit=5 \
  -H "Authorization: Bearer $TOKEN"
```

Expected: paginated alert list.

### Test Connector

```bash
curl -X POST http://localhost:4000/api/v1/connectors/wazuh/test \
  -H "Authorization: Bearer $TOKEN"
```

Returns connector test result (success or error with details).

---

## 11. Code Quality Tools

### TypeScript Configuration

Strict mode — all flags enabled:

| Flag                 | Description                           |
| -------------------- | ------------------------------------- |
| `strict`             | Enables all strict checks             |
| `noImplicitAny`      | All values must have explicit types   |
| `strictNullChecks`   | `null`/`undefined` handled explicitly |
| `noUnusedLocals`     | Unused variables are errors           |
| `noUnusedParameters` | Unused function parameters are errors |
| `noImplicitReturns`  | All code paths must return a value    |

### Commit Validation

The same Conventional Commits standard applies as in the frontend (see frontend INSTALL.md Section 7 for type reference and examples).

### Validation Pipeline

```bash
npm run validate
# Runs: typecheck + lint:strict + format:check
```

Run before every pull request. All three checks must pass with zero errors and zero warnings.

---

## 12. Project Structure

```
auraspear-backend/
├── prisma/
│   ├── schema.prisma           # All 15 database models, enums, indexes
│   ├── seed.ts                 # Test data seeder
│   └── migrations/             # SQL migration history
├── src/
│   ├── main.ts                 # Bootstrap: Swagger, Helmet, CORS, global prefix
│   ├── app.module.ts           # Root module (imports all feature modules)
│   ├── config/
│   │   └── env.validation.ts   # Zod schema for all env vars
│   ├── prisma/
│   │   ├── prisma.module.ts    # Global PrismaModule
│   │   └── prisma.service.ts   # PrismaClient singleton with lifecycle hooks
│   ├── common/
│   │   ├── decorators/         # @Public(), @Roles(), @CurrentUser(), @TenantId()
│   │   ├── exceptions/         # BusinessException (structured errors with messageKey)
│   │   ├── filters/            # GlobalExceptionFilter (formats all errors consistently)
│   │   ├── guards/             # AuthGuard, TenantGuard, RolesGuard
│   │   ├── interceptors/       # AuditInterceptor (logs all mutations)
│   │   ├── interfaces/         # JwtPayload, AuthenticatedRequest, PaginationMeta
│   │   └── utils/              # AES-256-GCM encryption, SSRF protection, secret masking
│   └── modules/
│       ├── auth/               # JWT login, refresh, OIDC validation, logout
│       ├── tenants/            # Multi-tenant CRUD, user management
│       ├── users/              # Profile, preferences, password change
│       ├── connectors/         # Connector CRUD, test, toggle, encrypted config
│       ├── alerts/             # Search, triage, Wazuh ingestion
│       ├── cases/              # Case lifecycle, notes, timeline
│       ├── hunts/              # Threat hunt sessions and events
│       ├── intel/              # MISP sync, IOC search and management
│       ├── dashboards/         # KPI aggregation, alert trends, MITRE stats
│       ├── ai/                 # AWS Bedrock invocation and audit logging
│       ├── health/             # System and connector health checks
│       └── audit-logs/         # Audit log search and export
├── test/
│   └── jest-e2e.json           # E2E test configuration
├── docker-compose.yml          # PostgreSQL + Redis + PgAdmin
├── Dockerfile                  # Multi-stage production build
├── .env.example                # Environment template
├── package.json
├── tsconfig.json
└── README.md
```

---

## 13. Windows-Specific Notes

### Docker Desktop Requirement

Docker Desktop for Windows must be running before executing any `docker-compose` commands. Verify it is running:

```bash
docker info
# Should list server info without errors
```

### Host vs Container Networking

When the **app runs locally** (outside Docker) but **databases run inside Docker**, use `localhost` for service hosts:

```env
POSTGRES_HOST=localhost
REDIS_HOST=localhost
DATABASE_URL="postgresql://auraspear:auraspear_secret@localhost:5432/auraspear_soc?schema=public"
```

When **both app and databases run inside Docker** (fully containerized), use Docker service names:

```env
POSTGRES_HOST=postgres
REDIS_HOST=redis
DATABASE_URL="postgresql://auraspear:auraspear_secret@postgres:5432/auraspear_soc?schema=public"
```

### Git Bash Path Issues with Docker

MINGW64 Git Bash sometimes translates absolute paths in Docker commands. If you see unexpected path errors:

```bash
# Prefix docker-compose commands with MSYS_NO_PATHCONV
MSYS_NO_PATHCONV=1 docker-compose exec postgres psql -U auraspear -d auraspear_soc
```

### Port Conflicts

Check if ports 4000, 5432, 6379, or 5050 are already in use:

```bash
netstat -ano | grep "4000\|5432\|6379\|5050"
```

Change the conflicting port in `.env` and `docker-compose.yml` as needed.

### Killing a Process on a Port

```bash
# Find and kill the process on port 4000
lsof -ti:4000 | xargs kill -9

# Or use PORT env var to run on a different port
PORT=4001 npm run start:dev
```

---

## 14. Troubleshooting

### App Fails to Start — Environment Validation Error

```
[EnvValidation] Environment validation failed:
  JWT_SECRET: String must contain at least 32 character(s)
```

**Fix:** Ensure `JWT_SECRET` and `CONFIG_ENCRYPTION_KEY` are set in `.env` with at least 64 hex characters. Use the generation command in Step 3.

### PostgreSQL Connection Refused

```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

**Fix:**

1. Start Docker services: `npm run docker:dev`
2. Wait for PostgreSQL health check: `docker-compose ps`
3. Verify `POSTGRES_HOST=localhost` in `.env`

### Prisma Migration Failed

```
Error: P3005 — database schema is not empty
```

**Fix:** The database has existing tables that conflict with the migration. Either reset:

```bash
# WARNING: destroys all data
docker-compose down -v   # Removes volumes
npm run docker:dev
npm run start:dev        # Re-runs migrations + seed
```

Or resolve the conflict manually via Prisma Studio (`npm run prisma:studio`).

### Prisma Client Out of Sync

After pulling changes that modify `schema.prisma`:

```bash
npm run prisma:generate
```

If that doesn't work, clean reinstall:

```bash
rm -rf node_modules .prisma
npm install
```

### JWT Token Errors After Changing JWT_SECRET

All existing tokens are invalidated when `JWT_SECRET` changes. Users must log in again. This is expected behavior.

### Connector Test Returns Timeout

The connector URL is unreachable. Check:

1. The connector service is running and accessible from the machine running the backend
2. No firewall rules blocking the port
3. TLS/SSL certificate issues (set `verifyTls: false` for self-signed certs in dev)

### TypeScript Compilation Errors

```bash
npm run typecheck
```

Common causes after pulling changes:

- New `schema.prisma` models require `npm run prisma:generate`
- New env vars require updating your `.env`

### ESLint Failures

```bash
npm run lint:fix   # Auto-fix what's possible
npm run format     # Fix formatting
```

Remaining errors after auto-fix must be fixed manually — no `eslint-disable` comments are allowed.

### Redis Connection Error

```
Error: connect ECONNREFUSED 127.0.0.1:6379
```

**Fix:**

1. Ensure Docker services are running: `docker-compose ps`
2. Check `REDIS_HOST=localhost` in `.env`
3. Restart Redis: `docker-compose restart redis`
