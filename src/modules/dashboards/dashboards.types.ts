export interface DashboardSummary {
  tenantId: string
  totalAlerts: number
  criticalAlerts: number
  openCases: number
  alertsLast24h: number
  resolvedLast24h: number
  meanTimeToRespond: string
  connectedSources: number
  totalAlertsTrend: number
  criticalAlertsTrend: number
  openCasesTrend: number
  mttrTrend: number
}

export interface AlertTrendEntry {
  date: string
  critical: number
  high: number
  medium: number
  low: number
  info: number
}

export interface AlertTrend {
  tenantId: string
  days: number
  trend: AlertTrendEntry[]
}

export interface SeverityDistributionEntry {
  severity: string
  count: number
  percentage: number
}

export interface SeverityDistribution {
  tenantId: string
  distribution: SeverityDistributionEntry[]
}

export interface MitreTopTechniques {
  tenantId: string
  techniques: Array<{ id: string; count: number }>
}

export interface TopTargetedAsset {
  hostname: string
  alertCount: number
  criticalCount: number
  lastSeen: Date
}

export interface TopTargetedAssets {
  tenantId: string
  assets: TopTargetedAsset[]
}

export interface PipelineEntry {
  name: string
  type: string
  status: string
  lastChecked: Date | null
  lastError: string | null
}

export interface PipelineHealth {
  tenantId: string
  pipelines: PipelineEntry[]
}

export interface RecentActivityItem {
  id: string
  type: string
  actorName: string
  title: string
  message: string
  createdAt: Date
  isRead: boolean
}

export interface RecentActivityResponse {
  data: RecentActivityItem[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
}
