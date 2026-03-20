import { mapAlertToOcsfFinding } from '../../../common/ocsf'
import type { OcsfSecurityFinding } from '../../../common/ocsf'

/**
 * Maps InfluxDB alert level to a severity string.
 * InfluxDB Kapacitor levels: OK, INFO, WARNING, CRITICAL
 */
function getInfluxDatabaseSeverity(level: string): string {
  const normalized = level.toUpperCase()
  switch (normalized) {
    case 'CRITICAL':
    case 'CRIT':
      return 'critical'
    case 'WARNING':
    case 'WARN':
      return 'high'
    case 'INFO':
      return 'info'
    case 'OK':
      return 'low'
    default:
      return 'medium'
  }
}

/**
 * Maps an InfluxDB monitoring alert to OCSF SecurityFinding format.
 *
 * InfluxDB alerts (via Kapacitor or InfluxDB tasks) include fields like:
 * id, message, details, level, time, duration, data, previousLevel,
 * _check_name, _measurement, _source_measurement.
 */
export function mapInfluxDatabaseToOcsf(
  event: Record<string, unknown>,
  tenantId?: string
): OcsfSecurityFinding {
  const level = (event['level'] as string) ?? (event['_level'] as string) ?? ''
  const title =
    (event['message'] as string) ??
    (event['_check_name'] as string) ??
    (event['id'] as string) ??
    'InfluxDB Alert'

  const description = (event['details'] as string) ?? (event['data'] as string) ?? undefined

  const measurement =
    (event['_source_measurement'] as string) ?? (event['_measurement'] as string) ?? undefined

  return mapAlertToOcsfFinding({
    title,
    description,
    severity: getInfluxDatabaseSeverity(level),
    timestamp: (event['time'] as string) ?? (event['_time'] as string) ?? new Date().toISOString(),
    source: { product: 'InfluxDB', vendor: 'InfluxData' },
    tenantId,
    eventId: (event['id'] as string) ?? (event['_check_id'] as string) ?? undefined,
    rawData: JSON.stringify(event),
    affectedAsset: (event['host'] as string) ?? measurement ?? undefined,
  })
}
