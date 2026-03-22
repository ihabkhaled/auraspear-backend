import { MAX_REMOTE_ERROR_LENGTH, MINIMUM_TIMEOUT_MS, URL_KEYS } from './connectors.constants'
import { REDACTED_PLACEHOLDER } from '../../common/utils/mask.utility'
import type {
  ChatCompletionContentBlock,
  ConnectorResponse,
  ConnectorRow,
  ConnectorStats,
  VelociraptorAuthOptions,
} from './connectors.types'
import type { AxiosRequestOptions } from '../../common/modules/axios'
import type { ConnectorConfig } from '@prisma/client'

/* ---------------------------------------------------------------- */
/* CONNECTOR → RESPONSE MAPPING                                      */
/* ---------------------------------------------------------------- */

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
  const hints: Record<number, string> = {
    400: 'Bad request — check the model name and parameters',
    401: 'Authentication failed — check your API key',
    403: 'Access denied — your API key may lack permissions',
    404: 'Endpoint not found — check the base URL',
    429: 'Rate limited — too many requests, try again later',
    500: 'Internal server error on the provider side',
    502: 'Bad gateway — the provider may be down',
    503: 'Service unavailable — the provider may be overloaded',
  }
  const remoteMessage = extractRemoteErrorMessage(data)
  const hint = Reflect.get(hints, status) as string | undefined
  const base = `${serviceName} returned status ${String(status)}`
  const parts = [base]
  if (hint) {
    parts.push(hint)
  }
  if (remoteMessage) {
    parts.push(remoteMessage)
  }
  return parts.join('. ')
}

/* ---------------------------------------------------------------- */
/* TIMEOUT NORMALIZATION                                             */
/* ---------------------------------------------------------------- */

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

/* ---------------------------------------------------------------- */
/* CHAT COMPLETION CONTENT EXTRACTION                                 */
/* ---------------------------------------------------------------- */

/**
 * Extracts plain text from a chat completion `content` field.
 *
 * OpenAI-compatible APIs may return `content` as either a plain string or
 * an array of typed content blocks (`{ type: 'text', text: '…' }`).
 * This function normalizes both shapes into a single string.
 */
export function extractChatCompletionText(
  content: string | ChatCompletionContentBlock[] | undefined | null
): string {
  if (typeof content === 'string') return content

  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const block of content) {
      if (block.type === 'text' && block.text) {
        parts.push(block.text)
      }
    }
    return parts.join('')
  }

  return ''
}

/* ---------------------------------------------------------------- */
/* VELOCIRAPTOR HELPERS                                               */
/* ---------------------------------------------------------------- */

/**
 * Resolves the Velociraptor base URL from config.
 * Prefers `apiUrl`, falls back to `baseUrl`.
 */
export function resolveVelociraptorBaseUrl(config: Record<string, unknown>): string | undefined {
  return (config.apiUrl ?? config.baseUrl) as string | undefined
}

/**
 * Builds authentication options for Velociraptor requests.
 *
 * Supports two auth modes:
 * 1. **mTLS** (preferred for API port 8001) — uses `clientCert` + `clientKey`
 * 2. **Basic auth** (GUI port 8889) — uses `username` + `password`
 */
export function buildVelociraptorAuthOptions(
  config: Record<string, unknown>,
  basicAuthFunction: (username: string, password: string) => string
): VelociraptorAuthOptions {
  const clientCert = config.clientCert as string | undefined
  const clientKey = config.clientKey as string | undefined
  const caCert = config.caCert as string | undefined
  const username = config.username as string | undefined
  const password = config.password as string | undefined

  const headers: Record<string, string> = {}
  const httpOptions: Partial<AxiosRequestOptions> = {}

  if (clientCert && clientKey) {
    // mTLS authentication for the gRPC gateway API (port 8001)
    httpOptions.clientCert = clientCert
    httpOptions.clientKey = clientKey
    if (caCert) {
      httpOptions.caCert = caCert
    }
  } else if (username && password) {
    // Basic auth for the GUI REST API (port 8889)
    headers.Authorization = basicAuthFunction(username, password)
  }

  return { headers, httpOptions }
}
