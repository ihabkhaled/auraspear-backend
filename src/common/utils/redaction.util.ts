/**
 * Keys that must be redacted from log metadata and audit payloads.
 * Shared between AuditInterceptor and AppLoggerService.
 */
export const SENSITIVE_KEYS = new Set([
  'password',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'passwordHash',
  'secret',
  'apiKey',
  'token',
  'bearerToken',
  'accessKey',
  'clientSecret',
  'refreshToken',
  'accessToken',
  'encryptedConfig',
  'authorization',
  'secretAccessKey',
  'cookie',
  'sessionToken',
  'encryptionKey',
])

const MAX_REDACT_DEPTH = 5

export function redactSensitiveFields(
  object: Record<string, unknown>,
  depth = 0
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(object)) {
    if (SENSITIVE_KEYS.has(key)) {
      sanitized[key] = '[REDACTED]'
    } else if (depth < MAX_REDACT_DEPTH && Array.isArray(value)) {
      sanitized[key] = value.map(item =>
        item !== null && typeof item === 'object' && !Array.isArray(item)
          ? redactSensitiveFields(item as Record<string, unknown>, depth + 1)
          : item
      )
    } else if (
      depth < MAX_REDACT_DEPTH &&
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      sanitized[key] = redactSensitiveFields(value as Record<string, unknown>, depth + 1)
    } else {
      sanitized[key] = value
    }
  }
  return sanitized
}
