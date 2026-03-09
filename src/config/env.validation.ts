import { z } from 'zod'

export const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z
    .string()
    .default('')
    .refine(value => process.env.NODE_ENV !== 'production' || value.length >= 16, {
      message: 'REDIS_PASSWORD must be at least 16 characters in production',
    }),

  // OIDC (optional — only needed when using OIDC auth)
  OIDC_ISSUER_URL: z.string().url().optional(),
  OIDC_AUDIENCE: z.string().optional(),
  OIDC_JWKS_URI: z.string().url().optional(),
  OIDC_CLIENT_ID: z.string().optional(),

  // JWT (for email/password auth) — should be 64-char hex (32 bytes)
  JWT_SECRET: z
    .string()
    .min(32)
    .refine(value => value.length >= 64 && /^[\da-f]+$/i.test(value), {
      message:
        "JWT_SECRET must be at least 64 hex characters. Generate: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    }),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),

  // Application
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  // Encryption — must be exactly 64-char hex (32 bytes for AES-256)
  CONFIG_ENCRYPTION_KEY: z
    .string()
    .length(64)
    .regex(/^[\da-f]{64}$/i, {
      message:
        "CONFIG_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Generate: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    }),

  // Connector defaults (optional — per-tenant config stored in DB)
  WAZUH_MANAGER_URL: z.string().url().optional(),
  WAZUH_INDEXER_URL: z.string().url().optional(),
  GRAYLOG_BASE_URL: z.string().url().optional(),
  LOGSTASH_BASE_URL: z.string().url().optional(),
  VELOCIRAPTOR_BASE_URL: z.string().url().optional(),
  GRAFANA_BASE_URL: z.string().url().optional(),
  INFLUXDB_BASE_URL: z.string().url().optional(),
  MISP_BASE_URL: z.string().url().optional(),
  SHUFFLE_BASE_URL: z.string().url().optional(),

  // AWS (for Bedrock AI module)
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_BEDROCK_MODEL_ID: z.string().default('anthropic.claude-3-sonnet-20240229-v1:0'),
})

export type EnvironmentConfig = z.infer<typeof envSchema>

export function validateEnvironment(config: Record<string, unknown>): EnvironmentConfig {
  const result = envSchema.safeParse(config)
  if (!result.success) {
    const formatted = result.error.issues
      .map(issue => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    throw new Error(`Environment validation failed:\n${formatted}`)
  }
  return result.data
}
