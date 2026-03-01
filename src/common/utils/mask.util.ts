const SENSITIVE_KEYS = new Set([
  'password',
  'secret',
  'token',
  'apikey',
  'api_key',
  'apiKey',
  'authKey',
  'auth_key',
  'accessKey',
  'access_key',
  'secretAccessKey',
  'secret_access_key',
  'encryptedConfig',
  'encrypted_config',
  'authorization',
])

export function maskSecrets(data: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(key.toLowerCase())) {
      masked[key] = typeof value === 'string' && value.length > 0 ? '***REDACTED***' : value
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      masked[key] = maskSecrets(value as Record<string, unknown>)
    } else {
      masked[key] = value
    }
  }

  return masked
}
