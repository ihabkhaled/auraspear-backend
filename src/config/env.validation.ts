import { z } from 'zod'

export const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().default(''),

  // OIDC (optional — only needed when using OIDC auth)
  OIDC_ISSUER_URL: z.string().url().optional(),
  OIDC_AUDIENCE: z.string().optional(),
  OIDC_JWKS_URI: z.string().url().optional(),
  OIDC_CLIENT_ID: z.string().optional(),

  // JWT (for email/password auth)
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),

  // Application
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  // Encryption
  CONFIG_ENCRYPTION_KEY: z.string().min(32),

  // Connector defaults (optional — per-tenant config stored in DB)
  WAZUH_MANAGER_URL: z.string().url().optional(),
  WAZUH_INDEXER_URL: z.string().url().optional(),
  GRAYLOG_BASE_URL: z.string().url().optional(),
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
