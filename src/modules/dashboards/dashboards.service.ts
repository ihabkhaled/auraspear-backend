import { Injectable } from '@nestjs/common'
import {
  DASHBOARD_ANALYTICS_WINDOW_DAYS,
  DASHBOARD_CASE_CRITICAL_DAYS,
  DASHBOARD_CASE_WARNING_DAYS,
  DASHBOARD_REPORTS_WINDOW_DAYS,
  DASHBOARD_TOP_DETECTION_RULES_LIMIT,
  DASHBOARD_TOP_FAILING_CONNECTORS_LIMIT,
  DASHBOARD_TOP_TARGETED_ASSETS_LIMIT,
  DASHBOARD_TOP_TECHNIQUES_LIMIT,
  DASHBOARD_STALE_RUNNING_JOB_HOURS,
  QUEUED_JOB_STATUSES,
} from './dashboards.constants'
import { DashboardsRepository } from './dashboards.repository'
import {
  buildAlertTrend,
  buildAnalyticsOverviewFromRawData,
  buildDashboardSummary,
  buildMitreTechniques,
  buildOperationsOverviewFromRawData,
  buildPipelineEntries,
  buildRecentActivityFromRawData,
  buildSeverityDistribution,
  buildTopTargetedAssets,
} from './dashboards.utilities'
import {
  AiAgentStatus,
  AppLogFeature,
  AppLogOutcome,
  AppLogSourceType,
  AttackPathStatus,
  CloudFindingSeverity,
  CloudFindingStatus,
  ComplianceControlStatus,
  VulnerabilitySeverity,
} from '../../common/enums'
import { AppLoggerService } from '../../common/services/app-logger.service'
import { ConnectorsService } from '../connectors/connectors.service'
import { JobStatus, JobType } from '../jobs/enums/job.enums'
import type {
  AlertTrend,
  AnalyticsRawData,
  AvgHoursRow,
  AvgMsRow,
  AvgPercentageRow,
  ConnectorFailureRow,
  DashboardAiSessionStatusRow,
  DashboardAnalyticsOverview,
  DashboardConnectorSyncStatusRow,
  DashboardIncidentStatusCountRow,
  DashboardOperationsOverview,
  DashboardSoarStatusRow,
  DashboardSummary,
  DetectionRulePerformanceRow,
  MitreTopTechniques,
  OperationsRawData,
  PipelineHealth,
  RecentActivityResponse,
  SeverityDistribution,
  SummaryRawData,
  TopTargetedAssets,
} from './dashboards.types'

@Injectable()
export class DashboardsService {
  constructor(
    private readonly dashboardsRepository: DashboardsRepository,
    private readonly connectorsService: ConnectorsService,
    private readonly appLogger: AppLoggerService
  ) {}

  private logDashboardAction(
    action: string,
    tenantId: string,
    metadata?: Record<string, number | string>
  ): void {
    this.appLogger.debug(`Fetching ${action}`, {
      feature: AppLogFeature.DASHBOARD,
      action,
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'DashboardsService',
      functionName: action,
      metadata,
    })
  }

  async getSummary(tenantId: string): Promise<DashboardSummary> {
    this.logDashboardAction('getSummary', tenantId)

    const rawData = await this.fetchSummaryRawData(tenantId)
    const enabledConnectors = await this.connectorsService.getEnabledConnectors(tenantId)

    return buildDashboardSummary(tenantId, {
      ...rawData,
      connectedSources: enabledConnectors.length,
    })
  }

  private async fetchSummaryRawData(
    tenantId: string
  ): Promise<Omit<SummaryRawData, 'connectedSources'>> {
    const now = new Date()
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const oneWeekAgo = new Date(
      now.getTime() - DASHBOARD_ANALYTICS_WINDOW_DAYS * 24 * 60 * 60 * 1000
    )
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

    const [currentPeriod, previousPeriod] = await Promise.all([
      this.fetchSummaryCurrentPeriod(tenantId, twentyFourHoursAgo, oneWeekAgo, now),
      this.fetchSummaryPreviousPeriod(tenantId, twoWeeksAgo, oneWeekAgo),
    ])

    return { ...currentPeriod, ...previousPeriod }
  }

  private async fetchSummaryCurrentPeriod(
    tenantId: string,
    since24h: Date,
    sinceWeek: Date,
    now: Date
  ): Promise<Pick<SummaryRawData, 'openCases' | 'alertsLast24h' | 'resolvedLast24h' | 'avgResolutionTime' | 'alertsCurrentWeek' | 'criticalCurrentWeek' | 'casesCurrentWeek' | 'mttrCurrentWeek'>> {
    const [
      openCases, alertsLast24h, resolvedLast24h, avgResolutionTime,
      alertsCurrentWeek, criticalCurrentWeek, casesCurrentWeek, mttrCurrentWeek,
    ] = await Promise.all([
      this.dashboardsRepository.countOpenCases(tenantId),
      this.dashboardsRepository.countAlertsSince(tenantId, since24h),
      this.dashboardsRepository.countResolvedAlertsSince(tenantId, since24h),
      this.dashboardsRepository.getAvgResolutionMsSince(tenantId, sinceWeek),
      this.dashboardsRepository.countAlertsBetween(tenantId, sinceWeek, now),
      this.dashboardsRepository.countCriticalAlertsBetween(tenantId, sinceWeek, now),
      this.dashboardsRepository.countCasesCreatedBetween(tenantId, sinceWeek, now),
      this.dashboardsRepository.getAvgResolutionMsBetween(tenantId, sinceWeek, now),
    ])

    return {
      openCases, alertsLast24h, resolvedLast24h, avgResolutionTime,
      alertsCurrentWeek, criticalCurrentWeek, casesCurrentWeek, mttrCurrentWeek,
    }
  }

  private async fetchSummaryPreviousPeriod(
    tenantId: string,
    twoWeeksAgo: Date,
    oneWeekAgo: Date
  ): Promise<Pick<SummaryRawData, 'alertsPreviousWeek' | 'criticalPreviousWeek' | 'casesPreviousWeek' | 'mttrPreviousWeek'>> {
    const [alertsPreviousWeek, criticalPreviousWeek, casesPreviousWeek, mttrPreviousWeek] =
      await Promise.all([
        this.dashboardsRepository.countAlertsBetweenExclusiveEnd(tenantId, twoWeeksAgo, oneWeekAgo),
        this.dashboardsRepository.countCriticalAlertsBetweenExclusiveEnd(tenantId, twoWeeksAgo, oneWeekAgo),
        this.dashboardsRepository.countCasesCreatedBetweenExclusiveEnd(tenantId, twoWeeksAgo, oneWeekAgo),
        this.dashboardsRepository.getAvgResolutionMsBetweenExclusiveEnd(tenantId, twoWeeksAgo, oneWeekAgo),
      ])

    return { alertsPreviousWeek, criticalPreviousWeek, casesPreviousWeek, mttrPreviousWeek }
  }

  async getAlertTrend(tenantId: string, days: number): Promise<AlertTrend> {
    this.logDashboardAction('getAlertTrend', tenantId, { days })

    const todayUtc = new Date()
    todayUtc.setUTCHours(0, 0, 0, 0)

    const sinceUtc = new Date(todayUtc)
    sinceUtc.setUTCDate(sinceUtc.getUTCDate() - (days - 1))

    const untilUtc = new Date(todayUtc)
    untilUtc.setUTCDate(untilUtc.getUTCDate() + 1)

    const results = await this.dashboardsRepository.getAlertCountsByDateAndSeverity(
      tenantId,
      sinceUtc,
      untilUtc
    )

    return buildAlertTrend(tenantId, days, results, sinceUtc, todayUtc)
  }

  async getSeverityDistribution(tenantId: string): Promise<SeverityDistribution> {
    this.logDashboardAction('getSeverityDistribution', tenantId)

    const since = new Date(Date.now() - DASHBOARD_ANALYTICS_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    const counts = await this.dashboardsRepository.groupAlertsBySeveritySince(tenantId, since)

    return buildSeverityDistribution(tenantId, counts)
  }

  async getMitreTopTechniques(tenantId: string): Promise<MitreTopTechniques> {
    this.logDashboardAction('getMitreTopTechniques', tenantId)

    const since = new Date(Date.now() - DASHBOARD_ANALYTICS_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    const results = await this.dashboardsRepository.getTopMitreTechniques(tenantId, since)

    return {
      tenantId,
      techniques: buildMitreTechniques(results).slice(0, DASHBOARD_TOP_TECHNIQUES_LIMIT),
    }
  }

  async getTopTargetedAssets(tenantId: string): Promise<TopTargetedAssets> {
    this.logDashboardAction('getTopTargetedAssets', tenantId)

    const since = new Date(Date.now() - DASHBOARD_ANALYTICS_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    const results = await this.dashboardsRepository.getTopTargetedAssets(tenantId, since)

    return {
      tenantId,
      assets: buildTopTargetedAssets(results).slice(0, DASHBOARD_TOP_TARGETED_ASSETS_LIMIT),
    }
  }

  async getRecentActivity(tenantId: string, limit: number): Promise<RecentActivityResponse> {
    this.logDashboardAction('getRecentActivity', tenantId, { limit })

    const [notifications, total] = await Promise.all([
      this.dashboardsRepository.findRecentNotifications(tenantId, limit),
      this.dashboardsRepository.countNotifications(tenantId),
    ])

    const actorIds = [...new Set(notifications.map(notification => notification.actorUserId))]
    const actors =
      actorIds.length > 0 ? await this.dashboardsRepository.findUsersByIds(actorIds) : []

    return buildRecentActivityFromRawData({ notifications, actors, total, limit })
  }

  async getPipelineHealth(tenantId: string): Promise<PipelineHealth> {
    this.logDashboardAction('getPipelineHealth', tenantId)

    const connectors = await this.dashboardsRepository.findEnabledConnectors(tenantId)

    return {
      tenantId,
      pipelines: buildPipelineEntries(connectors),
    }
  }

  async getAnalyticsOverview(tenantId: string): Promise<DashboardAnalyticsOverview> {
    this.logDashboardAction('getAnalyticsOverview', tenantId)

    const rawData = await this.fetchAnalyticsRawData(tenantId)

    return buildAnalyticsOverviewFromRawData(rawData)
  }

  private async fetchAnalyticsRawData(
    tenantId: string
  ): Promise<AnalyticsRawData> {
    const now = new Date()
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const sevenDaysAgo = new Date(now.getTime() - DASHBOARD_ANALYTICS_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    const thirtyDaysAgo = new Date(now.getTime() - DASHBOARD_REPORTS_WINDOW_DAYS * 24 * 60 * 60 * 1000)

    const [threats, automation, governance, infrastructure] = await Promise.all([
      this.fetchAnalyticsThreatData(tenantId, twentyFourHoursAgo, sevenDaysAgo, now),
      this.fetchAnalyticsAutomationData(tenantId, twentyFourHoursAgo, now),
      this.fetchAnalyticsGovernanceData(tenantId, thirtyDaysAgo),
      this.dashboardsRepository.findEnabledConnectors(tenantId),
    ])

    return { tenantId, ...threats, ...automation, ...governance, enabledConnectors: infrastructure }
  }

  private async fetchAnalyticsThreatData(
    tenantId: string,
    since24h: Date,
    since7d: Date,
    now: Date
  ): Promise<{
    alertsLast24h: number; resolvedLast24h: number; openCases: number; openIncidents: number
    criticalVulnerabilities: number; highVulnerabilities: number; activeAttackPaths: number
    totalAlerts7d: number; criticalAlerts7d: number
  }> {
    const [alertsLast24h, resolvedLast24h, openCases, openIncidents,
      criticalVulnerabilities, highVulnerabilities, activeAttackPaths,
      totalAlerts7d, criticalAlerts7d] = await this.fetchThreatCounts(tenantId, since24h, since7d, now)

    return {
      alertsLast24h, resolvedLast24h, openCases, openIncidents,
      criticalVulnerabilities, highVulnerabilities, activeAttackPaths,
      totalAlerts7d, criticalAlerts7d,
    }
  }

  private async fetchThreatCounts(
    tenantId: string,
    since24h: Date,
    since7d: Date,
    now: Date
  ): Promise<[number, number, number, number, number, number, number, number, number]> {
    return Promise.all([
      this.dashboardsRepository.countAlertsSince(tenantId, since24h),
      this.dashboardsRepository.countResolvedAlertsSince(tenantId, since24h),
      this.dashboardsRepository.countOpenCases(tenantId),
      this.dashboardsRepository.countOpenIncidents(tenantId),
      this.dashboardsRepository.countVulnerabilitiesBySeverity(tenantId, VulnerabilitySeverity.CRITICAL),
      this.dashboardsRepository.countVulnerabilitiesBySeverity(tenantId, VulnerabilitySeverity.HIGH),
      this.dashboardsRepository.countAttackPathsByStatus(tenantId, AttackPathStatus.ACTIVE),
      this.dashboardsRepository.countAlertsBetween(tenantId, since7d, now),
      this.dashboardsRepository.countCriticalAlertsBetween(tenantId, since7d, now),
    ])
  }

  private async fetchAnalyticsAutomationData(
    tenantId: string,
    since24h: Date,
    now: Date
  ): Promise<{
    onlineAgents: number; aiSessions24h: number; pendingJobs: number; runningJobs: number
    failedJobs: number; totalJobs: number; delayedJobs: number
  }> {
    const [onlineAgents, aiSessions24h, pendingJobs, runningJobs, failedJobs, totalJobs, delayedJobs] =
      await Promise.all([
        this.dashboardsRepository.countAiAgentsByStatus(tenantId, AiAgentStatus.ONLINE),
        this.dashboardsRepository.countAiAgentSessionsSince(tenantId, since24h),
        this.dashboardsRepository.countJobsByStatus(tenantId, JobStatus.PENDING),
        this.dashboardsRepository.countJobsByStatus(tenantId, JobStatus.RUNNING),
        this.dashboardsRepository.countJobsByStatus(tenantId, JobStatus.FAILED),
        this.dashboardsRepository.countJobs(tenantId),
        this.dashboardsRepository.countDelayedJobs(tenantId, now),
      ])

    return { onlineAgents, aiSessions24h, pendingJobs, runningJobs, failedJobs, totalJobs, delayedJobs }
  }

  private async fetchAnalyticsGovernanceData(
    tenantId: string,
    since30d: Date
  ): Promise<{
    totalFrameworks: number; passedControls: number; failedControls: number
    notAssessedControls: number; completedReports: number; generatedReports30d: number
    availableTemplates: number
  }> {
    const [totalFrameworks, passedControls, failedControls, notAssessedControls, completedReports, generatedReports30d, availableTemplates] =
      await Promise.all([
        this.dashboardsRepository.countComplianceFrameworks(tenantId),
        this.dashboardsRepository.countComplianceControlsByStatus(tenantId, ComplianceControlStatus.PASSED),
        this.dashboardsRepository.countComplianceControlsByStatus(tenantId, ComplianceControlStatus.FAILED),
        this.dashboardsRepository.countComplianceControlsByStatus(tenantId, ComplianceControlStatus.NOT_ASSESSED),
        this.dashboardsRepository.countCompletedReports(tenantId),
        this.dashboardsRepository.countCompletedReportsSince(tenantId, since30d),
        this.dashboardsRepository.countAvailableReportTemplates(tenantId),
      ])

    return { totalFrameworks, passedControls, failedControls, notAssessedControls, completedReports, generatedReports30d, availableTemplates }
  }

  async getOperationsOverview(tenantId: string): Promise<DashboardOperationsOverview> {
    this.logDashboardAction('getOperationsOverview', tenantId)

    const rawData = await this.fetchOperationsRawData(tenantId)

    return buildOperationsOverviewFromRawData(rawData)
  }

  private async fetchOperationsRawData(
    tenantId: string
  ): Promise<OperationsRawData> {
    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - DASHBOARD_ANALYTICS_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    const thirtyDaysAgo = new Date(now.getTime() - DASHBOARD_REPORTS_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    const caseWarningThreshold = new Date(now.getTime() - DASHBOARD_CASE_WARNING_DAYS * 24 * 60 * 60 * 1000)
    const caseCriticalThreshold = new Date(now.getTime() - DASHBOARD_CASE_CRITICAL_DAYS * 24 * 60 * 60 * 1000)
    const staleRunningThreshold = new Date(now.getTime() - DASHBOARD_STALE_RUNNING_JOB_HOURS * 60 * 60 * 1000)

    const [caseAndIncident, rules, connectorAndJobs, aiAndSoar, exposure] = await Promise.all([
      this.fetchOpsCaseData(tenantId, caseWarningThreshold, caseCriticalThreshold),
      this.fetchOpsRuleData(tenantId),
      this.fetchOpsConnectorAndJobData(tenantId, sevenDaysAgo, staleRunningThreshold),
      this.fetchOpsAiAndSoarData(tenantId, sevenDaysAgo, thirtyDaysAgo),
      this.fetchOpsExposureData(tenantId),
    ])

    return { tenantId, ...caseAndIncident, ...rules, ...connectorAndJobs, ...aiAndSoar, ...exposure }
  }

  private async fetchOpsCaseData(
    tenantId: string,
    warningThreshold: Date,
    criticalThreshold: Date
  ): Promise<{
    incidentStatusRows: DashboardIncidentStatusCountRow[]
    openCases: number; unassignedCases: number
    agedOverSevenDays: number; agedOverFourteenDays: number
    averageOpenCaseAge: AvgHoursRow[]
  }> {
    const [incidentStatusRows, openCases, unassignedCases, agedOverSevenDays, agedOverFourteenDays, averageOpenCaseAge] =
      await Promise.all([
        this.dashboardsRepository.groupIncidentsByStatus(tenantId),
        this.dashboardsRepository.countOpenCases(tenantId),
        this.dashboardsRepository.countUnassignedOpenCases(tenantId),
        this.dashboardsRepository.countOpenCasesOlderThan(tenantId, warningThreshold),
        this.dashboardsRepository.countOpenCasesOlderThan(tenantId, criticalThreshold),
        this.dashboardsRepository.getAverageOpenCaseAgeHours(tenantId),
      ])

    return { incidentStatusRows, openCases, unassignedCases, agedOverSevenDays, agedOverFourteenDays, averageOpenCaseAge }
  }

  private async fetchOpsRuleData(tenantId: string): Promise<{
    activeRules: number
    topRules: DetectionRulePerformanceRow[]
    noisyRules: DetectionRulePerformanceRow[]
  }> {
    const [activeRules, topRules, noisyRules] = await Promise.all([
      this.dashboardsRepository.countActiveDetectionRules(tenantId),
      this.dashboardsRepository.findTopDetectionRules(tenantId, DASHBOARD_TOP_DETECTION_RULES_LIMIT),
      this.dashboardsRepository.findTopNoisyDetectionRules(tenantId, DASHBOARD_TOP_DETECTION_RULES_LIMIT),
    ])

    return { activeRules, topRules, noisyRules }
  }

  private async fetchOpsConnectorAndJobData(
    tenantId: string,
    sevenDaysAgo: Date,
    staleThreshold: Date
  ): Promise<{
    connectorSyncStatusRows: DashboardConnectorSyncStatusRow[]
    topFailingConnectors: ConnectorFailureRow[]
    pendingJobs: number; retryingJobs: number; failedJobs: number; staleRunningJobs: number
    queuedConnectorSyncJobs: number; queuedReportJobs: number
  }> {
    const [connectorSyncStatusRows, topFailingConnectors, pendingJobs, retryingJobs, failedJobs, staleRunningJobs, queuedConnectorSyncJobs, queuedReportJobs] =
      await Promise.all([
        this.dashboardsRepository.groupConnectorSyncJobsByStatusSince(tenantId, sevenDaysAgo),
        this.dashboardsRepository.getTopFailingConnectorTypes(tenantId, sevenDaysAgo, DASHBOARD_TOP_FAILING_CONNECTORS_LIMIT),
        this.dashboardsRepository.countJobsByStatus(tenantId, JobStatus.PENDING),
        this.dashboardsRepository.countJobsByStatus(tenantId, JobStatus.RETRYING),
        this.dashboardsRepository.countJobsByStatus(tenantId, JobStatus.FAILED),
        this.dashboardsRepository.countStaleRunningJobs(tenantId, staleThreshold),
        this.dashboardsRepository.countJobsByTypeAndStatuses(tenantId, JobType.CONNECTOR_SYNC, [...QUEUED_JOB_STATUSES]),
        this.dashboardsRepository.countJobsByTypeAndStatuses(tenantId, JobType.REPORT_GENERATION, [...QUEUED_JOB_STATUSES]),
      ])

    return { connectorSyncStatusRows, topFailingConnectors, pendingJobs, retryingJobs, failedJobs, staleRunningJobs, queuedConnectorSyncJobs, queuedReportJobs }
  }

  private async fetchOpsAiAndSoarData(
    tenantId: string,
    sevenDaysAgo: Date,
    thirtyDaysAgo: Date
  ): Promise<{
    aiSessionStatusRows: DashboardAiSessionStatusRow[]
    averageAiDuration: AvgMsRow[]
    soarStatusRows: DashboardSoarStatusRow[]
    averageSoarCompletionRate: AvgPercentageRow[]
  }> {
    const [aiSessionStatusRows, averageAiDuration, soarStatusRows, averageSoarCompletionRate] =
      await Promise.all([
        this.dashboardsRepository.groupAiAgentSessionsByStatusSince(tenantId, sevenDaysAgo),
        this.dashboardsRepository.getAverageAiSessionDurationMsSince(tenantId, sevenDaysAgo),
        this.dashboardsRepository.groupSoarExecutionsByStatusSince(tenantId, thirtyDaysAgo),
        this.dashboardsRepository.getAverageSoarCompletionRateSince(tenantId, thirtyDaysAgo),
      ])

    return { aiSessionStatusRows, averageAiDuration, soarStatusRows, averageSoarCompletionRate }
  }

  private async fetchOpsExposureData(tenantId: string): Promise<{
    criticalVulnerabilities: number; exploitAvailableVulnerabilities: number
    openCloudFindings: number; criticalCloudFindings: number
    passedControls: number; failedControls: number
  }> {
    const [criticalVulnerabilities, exploitAvailableVulnerabilities, openCloudFindings, criticalCloudFindings, passedControls, failedControls] =
      await Promise.all([
        this.dashboardsRepository.countVulnerabilitiesBySeverity(tenantId, VulnerabilitySeverity.CRITICAL),
        this.dashboardsRepository.countExploitAvailableVulnerabilities(tenantId),
        this.dashboardsRepository.countCloudFindingsByStatus(tenantId, CloudFindingStatus.OPEN),
        this.dashboardsRepository.countCloudFindingsBySeverity(tenantId, CloudFindingSeverity.CRITICAL),
        this.dashboardsRepository.countComplianceControlsByStatus(tenantId, ComplianceControlStatus.PASSED),
        this.dashboardsRepository.countComplianceControlsByStatus(tenantId, ComplianceControlStatus.FAILED),
      ])

    return { criticalVulnerabilities, exploitAvailableVulnerabilities, openCloudFindings, criticalCloudFindings, passedControls, failedControls }
  }
}
