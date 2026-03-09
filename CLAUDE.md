# AuraSpear SOC BFF - AI Development Guidelines

## ABSOLUTE RULES — NEVER VIOLATE

1. **NEVER use `any`** — Use `unknown`, generics, or proper types. `@typescript-eslint/no-explicit-any` is enforced.
2. **NEVER disable ESLint rules** — No `// eslint-disable`, no `@ts-ignore`, no `@ts-expect-error`. Fix the root cause.
3. **NEVER use `==` or `!=`** — Always use `===` and `!==` (`eqeqeq: error`).
4. **NEVER use `var`** — Use `const` (preferred) or `let`.
5. **NEVER use `!` (non-null assertion)** — Use proper null checks (`if`, `??`, `?.`).
6. **NEVER use `console.log`** — Only `console.warn` and `console.error` are allowed. Prefer NestJS `Logger` service.
7. **NEVER use `eval()`** — No `eval`, `new Function()`, or `setTimeout('code')`.
8. **NEVER return data from another tenant** — Every query MUST be scoped by `tenantId`.
9. **NEVER use string concatenation** — Use template literals (`prefer-template: warn`).
10. **NEVER use `Buffer()` constructor** — Use `Buffer.alloc()` or `Buffer.from()`.
11. **NEVER import without `node:` prefix** — Use `node:crypto`, `node:fs`, `node:path` etc. (`unicorn/prefer-node-protocol`).
12. **NEVER use plain text string literals for comparisons/assignments** — Always use enums. Enums live in `src/common/interfaces/` or module-level `*.types.ts`. Export and import them.
13. **NEVER define interfaces/types inline in service or controller files** — Move them to `<module>.types.ts` or `src/common/interfaces/`. Exception: DTOs in `dto/` files are fine.
14. **NEVER define constants inline in service/controller files** — Move shared constants to `src/common/constants/` or module-level constants files.
15. **Seeders MUST be idempotent** — Use `upsert` or `createMany({ skipDuplicates: true })`. Seeders must be safe for `npm run start:prod` and never crash on duplicate data.
16. **NEVER use `@UsePipes()` at method level when `@Param()` is present** — It runs the pipe on ALL parameters including path params, causing validation to fail. Apply the pipe directly on `@Body()`: `@Body(new ZodValidationPipe(Schema)) dto: Dto`.
17. **EVERY exception MUST use `BusinessException` with a specific `messageKey`** — Never throw raw `UnauthorizedException`, `NotFoundException`, `ForbiddenException`, etc. Always use `throw new BusinessException(status, message, 'errors.module.specificKey')` so the frontend can show localized error messages via `t(messageKey)`.
18. **EVERY API response error MUST include `messageKey`** — The GlobalExceptionFilter ensures this. Use `BusinessException` for all business-logic errors. The `messageKey` follows the pattern `errors.<module>.<specificAction>` (e.g., `errors.auth.invalidCredentials`, `errors.connectors.notFound`).
19. **NEVER use `@Query()` with a DTO type directly** — NestJS passes raw query strings without Zod validation. Always parse manually: `const query = Schema.parse(rawQuery)` or use individual `@Query('key')` params with explicit number coercion.
20. **NEVER allow deletion/blocking/role-change of protected users** — Users with `isProtected: true` (seeded GLOBAL_ADMIN) cannot be deleted, blocked, suspended, or have their role changed. Always check `isProtected` before these operations.
21. **NEVER hard-delete users** — Use soft delete (set `status: 'inactive'`). Provide restore functionality. Blocked users get `status: 'suspended'`.
22. **NEVER allow self-deletion or self-blocking** — Check `callerId !== userId` before delete/block operations.
23. **NEVER bypass authentication in any environment** — No dev mode auth bypass, no fake users, no skipping JWT verification regardless of `NODE_ENV`. All requests must go through the full auth guard chain.
24. **NEVER use hardcoded or fallback secrets** — Encryption keys, JWT secrets, and API keys must be loaded from environment variables with no default values. Fail loudly at startup if missing.
25. **EVERY mutation endpoint MUST have `@Roles()` and `RolesGuard`** — All POST/PATCH/PUT/DELETE endpoints must include `@UseGuards(RolesGuard)` and `@Roles(UserRole.MINIMUM_ROLE)`. No unguarded mutations.
26. **EVERY Prisma `update()` and `delete()` MUST include `tenantId` in the where clause** — Never update/delete by `id` alone. Always scope: `where: { id, tenantId }`.
27. **EVERY Zod string field MUST have `.max()` limit** — All string fields in DTOs must have a maximum length. Use DB column size as guide (e.g., `.max(255)` for VarChar(255), `.max(4096)` for Text).
28. **EVERY Zod array field MUST have `.max()` limit** — Unbounded arrays enable DoS. Add reasonable limits (e.g., `.max(500)` for alertIds).
29. **JWT signing/verification MUST specify algorithm** — Always use `{ algorithm: 'HS256' }` for signing and `{ algorithms: ['HS256'] }` for verification. Never allow algorithm confusion.
30. **validateUserActive MUST check membership status** — Not just user existence. Query `memberships` with `where: { status: 'active' }` and reject if none found.
31. **Auth endpoints MUST have strict rate limiting** — Login: `@Throttle({ default: { limit: 5, ttl: 60000 } })`. Refresh: `@Throttle({ default: { limit: 10, ttl: 60000 } })`.
32. **AI endpoints MUST have rate limiting** — Apply `@Throttle({ default: { limit: 10, ttl: 60000 } })` at controller level for all AI endpoints.
33. **Request body size MUST be limited** — `express.json({ limit: '1mb' })` is configured in `main.ts`. Never remove this.
34. **Elasticsearch queries MUST be sanitized** — Strip `script`, `_search`, `_mapping`, `_cluster`, `_cat`, `_nodes` patterns. Limit query length. Use `allow_leading_wildcard: false`.
35. **Database batch operations MUST be chunked** — Never fire hundreds of concurrent Prisma operations. Batch in chunks of 50 using `Promise.allSettled()`.

---

## Architecture

- **Pattern**: Backend-for-Frontend (BFF) — the Next.js frontend never calls Wazuh/OpenSearch/MISP directly
- **Framework**: NestJS 11 with TypeScript strict mode
- **Database**: PostgreSQL via Prisma ORM
- **Cache**: Redis via ioredis
- **Auth**: OIDC (Microsoft Entra ID) with JWT + JWKS verification
- **Validation**: Zod schemas for all DTOs (no class-validator)
- **Logging**: nestjs-pino (structured JSON logs)
- **Security**: Helmet, Throttler, SSRF protection, AES-256-GCM encryption at rest

---

## ESLint Rules (ALL enforced — `eslint.config.mjs`)

### Presets Applied

- `js.configs.recommended`
- `tseslint.configs.strict` — includes `no-dynamic-delete`, `no-invalid-void-type`, `no-unnecessary-type-arguments`, `unified-signatures`, `no-useless-constructor`, `no-array-delete`

### Plugins

- `eslint-plugin-security` — Backend security (ReDoS, injection, timing attacks, CSRF, etc.)
- `eslint-plugin-unicorn` — Modern JS best practices and code modernization
- `eslint-plugin-import-x` — Import organization and hygiene

### TypeScript Strict Rules

| Rule                            | Level     | Details                                                                      |
| ------------------------------- | --------- | ---------------------------------------------------------------------------- |
| `no-explicit-any`               | **error** | Use `unknown`, generics, or proper types                                     |
| `no-unused-vars`                | **error** | Exception: `_` prefix (`argsIgnorePattern: '^_'`, `varsIgnorePattern: '^_'`) |
| `no-non-null-assertion`         | **error** | Use proper null checks (`if`, `??`, `?.`)                                    |
| `consistent-type-imports`       | **warn**  | Use `import type { Foo }` (inline style)                                     |
| `no-shadow`                     | **warn**  | Prevent variable name collisions with outer scope                            |
| `default-param-last`            | **error** | Default parameters must come last in function signature                      |
| `no-useless-empty-export`       | **error** | No empty `export {}` that does nothing                                       |
| `no-loop-func`                  | **error** | No functions defined inside loops (closure bugs)                             |
| `explicit-function-return-type` | **warn**  | Required for API contracts (allows expressions)                              |
| `no-floating-promises`          | **error** | Catch all promises (critical for NestJS async)                               |
| `no-misused-promises`           | **error** | No passing async to non-async contexts                                       |
| `prefer-nullish-coalescing`     | **warn**  | Use `??` instead of `\|\|` for nullish values                                |
| `prefer-optional-chain`         | **warn**  | Use `?.` instead of `&&` chains                                              |
| `no-extraneous-class`           | **off**   | NestJS modules are decorated empty classes                                   |

### General Code Quality Rules

| Rule                          | Level                    | Details                                                    |
| ----------------------------- | ------------------------ | ---------------------------------------------------------- |
| `eqeqeq`                      | **error**                | Always use `===` / `!==`                                   |
| `no-console`                  | **warn**                 | Only `console.warn` and `console.error` allowed            |
| `prefer-const`                | **error**                | Use `const` when not reassigned                            |
| `no-var`                      | **error**                | Use `const` / `let`                                        |
| `no-implicit-coercion`        | **error**                | No `!!`, `+str`, etc. Use explicit `Boolean()`, `Number()` |
| `no-template-curly-in-string` | **warn**                 | Warn when `${x}` appears in regular strings                |
| `curly`                       | **error** (`multi-line`) | Multi-line `if`/`else`/`for`/`while` must use braces       |
| `no-throw-literal`            | **error**                | Only throw `Error` objects                                 |
| `prefer-template`             | **warn**                 | Use template literals over string concatenation            |

#### Clean Code Rules

| Rule                    | Level     | Details                                       |
| ----------------------- | --------- | --------------------------------------------- |
| `no-useless-rename`     | **error** | No `{ foo: foo }` style renaming              |
| `object-shorthand`      | **warn**  | Use `{ foo }` instead of `{ foo: foo }`       |
| `no-lonely-if`          | **warn**  | Combine with parent `else` when possible      |
| `no-else-return`        | **warn**  | Return early instead of `else` blocks         |
| `no-unneeded-ternary`   | **error** | No `x ? true : false` (just use `x`)          |
| `prefer-arrow-callback` | **error** | Use arrow functions for callbacks             |
| `prefer-destructuring`  | **warn**  | Prefer `const { x } = obj` (objects only)     |
| `no-nested-ternary`     | **warn**  | Avoid nested `a ? b : c ? d : e`              |
| `no-useless-concat`     | **error** | No `'a' + 'b'` (just write `'ab'`)            |
| `no-return-assign`      | **error** | No assignment in return statements            |
| `no-param-reassign`     | **warn**  | Don't reassign function parameters            |
| `prefer-object-spread`  | **error** | Use `{ ...obj }` instead of `Object.assign()` |

#### Bug Prevention Rules

| Rule                         | Level     | Details                                                |
| ---------------------------- | --------- | ------------------------------------------------------ |
| `no-await-in-loop`           | **warn**  | Prefer `Promise.all()` over sequential awaits in loops |
| `no-promise-executor-return` | **error** | Don't return values from Promise executor              |
| `no-constructor-return`      | **error** | Constructors must not return values                    |
| `no-unreachable-loop`        | **error** | Loops must execute more than once                      |
| `no-self-compare`            | **error** | No `x === x` (use `Number.isNaN()` instead)            |
| `no-sequences`               | **error** | No comma operator (confusing control flow)             |

#### Security Rules (core ESLint)

| Rule              | Level     | Details                                     |
| ----------------- | --------- | ------------------------------------------- |
| `no-eval`         | **error** | Never use `eval()`                          |
| `no-implied-eval` | **error** | No `setTimeout('code')` style implicit eval |
| `no-new-func`     | **error** | No `new Function('code')`                   |
| `no-script-url`   | **error** | No `javascript:` URLs                       |

#### Security Rules (eslint-plugin-security)

| Rule                                    | Level     | Details                                              |
| --------------------------------------- | --------- | ---------------------------------------------------- |
| `detect-unsafe-regex`                   | **error** | Detect catastrophic exponential-time regexes (ReDoS) |
| `detect-non-literal-regexp`             | **warn**  | Detect `RegExp()` with non-literal arguments         |
| `detect-bidi-characters`                | **error** | Detect trojan source attacks via bidi control chars  |
| `detect-object-injection`               | **warn**  | Detect `obj[variable]` (prototype pollution risk)    |
| `detect-possible-timing-attacks`        | **warn**  | Detect timing attacks in string comparisons          |
| `detect-new-buffer`                     | **error** | Use `Buffer.alloc()`/`Buffer.from()` instead         |
| `detect-pseudoRandomBytes`              | **warn**  | `Math.random()` is not cryptographically secure      |
| `detect-non-literal-fs-filename`        | **warn**  | Non-literal fs paths (path traversal risk)           |
| `detect-child-process`                  | **warn**  | `child_process` with non-literal arguments           |
| `detect-non-literal-require`            | **warn**  | Non-literal `require()` calls                        |
| `detect-buffer-noassert`                | **error** | Buffer with noAssert flag                            |
| `detect-eval-with-expression`           | **error** | `eval()` with expression                             |
| `detect-no-csrf-before-method-override` | **error** | CSRF vulnerability detection                         |
| `detect-disable-mustache-escape`        | **error** | Disabled mustache escaping                           |

### Import Rules (eslint-plugin-import-x)

| Rule                                | Level     | Details                                                    |
| ----------------------------------- | --------- | ---------------------------------------------------------- |
| `import-x/no-duplicates`            | **error** | No duplicate imports from same module                      |
| `import-x/no-self-import`           | **error** | A module cannot import itself                              |
| `import-x/no-cycle`                 | **warn**  | Detect circular dependencies (maxDepth: 4)                 |
| `import-x/no-useless-path-segments` | **warn**  | No useless path segments                                   |
| `import-x/order`                    | **warn**  | Order: builtin -> external -> internal -> relative -> type |

### Unicorn Rules (Modern JS Best Practices)

| Rule                                | Level     | Details                                                                                                             |
| ----------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------- |
| `prefer-array-find`                 | **error** | Use `.find()` instead of `.filter()[0]`                                                                             |
| `prefer-array-flat`                 | **error** | Use `.flat()` instead of manual flattening                                                                          |
| `prefer-array-flat-map`             | **error** | Use `.flatMap()` instead of `.map().flat()`                                                                         |
| `prefer-array-some`                 | **error** | Use `.some()` instead of `.find() !== undefined`                                                                    |
| `prefer-includes`                   | **error** | Use `.includes()` instead of `.indexOf() !== -1`                                                                    |
| `no-array-for-each`                 | **warn**  | Prefer `for...of` over `.forEach()`                                                                                 |
| `prefer-string-replace-all`         | **warn**  | Use `.replaceAll()` instead of `.replace(/g/)`                                                                      |
| `prefer-string-starts-ends-with`    | **error** | Use `.startsWith()`/`.endsWith()`                                                                                   |
| `prefer-string-trim-start-end`      | **error** | Use `.trimStart()`/`.trimEnd()`                                                                                     |
| `prefer-number-properties`          | **error** | Use `Number.isNaN()`, `Number.parseInt()`, etc.                                                                     |
| `prefer-math-trunc`                 | **error** | Use `Math.trunc()` instead of `~~x`                                                                                 |
| `no-zero-fractions`                 | **error** | No `1.0` — just write `1`                                                                                           |
| `prefer-date-now`                   | **error** | Use `Date.now()` instead of `new Date().getTime()`                                                                  |
| `prefer-type-error`                 | **error** | Throw `TypeError` for type-checking failures                                                                        |
| `prefer-regexp-test`                | **error** | Use `.test()` instead of `.match()` for boolean checks                                                              |
| `prefer-spread`                     | **warn**  | Use `[...arr]` instead of `Array.from(arr)`                                                                         |
| `prefer-switch`                     | **warn**  | Use `switch` when 3+ `if/else if` on same variable                                                                  |
| `prefer-ternary`                    | **warn**  | Use ternary for simple if/else assignments                                                                          |
| `no-useless-undefined`              | **warn**  | Don't pass `undefined` explicitly                                                                                   |
| `no-useless-spread`                 | **error** | No `[...array]` when not needed                                                                                     |
| `no-useless-promise-resolve-reject` | **error** | Use `throw` instead of `Promise.reject()` in async                                                                  |
| `no-unnecessary-await`              | **error** | Don't await non-Promise values                                                                                      |
| `no-lonely-if`                      | **error** | Merge nested `if` into `else if`                                                                                    |
| `throw-new-error`                   | **error** | Always use `throw new Error()`, not `throw Error()`                                                                 |
| `error-message`                     | **error** | Error constructors must have a message                                                                              |
| `no-instanceof-array`               | **error** | Use `Array.isArray()` instead of `instanceof Array`                                                                 |
| `no-negated-condition`              | **warn**  | Prefer positive conditions in if/else                                                                               |
| `no-object-as-default-parameter`    | **error** | No `function(options = {})` pattern                                                                                 |
| `consistent-function-scoping`       | **warn**  | Move functions to smallest needed scope                                                                             |
| `prefer-node-protocol`              | **error** | Use `node:crypto` not `crypto`                                                                                      |
| `no-nested-ternary`                 | **error** | No nested ternaries                                                                                                 |
| `filename-case`                     | **warn**  | Files: `kebab-case` only (NestJS convention)                                                                        |
| `prevent-abbreviations`             | **warn**  | Full words preferred; allowed: `req`, `res`, `env`, `db`, `fn`, `args`, `params`, `props`, `ctx`, `dto`, `e`, `err` |

---

## Formatting (Prettier — `.prettierrc`)

| Setting         | Value                   |
| --------------- | ----------------------- |
| Semi            | `false` (no semicolons) |
| Single quotes   | `true`                  |
| Print width     | `100`                   |
| Tab width       | `2`                     |
| Trailing comma  | `es5`                   |
| Arrow parens    | `avoid`                 |
| Bracket spacing | `true`                  |
| End of line     | `lf`                    |

---

## TypeScript Configuration (`tsconfig.json`)

- **Target**: ES2022
- **Module**: CommonJS (NestJS requirement)
- **ALL strict flags enabled**: `strict`, `noImplicitAny`, `strictNullChecks`, `strictBindCallApply`
- **`noUncheckedIndexedAccess`**: `true` — indexed access returns `T | undefined`
- **`noFallthroughCasesInSwitch`**: `true` — switch cases must `break`/`return`
- **`forceConsistentCasingInFileNames`**: `true`
- **Decorators**: `emitDecoratorMetadata` + `experimentalDecorators` (NestJS requires both)

### Path Alias

```typescript
@/* -> ./src/*
```

---

## Pre-Commit Hooks (Husky + lint-staged)

On every commit, the following checks run automatically on staged files:

1. **ESLint** — Lints all staged `.ts` files
2. **TypeScript** — `tsc --noEmit --pretty` (full type check)
3. **Prettier** — Formats all staged `.ts`, `.json`, `.md`, `.yml`, `.yaml` files

Configuration:

- `.husky/pre-commit` runs `npm run lint-staged`
- `.lintstagedrc.cjs` — Uses `npm run` scripts
- `.husky/install.mjs` — Skips Husky install in CI/production/Vercel/GitHub Actions

---

## Key Principles

1. **Multi-tenant isolation**: Every query MUST be scoped by `tenantId`. Never return data from another tenant.
2. **RBAC enforcement**: Use `@Roles()` decorator on every mutation endpoint. Guard chain: `AuthGuard` (JWT verify + DB active check + GLOBAL_ADMIN tenant switch) → `TenantGuard` → `RolesGuard`.
3. **Zod for validation**: All DTOs use Zod schemas via `ZodValidationPipe`. No class-validator.
4. **Secrets encrypted at rest**: Connector configs stored via AES-256-GCM encryption (`src/common/utils/encryption.util.ts`).
5. **SSRF protection**: All user-supplied URLs validated against allowlist before any outbound request (`src/common/utils/ssrf.util.ts`).
6. **Audit logging**: All mutations automatically logged via `AuditInterceptor`.
7. **Auth guard validates user on every request**: After JWT verification, the guard calls `validateUserActive(userId)` which checks the user still exists and has `status: 'active'`. Blocked/deleted users get 401.
8. **GLOBAL_ADMIN tenant switching**: The auth guard reads the `X-Tenant-Id` header. If the user is `GLOBAL_ADMIN` and the header contains a valid tenant ID different from the JWT's, `request.user.tenantId` is overridden. This makes `@TenantId()` return the switched tenant automatically. Non-GLOBAL_ADMIN users cannot switch tenants.
9. **Soft delete + restore pattern**: User deletion sets `status` to `inactive`, not database deletion. Blocking sets `status` to `suspended`. Both are reversible with restore/unblock endpoints.

---

## Role Hierarchy (most to least privileged)

1. `GLOBAL_ADMIN`
2. `TENANT_ADMIN`
3. `SOC_ANALYST_L2`
4. `THREAT_HUNTER`
5. `SOC_ANALYST_L1`
6. `EXECUTIVE_READONLY`

> **Protected users**: The seeded GLOBAL_ADMIN users have `isProtected: true` in the database. They cannot be deleted, blocked, or have their role changed by anyone, including other GLOBAL_ADMIN users. The `isProtected` flag is set during seed and should never be set manually.

---

## User Management Patterns

### Soft Delete

- `DELETE /tenants/:id/users/:userId` → sets `status: 'inactive'` (not hard delete)
- `POST /tenants/:id/users/:userId/restore` → sets `status: 'active'`

### Block/Unblock

- `POST /tenants/:id/users/:userId/block` → sets `status: 'suspended'`
- `POST /tenants/:id/users/:userId/unblock` → sets `status: 'active'`

### Validation Rules

- Cannot delete/block yourself (`callerId !== userId`)
- Cannot delete/block/modify protected users (`isProtected: true`)
- Protected user role cannot be changed
- All operations require `TENANT_ADMIN` or higher role
- All changes are audit-logged

### User Statuses

| Status      | Meaning      | Can Login | Restorable      |
| ----------- | ------------ | --------- | --------------- |
| `active`    | Normal state | Yes       | N/A             |
| `inactive`  | Soft-deleted | No (401)  | Yes (`restore`) |
| `suspended` | Blocked      | No (401)  | Yes (`unblock`) |

---

## Project Structure

```
src/
+-- app.module.ts           # Root module
+-- main.ts                 # Application bootstrap
+-- common/
|   +-- decorators/         # @CurrentUser, @Roles, @Public, @TenantId
|   +-- filters/            # Exception filters
|   +-- guards/             # AuthGuard, TenantGuard, RolesGuard
|   +-- interceptors/       # AuditInterceptor
|   +-- interfaces/         # Shared interfaces (AuthenticatedRequest, JwtPayload)
|   +-- pipes/              # ZodValidationPipe
|   +-- utils/              # encryption.util.ts, mask.util.ts, ssrf.util.ts
+-- config/                 # env.validation.ts (Zod env schema)
+-- modules/
|   +-- ai/                 # AI-powered analysis endpoints
|   |   +-- dto/            # ai-hunt.dto, ai-investigate.dto, ai-explain.dto
|   |   +-- ai.types.ts     # AiTokenUsage, AiResponse
|   +-- alerts/             # Alert management (Wazuh alerts)
|   |   +-- dto/            # search-alerts.dto, investigate-alert.dto, close-alert.dto
|   |   +-- alerts.types.ts # Alert, PaginatedResult
|   +-- auth/               # Authentication (OIDC callback, token exchange)
|   |   +-- dto/            # auth-callback.dto, auth-refresh.dto
|   +-- cases/              # Case management (CRUD, notes, linked alerts)
|   |   +-- dto/            # create-case.dto, update-case.dto, create-note.dto, link-alert.dto
|   |   +-- cases.types.ts  # CaseRecord, CaseNote, PaginatedCases, etc.
|   +-- connectors/         # Connector management + service adapters
|   |   +-- dto/            # connector.dto, toggle-connector.dto
|   |   +-- services/       # wazuh, opensearch, misp, shuffle, bedrock adapters
|   |   +-- connectors.types.ts # ConnectorResponse, TestResult, ConnectorTestResult
|   +-- dashboards/         # Dashboard aggregation endpoints
|   +-- health/             # Health check endpoints
|   |   +-- health.types.ts # ServiceHealthResult, OverallHealth
|   +-- hunts/              # Threat hunting endpoints
|   |   +-- dto/            # run-hunt.dto
|   |   +-- hunts.types.ts  # HuntEvent, HuntRunResult
|   +-- intel/              # Threat intelligence (MISP integration)
|   |   +-- dto/            # match-iocs.dto
|   |   +-- intel.types.ts  # MISPEvent, IOCSearchResult, IOCMatchResult
|   +-- tenants/            # Tenant management
|   |   +-- dto/            # tenant.dto
|   |   +-- tenants.types.ts # TenantRecord, UserRecord (isProtected field)
|   +-- users/              # User profile + preferences
|   |   +-- dto/            # update-profile.dto, change-password.dto, update-preferences.dto
|   |   +-- users.types.ts  # UserProfile, UserPreference
+-- prisma/
    +-- prisma.module.ts
    +-- prisma.service.ts
    +-- schema.prisma
test/
+-- utils/                  # Unit tests for utility functions
```

---

## Commands

```bash
# Development
npm run start:dev           # Development with watch mode
npm run start:debug         # Debug mode with watch
npm run start:prod          # Production mode

# Build
npm run build               # Production build (nest build)

# Linting & Formatting
npm run lint                # ESLint check
npm run lint:strict         # ESLint with zero warnings allowed
npm run lint:fix            # ESLint auto-fix
npm run format              # Prettier format all files
npm run format:check        # Prettier check (no write)

# Type Checking
npm run typecheck           # TypeScript type check (no emit)
npm run typecheck:watch     # Type check in watch mode

# Validation (all checks)
npm run validate            # typecheck + lint:strict + format:check
npm run validate:fix        # lint:fix + format

# Reports
npm run lint-report-all     # Generate ESLint JSON report (all files)
npm run lint-report-ts      # Generate ESLint JSON report (TS only)

# Testing
npm run test                # Run unit tests
npm run test:watch          # Tests in watch mode
npm run test:cov            # Tests with coverage
npm run test:e2e            # End-to-end tests

# Database
npm run prisma:generate     # Generate Prisma client
npm run prisma:migrate      # Run migrations (dev)
npm run prisma:migrate:prod # Run migrations (production)
npm run prisma:seed         # Seed database
npm run prisma:studio       # Open Prisma Studio

# Docker
npm run docker:up           # Start containers
npm run docker:down         # Stop containers
npm run docker:dev          # Start with dev overrides
```

---

## NestJS Conventions

### Module Pattern

NestJS modules are decorated empty classes — this is the intended pattern. `@typescript-eslint/no-extraneous-class` is turned off.

```typescript
@Module({
  imports: [PrismaModule],
  controllers: [AlertsController],
  providers: [AlertsService],
})
export class AlertsModule {}
```

### Controller Pattern

Controllers handle HTTP routing, validation, and delegation to services. Use decorators for auth, roles, and parameter extraction.

```typescript
@Controller('alerts')
@UseGuards(AuthGuard, TenantGuard, RolesGuard)
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  @Roles(UserRole.SOC_ANALYST_L1)
  async getAlerts(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<AlertsResponse> {
    return this.alertsService.getAlerts(tenantId)
  }
}
```

> **Note on GLOBAL_ADMIN tenant switching**: `@TenantId()` automatically returns the switched tenant ID when a GLOBAL_ADMIN sends an `X-Tenant-Id` header. Controllers do not need special handling — the auth guard performs the override on `request.user.tenantId` before the controller runs.

### Service Pattern

Services contain business logic. Use NestJS `Logger` instead of `console.log`.

```typescript
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name)

  constructor(private readonly prisma: PrismaService) {}
}
```

### DTO Pattern (Zod)

All DTOs use Zod schemas. Validate with `ZodValidationPipe`.

```typescript
import { z } from 'zod'

export const CreateAlertSchema = z.object({
  title: z.string().min(1).max(255),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
})

export type CreateAlertDto = z.infer<typeof CreateAlertSchema>
```

---

## File Naming

- All files use **kebab-case**: `auth.guard.ts`, `create-case.dto.ts`, `ssrf.util.ts`
- Modules follow NestJS conventions: `*.module.ts`, `*.controller.ts`, `*.service.ts`
- DTOs in `dto/` subdirectory per module
- Type/interface files: `<module>.types.ts` at the module root (e.g. `alerts.types.ts`)
- Exported domain types go in `*.types.ts`, NOT in service files
- Internal-only interfaces (not used outside the file) stay in the service file
- Connector adapter services share types from `connectors.types.ts`

---

## Testing

- Unit tests: `test/` directory, `*.spec.ts` pattern
- Test guards, utils, and pipes — services tested via e2e
- Test files have relaxed ESLint rules (no `any` enforcement, no return type requirements)
- Run tests before committing: `npm test`

---

## Libraries — Reference

| Library             | Purpose                          | Import                                         |
| ------------------- | -------------------------------- | ---------------------------------------------- |
| `@nestjs/common`    | Core NestJS decorators/utilities | `Injectable`, `Controller`, `Module`, `Logger` |
| `@nestjs/config`    | Environment configuration        | `ConfigService`                                |
| `@nestjs/swagger`   | API documentation                | `ApiTags`, `ApiOperation`                      |
| `@nestjs/throttler` | Rate limiting                    | `ThrottlerGuard`                               |
| `@prisma/client`    | Database ORM                     | via `PrismaService`                            |
| `zod`               | Schema validation                | `z.object()`, `z.string()`                     |
| `helmet`            | HTTP security headers            | Applied globally in `main.ts`                  |
| `nestjs-pino`       | Structured logging               | `LoggerModule`                                 |
| `ioredis`           | Redis client                     | Cache operations                               |
| `jwks-rsa`          | JWKS key retrieval               | JWT verification                               |
| `jsonwebtoken`      | JWT parsing/verification         | Token validation                               |
| `uuid`              | UUID generation                  | `randomUUID()` from `node:crypto` preferred    |

---

## Commit Messages

Follow Conventional Commits (enforced by commitlint):

- `feat:` — New feature
- `fix:` — Bug fix
- `docs:` — Documentation only
- `style:` — Formatting, no code change
- `refactor:` — Code change that neither fixes a bug nor adds a feature
- `perf:` — Performance improvement
- `test:` — Adding or updating tests
- `build:` — Build system or dependency changes
- `ci:` — CI configuration changes
- `chore:` — Other changes (tooling, configs)
- `revert:` — Revert a previous commit

Subject max length: 100 characters. No sentence-case, start-case, PascalCase, or UPPER_CASE in subject.
