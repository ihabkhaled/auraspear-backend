import { REDACTED_PLACEHOLDER } from '../../common/utils/mask.utility'
import type { ConnectorResponse, ConnectorStats } from './connectors.types'
import type { ConnectorConfig } from '@prisma/client'

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

export function buildConnectorStats(connectors: ConnectorConfig[]): ConnectorStats {
  let enabledConnectors = 0
  let healthyConnectors = 0
  let failingConnectors = 0
  let untestedConnectors = 0

  for (const connector of connectors) {
    if (connector.enabled) {
      enabledConnectors += 1
    }

    if (connector.lastTestOk === true) {
      healthyConnectors += 1
      continue
    }

    if (connector.lastTestOk === false) {
      failingConnectors += 1
      continue
    }

    untestedConnectors += 1
  }

  return {
    totalConnectors: connectors.length,
    enabledConnectors,
    healthyConnectors,
    failingConnectors,
    untestedConnectors,
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

/* ---------------------------------------------------------------- */
/* REMOTE ERROR EXTRACTION                                           */
/* ---------------------------------------------------------------- */

/**
 * Maximum length for extracted remote error messages.
 * Prevents oversized third-party responses from bloating logs or API responses.
 */
const MAX_REMOTE_ERROR_LENGTH = 300

/**
 * Extracts a human-readable error message from a third-party service response body.
 *
 * Supports common error response formats:
 * - `{ error: "message" }` or `{ error: { message: "..." } }`
 * - `{ message: "..." }`
 * - `{ detail: "..." }` or `{ details: "..." }`
 * - `{ title: "...", detail: "..." }` (RFC 7807 / Wazuh style)
 * - `{ reason: "..." }`
 * - Plain string responses
 *
 * Returns an empty string if no meaningful message can be extracted.
 */
export function extractRemoteErrorMessage(data: unknown): string {
  if (typeof data === 'string') {
    return data.trim().slice(0, MAX_REMOTE_ERROR_LENGTH)
  }

  if (typeof data !== 'object' || data === null) {
    return ''
  }

  const body = data as Record<string, unknown>

  // Try { error: "message" } or { error: { message: "..." } }
  if (body.error !== undefined) {
    if (typeof body.error === 'string') {
      return body.error.slice(0, MAX_REMOTE_ERROR_LENGTH)
    }
    if (typeof body.error === 'object' && body.error !== null) {
      const nested = body.error as Record<string, unknown>
      if (typeof nested.message === 'string') {
        return nested.message.slice(0, MAX_REMOTE_ERROR_LENGTH)
      }
    }
  }

  // Try { message: "..." }
  if (typeof body.message === 'string') {
    return body.message.slice(0, MAX_REMOTE_ERROR_LENGTH)
  }

  // Try { title: "...", detail: "..." } (RFC 7807)
  if (typeof body.title === 'string' && typeof body.detail === 'string') {
    return `${body.title}: ${body.detail}`.slice(0, MAX_REMOTE_ERROR_LENGTH)
  }

  // Try { detail: "..." } or { details: "..." }
  if (typeof body.detail === 'string') {
    return body.detail.slice(0, MAX_REMOTE_ERROR_LENGTH)
  }
  if (typeof body.details === 'string') {
    return body.details.slice(0, MAX_REMOTE_ERROR_LENGTH)
  }

  // Try { reason: "..." }
  if (typeof body.reason === 'string') {
    return body.reason.slice(0, MAX_REMOTE_ERROR_LENGTH)
  }

  return ''
}

/**
 * Formats a standardised error string for when a third-party connector returns a non-success status.
 * Includes the HTTP status and any error message extracted from the response body.
 *
 * Example outputs:
 * - `Wazuh Manager returned status 401: Invalid credentials`
 * - `MISP returned status 403`
 */
export function formatRemoteError(serviceName: string, status: number, data: unknown): string {
  const remoteMessage = extractRemoteErrorMessage(data)
  const base = `${serviceName} returned status ${status}`
  return remoteMessage ? `${base}: ${remoteMessage}` : base
}

/* ---------------------------------------------------------------- */
/* TIMEOUT NORMALIZATION                                             */
/* ---------------------------------------------------------------- */

/**
 * Minimum allowed timeout in milliseconds.
 * Prevents accidental sub-second timeouts from breaking connections.
 */
const MINIMUM_TIMEOUT_MS = 5000

/**
 * Normalizes a user-configured timeout value to milliseconds.
 *
 * Users often configure timeout as seconds (e.g., `timeout: 60` for 60 seconds).
 * If the value is below 1000, it is assumed to be in seconds and converted to ms.
 * Values at or above 1000 are assumed to already be in milliseconds.
 *
 * A floor of 5000ms (5 seconds) is enforced to prevent impossibly short timeouts.
 */
export function normalizeTimeoutMs(value: number): number {
  const ms = value < 1000 ? value * 1000 : value
  return Math.max(ms, MINIMUM_TIMEOUT_MS)
}
