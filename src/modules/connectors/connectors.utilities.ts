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
