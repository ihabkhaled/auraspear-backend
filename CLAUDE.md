# AuraSpear SOC BFF - Development Standards

## Architecture

- **Pattern**: Backend-for-Frontend (BFF) — the Next.js frontend never calls Wazuh/OpenSearch/MISP directly
- **Framework**: NestJS with TypeScript strict mode
- **Database**: PostgreSQL via Prisma ORM
- **Cache**: Redis via ioredis
- **Auth**: OIDC (Microsoft Entra ID) with JWT + JWKS verification

## Key Principles

1. **Multi-tenant isolation**: Every query MUST be scoped by `tenantId`. Never return data from another tenant.
2. **RBAC enforcement**: Use `@Roles()` decorator on every mutation endpoint. Guard chain: AuthGuard → TenantGuard → RolesGuard.
3. **No `eslint-disable`**: Fix the code, don't suppress warnings. Zero exceptions.
4. **No `any` types**: Use `unknown` with type narrowing instead.
5. **Zod for validation**: All DTOs use Zod schemas. No class-validator.
6. **Secrets encrypted at rest**: Connector configs stored via AES-256-GCM encryption.
7. **SSRF protection**: All user-supplied URLs validated against allowlist before any outbound request.
8. **Audit logging**: All mutations automatically logged via AuditInterceptor.

## Role Hierarchy (most to least privileged)

1. GLOBAL_ADMIN
2. TENANT_ADMIN
3. SOC_ANALYST_L2
4. THREAT_HUNTER
5. SOC_ANALYST_L1
6. EXECUTIVE_READONLY

## Commands

```bash
npm run start:dev       # Development with watch mode
npm run build           # Production build
npm run test            # Run unit tests
npm run test:e2e        # Run e2e tests
npm run lint            # Lint check
npm run lint:fix        # Auto-fix lint issues
npm run prisma:migrate  # Run database migrations
npm run prisma:seed     # Seed database with demo data
npm run prisma:studio   # Open Prisma Studio
npm run docker:dev      # Start Postgres + Redis containers
```

## File Naming

- All files use kebab-case: `auth.guard.ts`, `create-case.dto.ts`
- Modules follow NestJS conventions: `*.module.ts`, `*.controller.ts`, `*.service.ts`
- DTOs in `dto/` subdirectory per module
- Connector service adapters in `modules/connectors/services/`

## Testing

- Unit tests: `test/` directory, `*.spec.ts` pattern
- Test guards, utils, and pipes — services are tested via e2e
- Run tests before committing: `npm test`

## Commit Messages

Follow Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`
