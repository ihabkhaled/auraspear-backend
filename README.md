# AuraSpear SOC BFF

Multi-tenant SIEM Backend-for-Frontend API powering the AuraSpear SOC dashboard.

## Tech Stack

- **Runtime**: Node.js 22 + NestJS 11
- **Language**: TypeScript 5.7 (strict mode)
- **Database**: PostgreSQL 16 (Prisma ORM)
- **Cache**: Redis 7
- **Auth**: OIDC / Microsoft Entra ID (JWT + JWKS)
- **Validation**: Zod
- **Logging**: pino (structured JSON)
- **API Docs**: Swagger / OpenAPI

## Quick Start

```bash
# 1. Clone and install
git clone <repo-url> && cd auraspear-backend
npm install

# 2. Start infrastructure
npm run docker:dev   # Postgres + Redis

# 3. Setup database
cp .env.example .env
npm run prisma:migrate
npm run prisma:seed

# 4. Start development server
npm run start:dev
```

API available at `http://localhost:4000/api/v1`
Swagger docs at `http://localhost:4000/api/docs`

## API Endpoints

| Method | Path | Description | Min Role |
|--------|------|-------------|----------|
| POST | `/auth/callback` | OIDC code exchange | Public |
| GET | `/auth/me` | Get current user | Any |
| GET | `/tenants` | List all tenants | GLOBAL_ADMIN |
| GET | `/tenants/current` | Get current tenant | Any |
| GET | `/connectors` | List connectors | Any |
| POST | `/connectors` | Create connector | TENANT_ADMIN |
| POST | `/connectors/:type/test` | Test connection | SOC_ANALYST_L2 |
| GET | `/alerts` | Search alerts | Any |
| POST | `/alerts/:id/acknowledge` | Acknowledge alert | SOC_ANALYST_L1 |
| GET | `/dashboards/summary` | Dashboard KPIs | Any |
| POST | `/hunts/run` | Start threat hunt | THREAT_HUNTER |
| GET | `/cases` | List cases | Any |
| POST | `/cases` | Create case | SOC_ANALYST_L1 |
| GET | `/ti/events/recent` | MISP events | Any |
| POST | `/ai/hunt` | AI-assisted hunt | Any (Bedrock required) |
| POST | `/ai/investigate` | AI investigation | Any (Bedrock required) |
| GET | `/health` | Health check | Public |

## Architecture

```
Frontend (Next.js) ──► BFF (NestJS) ──┬──► Wazuh Manager API
                                      ├──► OpenSearch / Graylog
                                      ├──► MISP Threat Intel
                                      ├──► Shuffle SOAR
                                      ├──► AWS Bedrock AI
                                      └──► PostgreSQL (config, cases, audit)
```

## Security

### Authentication & Authorization
- OIDC tokens verified via JWKS (RS256)
- Guard chain: `AuthGuard → TenantGuard → RolesGuard`
- Role hierarchy with 6 levels (GLOBAL_ADMIN to EXECUTIVE_READONLY)

### Data Protection
- Connector secrets encrypted at rest (AES-256-GCM)
- Secrets masked in API responses
- SSRF protection on all user-supplied URLs
- Rate limiting via @nestjs/throttler

### Audit Trail
- All mutations logged via global AuditInterceptor
- AI operations logged to separate ai_audit_logs table
- Request headers (Authorization, Cookie) redacted from logs

### Threat Model
| Threat | Mitigation |
|--------|-----------|
| Cross-tenant data leakage | TenantGuard enforces tenant_id on every request |
| SSRF via connector URLs | URL allowlist validation, private IP blocking |
| Secret exposure in logs | pino redact config, maskSecrets utility |
| Privilege escalation | Role hierarchy guard with position-based comparison |
| SQL injection | Prisma parameterized queries (no raw SQL) |
| JWT forgery | JWKS-based verification with RS256 |

## Development

```bash
npm run lint         # ESLint check (no eslint-disable allowed)
npm run format       # Prettier format
npm run test         # Unit tests
npm run typecheck    # TypeScript strict check
```

## Docker Production

```bash
docker compose up -d   # Builds and starts all services
```

## License

UNLICENSED - Proprietary
