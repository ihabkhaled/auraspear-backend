import { REDACTED_PLACEHOLDER } from '../../common/utils/mask.utility'
import type { ConnectorResponse } from './connectors.types'

/* ---------------------------------------------------------------- */
/* CONNECTOR → RESPONSE MAPPING                                      */
/* ---------------------------------------------------------------- */

interface ConnectorRow {
  type: string
  name: string
  enabled: boolean
  authType: string
  encryptedConfig: string
  lastTestAt: Date | null
  lastTestOk: boolean | null
  lastError: string | null
}

export function mapConnectorToResponse(
  row: ConnectorRow,
  decryptFunction: (enc: string) => Record<string, unknown>,
  maskFunction: (config: Record<string, unknown>) => Record<string, unknown>
): ConnectorResponse {
  return {
    type: row.type,
    name: row.name,
    enabled: row.enabled,
    authType: row.authType,
    config: maskFunction(decryptFunction(row.encryptedConfig)),
    lastTestAt: row.lastTestAt,
    lastTestOk: row.lastTestOk,
    lastError: row.lastError,
  }
}

/* ---------------------------------------------------------------- */
/* CONFIG MERGE                                                      */
/* ---------------------------------------------------------------- */

export function mergeConfigWithRedacted(
  incoming: Record<string, unknown>,
  existingDecrypted: Record<string, unknown>
): Record<string, unknown> {
  const merged = new Map<string, unknown>()

  for (const [key, value] of Object.entries(incoming)) {
    const fallback = new Map(Object.entries(existingDecrypted)).get(key)
    merged.set(key, value === REDACTED_PLACEHOLDER ? fallback : value)
  }
  for (const [key, value] of Object.entries(existingDecrypted)) {
    if (!merged.has(key)) {
      merged.set(key, value)
    }
  }

  return Object.fromEntries(merged)
}

/* ---------------------------------------------------------------- */
/* UPDATE DATA BUILDING                                              */
/* ---------------------------------------------------------------- */

export function buildConnectorUpdateData(dto: {
  name?: string
  enabled?: boolean
  authType?: string
}): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  if (dto.name !== undefined) data.name = dto.name
  if (dto.enabled !== undefined) data.enabled = dto.enabled
  if (dto.authType !== undefined) data.authType = dto.authType
  return data
}

/* ---------------------------------------------------------------- */
/* CONFIG KEY NORMALIZATION                                          */
/* ---------------------------------------------------------------- */

/**
 * Normalizes deprecated config keys to their canonical names at runtime.
 * This ensures backward compatibility with existing encrypted configs that
 * were stored before key naming was standardized:
 * - verifyTLS → verifyTls
 * - mispAuthKey → authKey
 * - shuffleApiKey → apiKey
 *
 * In all cases, the canonical key takes precedence if both are present.
 */
export function normalizeConnectorConfig(config: Record<string, unknown>): Record<string, unknown> {
  const normalized = new Map(Object.entries(config))

  // verifyTLS → verifyTls
  if (normalized.has('verifyTLS') && !normalized.has('verifyTls')) {
    normalized.set('verifyTls', normalized.get('verifyTLS'))
    normalized.delete('verifyTLS')
  } else if (normalized.has('verifyTLS') && normalized.has('verifyTls')) {
    normalized.delete('verifyTLS')
  }

  // mispAuthKey → authKey
  if (normalized.has('mispAuthKey') && !normalized.has('authKey')) {
    normalized.set('authKey', normalized.get('mispAuthKey'))
    normalized.delete('mispAuthKey')
  } else if (normalized.has('mispAuthKey') && normalized.has('authKey')) {
    normalized.delete('mispAuthKey')
  }

  // shuffleApiKey → apiKey
  if (normalized.has('shuffleApiKey') && !normalized.has('apiKey')) {
    normalized.set('apiKey', normalized.get('shuffleApiKey'))
    normalized.delete('shuffleApiKey')
  } else if (normalized.has('shuffleApiKey') && normalized.has('apiKey')) {
    normalized.delete('shuffleApiKey')
  }

  return Object.fromEntries(normalized)
}

/* ---------------------------------------------------------------- */
/* URL VALIDATION                                                    */
/* ---------------------------------------------------------------- */

const URL_KEYS = new Set([
  'baseUrl',
  'managerUrl',
  'indexerUrl',
  'webhookUrl',
  'apiUrl',
  'grafanaUrl',
  'mispUrl',
])

export function extractUrlFields(
  config: Record<string, unknown>
): Array<{ key: string; value: string }> {
  const urls: Array<{ key: string; value: string }> = []
  for (const [key, value] of Object.entries(config)) {
    if (URL_KEYS.has(key) && typeof value === 'string' && value.length > 0) {
      urls.push({ key, value })
    }
  }
  return urls
}

/* ---------------------------------------------------------------- */
/* ERROR SANITIZATION                                                */
/* ---------------------------------------------------------------- */

export function sanitizeErrorDetails(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : 'Connection test failed'
  return rawMessage.replaceAll(/\/[\w./-]+/g, '[path]').slice(0, 500)
}
