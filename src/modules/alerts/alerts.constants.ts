import { AlertSeverity, AlertStatus } from '../../common/enums'

export const VALID_SEVERITIES = new Set<string>(Object.values(AlertSeverity))
export const VALID_STATUSES = new Set<string>(Object.values(AlertStatus))
