import {
  AiAgentSessionStatus,
  AlertSeverity,
  ServiceStatus,
  SoarExecutionStatus,
  SyncJobStatus,
} from '../../common/enums'
import type {
  AlertTrend,
  AlertTrendEntry,
  AlertTrendRow,
  ConnectorFailureRow,
  ConnectorRow,
  DashboardAiSessionStatusCounts,
  DashboardAiSessionStatusRow,
  DashboardAnalyticsOverview,
  DashboardAutomationQuality,
  DashboardAutomationMetrics,
  DashboardCaseAgingMetrics,
  DashboardConnectorFailureEntry,
  DashboardConnectorSyncStatusCounts,
  DashboardConnectorSyncStatusRow,
  DashboardConnectorSyncSummary,
  DashboardExposureSummary,
  DashboardGovernanceMetrics,
  DashboardIncidentStatusBreakdownEntry,
  DashboardInfrastructureMetrics,
  DashboardOperationsOverview,
  DashboardOverviewMetrics,
  DashboardRulePerformanceEntry,
  DashboardRulePerformanceSummary,
  DashboardRuntimeBacklog,
  DashboardSeverityCountRow,
  DashboardSoarStatusCounts,
  DashboardSoarStatusRow,
  DashboardThreatOperationsMetrics,
  DetectionRulePerformanceRow,
  MitreTechniqueEntry,
  MitreTechniqueRow,
  PaginationMetadata,
  PipelineEntry,
  RecentActivityItem,
  SeverityDistribution,
  SeverityDistributionEntry,
  TopAssetRow,
  TopTargetedAsset,
} from './dashboards.types'

export function calculateTrend(currentValue: number, previousValue: number): number {
  if (previousValue === 0) {
    return currentValue > 0 ? 100 : 0
  }

  return Math.round(((currentValue - previousValue) / previousValue) * 1000) / 10
}

export function calculateComplianceScore(
  passedControls: number,
  failedControls: number,
  notAssessedControls: number
): number {
  const totalControls = passedControls + failedControls + notAssessedControls
  if (totalControls === 0) {
    return 0
  }

  return Math.round((passedControls / totalControls) * 100)
}

function toUtcDateString(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function createEmptyAlertTrendEntry(date: string): AlertTrendEntry {
  return {
    date,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  }
}

export function buildAlertTrend(
  tenantId: string,
  days: number,
  rows: AlertTrendRow[],
  startDate?: Date,
  endDate?: Date
): AlertTrend {
  const trendMap = new Map<string, AlertTrendEntry>()
  const startKey = startDate ? toUtcDateString(startDate) : null
  const endKey = endDate ? toUtcDateString(endDate) : null

  if (startDate && endDate) {
    const cursor = new Date(startDate)

    while (cursor <= endDate) {
      const date = toUtcDateString(cursor)
      trendMap.set(date, createEmptyAlertTrendEntry(date))
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
  }

  for (const row of rows) {
    if ((startKey && row.date < startKey) || (endKey && row.date > endKey)) {
      continue
    }

    if (!trendMap.has(row.date)) {
      trendMap.set(row.date, createEmptyAlertTrendEntry(row.date))
    }

    const entry = trendMap.get(row.date)
    if (!entry) {
      continue
    }

    const count = Number(row.count)
    switch (row.severity) {
      case AlertSeverity.CRITICAL:
        entry.critical = count
        break
      case AlertSeverity.HIGH:
        entry.high = count
        break
      case AlertSeverity.MEDIUM:
        entry.medium = count
        break
      case AlertSeverity.LOW:
        entry.low = count
        break
      case AlertSeverity.INFO:
        entry.info = count
        break
    }
  }

  return {
    tenantId,
    days,
    trend: [...trendMap.values()].sort((left, right) => left.date.localeCompare(right.date)),
  }
}

export function buildSeverityDistribution(
  tenantId: string,
  rows: DashboardSeverityCountRow[]
): SeverityDistribution {
  let total = 0

  for (const row of rows) {
    total += row._count
  }

  const distribution: SeverityDistributionEntry[] = rows.map(row => ({
    severity: row.severity,
    count: row._count,
    percentage: total > 0 ? Math.round((row._count / total) * 1000) / 10 : 0,
  }))

  return {
    tenantId,
    distribution,
  }
}

export function buildMitreTechniques(rows: MitreTechniqueRow[]): MitreTechniqueEntry[] {
  return rows.map(row => ({
    id: row.technique,
    count: Number(row.count),
  }))
}

export function buildTopTargetedAssets(rows: TopAssetRow[]): TopTargetedAsset[] {
  return rows.map(row => ({
    hostname: row.hostname,
    alertCount: Number(row.alert_count),
    criticalCount: Number(row.critical_count),
    lastSeen: row.last_seen,
  }))
}

export function buildRecentActivityItems(
  notifications: RecentActivityItem[],
  pagination: PaginationMetadata
): { data: RecentActivityItem[]; pagination: PaginationMetadata } {
  return {
    data: notifications,
    pagination,
  }
}

export function buildPipelineEntries(rows: ConnectorRow[]): PipelineEntry[] {
  return rows.map(row => {
    let status = ServiceStatus.UNKNOWN

    if (row.lastTestOk === true) {
      status = ServiceStatus.HEALTHY
    } else if (row.lastTestOk === false) {
      status = ServiceStatus.DOWN
    }

    return {
      name: row.name,
      type: row.type,
      status,
      lastChecked: row.lastTestAt,
      lastError: row.lastError,
    }
  })
}

export function buildAnalyticsOverview(params: {
  tenantId: string
  overview: DashboardOverviewMetrics
  threatOperations: DashboardThreatOperationsMetrics
  automation: DashboardAutomationMetrics
  governance: DashboardGovernanceMetrics
  infrastructure: DashboardInfrastructureMetrics
}): DashboardAnalyticsOverview {
  return {
    tenantId: params.tenantId,
    overview: params.overview,
    threatOperations: params.threatOperations,
    automation: params.automation,
    governance: params.governance,
    infrastructure: params.infrastructure,
  }
}

export function calculateFalsePositiveRate(hitCount: number, falsePositiveCount: number): number {
  if (hitCount === 0) {
    return falsePositiveCount > 0 ? 100 : 0
  }

  return Math.round((falsePositiveCount / hitCount) * 1000) / 10
}

export function buildRulePerformanceEntries(
  rows: DetectionRulePerformanceRow[]
): DashboardRulePerformanceEntry[] {
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    hitCount: row.hitCount,
    falsePositiveCount: row.falsePositiveCount,
    falsePositiveRate: calculateFalsePositiveRate(row.hitCount, row.falsePositiveCount),
    lastTriggeredAt: row.lastTriggeredAt,
    createdAt: row.createdAt,
  }))
}

export function buildIncidentStatusBreakdown(
  rows: DashboardIncidentStatusBreakdownEntry[]
): DashboardIncidentStatusBreakdownEntry[] {
  return rows.filter(row => row.count > 0)
}

export function buildConnectorFailureEntries(
  rows: ConnectorFailureRow[]
): DashboardConnectorFailureEntry[] {
  return rows.map(row => ({
    connectorType: row.connectorType,
    failures: row.failures,
  }))
}

export function buildAiSessionStatusCounts(
  rows: DashboardAiSessionStatusRow[]
): DashboardAiSessionStatusCounts {
  let completed = 0
  let failed = 0
  let total = 0

  for (const row of rows) {
    total += row._count
    if (row.status === AiAgentSessionStatus.COMPLETED) {
      completed = row._count
    } else if (row.status === AiAgentSessionStatus.FAILED) {
      failed = row._count
    }
  }

  return { completed, failed, total }
}

export function buildSoarStatusCounts(rows: DashboardSoarStatusRow[]): DashboardSoarStatusCounts {
  let completed = 0
  let failed = 0

  for (const row of rows) {
    if (row.status === SoarExecutionStatus.COMPLETED) {
      completed = row._count
    } else if (row.status === SoarExecutionStatus.FAILED) {
      failed = row._count
    }
  }

  return { completed, failed }
}

export function buildConnectorSyncStatusCounts(
  rows: DashboardConnectorSyncStatusRow[]
): DashboardConnectorSyncStatusCounts {
  let completed = 0
  let failed = 0
  let running = 0

  for (const row of rows) {
    switch (row.status) {
      case SyncJobStatus.COMPLETED:
        completed = row._count
        break
      case SyncJobStatus.FAILED:
        failed = row._count
        break
      case SyncJobStatus.RUNNING:
        running = row._count
        break
    }
  }

  return { completed, failed, running }
}

export function buildCaseAgingMetrics(
  params: DashboardCaseAgingMetrics
): DashboardCaseAgingMetrics {
  return params
}

export function buildRulePerformanceSummary(params: {
  activeRules: number
  topRules: DetectionRulePerformanceRow[]
  noisyRules: DetectionRulePerformanceRow[]
}): DashboardRulePerformanceSummary {
  return {
    activeRules: params.activeRules,
    topRules: buildRulePerformanceEntries(params.topRules),
    noisyRules: buildRulePerformanceEntries(params.noisyRules),
  }
}

export function buildConnectorSyncSummary(params: {
  statusCounts: DashboardConnectorSyncStatusCounts
  topFailingConnectors: ConnectorFailureRow[]
}): DashboardConnectorSyncSummary {
  return {
    completedRuns7d: params.statusCounts.completed,
    failedRuns7d: params.statusCounts.failed,
    runningSyncs: params.statusCounts.running,
    topFailingConnectors: buildConnectorFailureEntries(params.topFailingConnectors),
  }
}

export function buildAutomationQuality(params: {
  aiStatusCounts: DashboardAiSessionStatusCounts
  averageAiDurationSeconds: number
  soarStatusCounts: DashboardSoarStatusCounts
  averageSoarCompletionRate: number
}): DashboardAutomationQuality {
  return {
    aiSessions24h: params.aiStatusCounts.total,
    successfulAiSessions24h: params.aiStatusCounts.completed,
    failedAiSessions24h: params.aiStatusCounts.failed,
    averageAiDurationSeconds: params.averageAiDurationSeconds,
    completedSoarRuns30d: params.soarStatusCounts.completed,
    failedSoarRuns30d: params.soarStatusCounts.failed,
    averageSoarCompletionRate: params.averageSoarCompletionRate,
  }
}

export function buildOperationsOverview(params: {
  tenantId: string
  incidentStatus: DashboardIncidentStatusBreakdownEntry[]
  caseAging: DashboardCaseAgingMetrics
  rulePerformance: DashboardRulePerformanceSummary
  connectorSync: DashboardConnectorSyncSummary
  runtimeBacklog: DashboardRuntimeBacklog
  automationQuality: DashboardAutomationQuality
  exposureSummary: DashboardExposureSummary
}): DashboardOperationsOverview {
  return {
    tenantId: params.tenantId,
    incidentStatus: buildIncidentStatusBreakdown(params.incidentStatus),
    caseAging: params.caseAging,
    rulePerformance: params.rulePerformance,
    connectorSync: params.connectorSync,
    runtimeBacklog: params.runtimeBacklog,
    automationQuality: params.automationQuality,
    exposureSummary: params.exposureSummary,
  }
}
