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
  buildAiSessionStatusCounts,
  buildAlertTrend,
  buildAnalyticsOverview,
  buildAutomationQuality,
  buildConnectorSyncStatusCounts,
  buildConnectorSyncSummary,
  buildMitreTechniques,
  buildOperationsOverview,
  buildPipelineEntries,
  buildRecentActivityItems,
  buildRulePerformanceSummary,
  buildSeverityDistribution,
  buildSoarStatusCounts,
  buildTopTargetedAssets,
  calculateComplianceScore,
  calculateTrend,
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
  DashboardAnalyticsOverview,
  DashboardOperationsOverview,
  DashboardSummary,
  MitreTopTechniques,
  PipelineHealth,
  RecentActivityItem,
  RecentActivityResponse,
  SeverityDistribution,
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

    const now = new Date()
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const oneWeekAgo = new Date(
      now.getTime() - DASHBOARD_ANALYTICS_WINDOW_DAYS * 24 * 60 * 60 * 1000
    )
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

    const [
      openCases,
      alertsLast24h,
      resolvedLast24h,
      avgResolutionTime,
      alertsCurrentWeek,
      criticalCurrentWeek,
      casesCurrentWeek,
      mttrCurrentWeek,
      alertsPreviousWeek,
      criticalPreviousWeek,
      casesPreviousWeek,
      mttrPreviousWeek,
    ] = await Promise.all([
      this.dashboardsRepository.countOpenCases(tenantId),
      this.dashboardsRepository.countAlertsSince(tenantId, twentyFourHoursAgo),
      this.dashboardsRepository.countResolvedAlertsSince(tenantId, twentyFourHoursAgo),
      this.dashboardsRepository.getAvgResolutionMsSince(tenantId, oneWeekAgo),
      this.dashboardsRepository.countAlertsBetween(tenantId, oneWeekAgo, now),
      this.dashboardsRepository.countCriticalAlertsBetween(tenantId, oneWeekAgo, now),
      this.dashboardsRepository.countCasesCreatedBetween(tenantId, oneWeekAgo, now),
      this.dashboardsRepository.getAvgResolutionMsBetween(tenantId, oneWeekAgo, now),
      this.dashboardsRepository.countAlertsBetweenExclusiveEnd(tenantId, twoWeeksAgo, oneWeekAgo),
      this.dashboardsRepository.countCriticalAlertsBetweenExclusiveEnd(
        tenantId,
        twoWeeksAgo,
        oneWeekAgo
      ),
      this.dashboardsRepository.countCasesCreatedBetweenExclusiveEnd(
        tenantId,
        twoWeeksAgo,
        oneWeekAgo
      ),
      this.dashboardsRepository.getAvgResolutionMsBetweenExclusiveEnd(
        tenantId,
        twoWeeksAgo,
        oneWeekAgo
      ),
    ])

    const avgMs = avgResolutionTime[0]?.avg_ms ?? 0
    const mttrMinutes = Math.round(avgMs / 60_000)
    const mttrCurrentMs = mttrCurrentWeek[0]?.avg_ms ?? 0
    const mttrPreviousMs = mttrPreviousWeek[0]?.avg_ms ?? 0
    const enabledConnectors = await this.connectorsService.getEnabledConnectors(tenantId)

    return {
      tenantId,
      totalAlerts: alertsCurrentWeek,
      criticalAlerts: criticalCurrentWeek,
      openCases,
      alertsLast24h,
      resolvedLast24h,
      meanTimeToRespond: mttrMinutes > 0 ? `${mttrMinutes}m` : 'N/A',
      connectedSources: enabledConnectors.length,
      totalAlertsTrend: calculateTrend(alertsCurrentWeek, alertsPreviousWeek),
      criticalAlertsTrend: calculateTrend(criticalCurrentWeek, criticalPreviousWeek),
      openCasesTrend: calculateTrend(casesCurrentWeek, casesPreviousWeek),
      mttrTrend: calculateTrend(mttrCurrentMs, mttrPreviousMs),
    }
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
    const actorMap = new Map(actors.map(actor => [actor.id, actor]))

    const data: RecentActivityItem[] = notifications.map(notification => {
      const actor = actorMap.get(notification.actorUserId)

      return {
        id: notification.id,
        type: notification.type,
        actorName: actor?.name ?? 'Unknown',
        title: notification.title,
        message: notification.message,
        createdAt: notification.createdAt,
        isRead: notification.readAt !== null,
      }
    })

    const totalPages = Math.ceil(total / limit)

    return buildRecentActivityItems(data, {
      page: 1,
      limit,
      total,
      totalPages,
      hasNext: totalPages > 1,
      hasPrev: false,
    })
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

    const now = new Date()
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const sevenDaysAgo = new Date(
      now.getTime() - DASHBOARD_ANALYTICS_WINDOW_DAYS * 24 * 60 * 60 * 1000
    )
    const thirtyDaysAgo = new Date(
      now.getTime() - DASHBOARD_REPORTS_WINDOW_DAYS * 24 * 60 * 60 * 1000
    )

    const [
      alertsLast24h,
      resolvedLast24h,
      openCases,
      openIncidents,
      criticalVulnerabilities,
      highVulnerabilities,
      activeAttackPaths,
      onlineAgents,
      aiSessions24h,
      pendingJobs,
      runningJobs,
      failedJobs,
      totalJobs,
      delayedJobs,
      totalFrameworks,
      passedControls,
      failedControls,
      notAssessedControls,
      completedReports,
      generatedReports30d,
      availableTemplates,
      totalAlerts7d,
      criticalAlerts7d,
      enabledConnectors,
    ] = await Promise.all([
      this.dashboardsRepository.countAlertsSince(tenantId, twentyFourHoursAgo),
      this.dashboardsRepository.countResolvedAlertsSince(tenantId, twentyFourHoursAgo),
      this.dashboardsRepository.countOpenCases(tenantId),
      this.dashboardsRepository.countOpenIncidents(tenantId),
      this.dashboardsRepository.countVulnerabilitiesBySeverity(
        tenantId,
        VulnerabilitySeverity.CRITICAL
      ),
      this.dashboardsRepository.countVulnerabilitiesBySeverity(
        tenantId,
        VulnerabilitySeverity.HIGH
      ),
      this.dashboardsRepository.countAttackPathsByStatus(tenantId, AttackPathStatus.ACTIVE),
      this.dashboardsRepository.countAiAgentsByStatus(tenantId, AiAgentStatus.ONLINE),
      this.dashboardsRepository.countAiAgentSessionsSince(tenantId, twentyFourHoursAgo),
      this.dashboardsRepository.countJobsByStatus(tenantId, JobStatus.PENDING),
      this.dashboardsRepository.countJobsByStatus(tenantId, JobStatus.RUNNING),
      this.dashboardsRepository.countJobsByStatus(tenantId, JobStatus.FAILED),
      this.dashboardsRepository.countJobs(tenantId),
      this.dashboardsRepository.countDelayedJobs(tenantId, now),
      this.dashboardsRepository.countComplianceFrameworks(tenantId),
      this.dashboardsRepository.countComplianceControlsByStatus(
        tenantId,
        ComplianceControlStatus.PASSED
      ),
      this.dashboardsRepository.countComplianceControlsByStatus(
        tenantId,
        ComplianceControlStatus.FAILED
      ),
      this.dashboardsRepository.countComplianceControlsByStatus(
        tenantId,
        ComplianceControlStatus.NOT_ASSESSED
      ),
      this.dashboardsRepository.countCompletedReports(tenantId),
      this.dashboardsRepository.countCompletedReportsSince(tenantId, thirtyDaysAgo),
      this.dashboardsRepository.countAvailableReportTemplates(tenantId),
      this.dashboardsRepository.countAlertsBetween(tenantId, sevenDaysAgo, now),
      this.dashboardsRepository.countCriticalAlertsBetween(tenantId, sevenDaysAgo, now),
      this.dashboardsRepository.findEnabledConnectors(tenantId),
    ])

    const healthyConnectors = enabledConnectors.filter(
      connector => connector.lastTestOk === true
    ).length
    const failingConnectors = enabledConnectors.filter(
      connector => connector.lastTestOk === false
    ).length
    const complianceScore = calculateComplianceScore(
      passedControls,
      failedControls,
      notAssessedControls
    )

    return buildAnalyticsOverview({
      tenantId,
      overview: {
        alertsLast24h,
        resolvedLast24h,
        openCases,
        openIncidents,
        criticalVulnerabilities,
        connectedSources: enabledConnectors.length,
        completedReports,
      },
      threatOperations: {
        totalAlerts7d,
        criticalAlerts7d,
        openCases,
        openIncidents,
        criticalVulnerabilities,
        highVulnerabilities,
        activeAttackPaths,
      },
      automation: {
        onlineAgents,
        aiSessions24h,
        pendingJobs,
        runningJobs,
        failedJobs,
        healthyConnectors,
        failingConnectors,
      },
      governance: {
        totalFrameworks,
        passedControls,
        failedControls,
        notAssessedControls,
        complianceScore,
        availableTemplates,
      },
      infrastructure: {
        enabledConnectors: enabledConnectors.length,
        healthyConnectors,
        failingConnectors,
        totalJobs,
        delayedJobs,
        generatedReports30d,
      },
    })
  }

  async getOperationsOverview(tenantId: string): Promise<DashboardOperationsOverview> {
    this.logDashboardAction('getOperationsOverview', tenantId)

    const now = new Date()
    const sevenDaysAgo = new Date(
      now.getTime() - DASHBOARD_ANALYTICS_WINDOW_DAYS * 24 * 60 * 60 * 1000
    )
    const thirtyDaysAgo = new Date(
      now.getTime() - DASHBOARD_REPORTS_WINDOW_DAYS * 24 * 60 * 60 * 1000
    )
    const caseWarningThreshold = new Date(
      now.getTime() - DASHBOARD_CASE_WARNING_DAYS * 24 * 60 * 60 * 1000
    )
    const caseCriticalThreshold = new Date(
      now.getTime() - DASHBOARD_CASE_CRITICAL_DAYS * 24 * 60 * 60 * 1000
    )
    const staleRunningThreshold = new Date(
      now.getTime() - DASHBOARD_STALE_RUNNING_JOB_HOURS * 60 * 60 * 1000
    )

    const [
      incidentStatusRows,
      openCases,
      unassignedCases,
      agedOverSevenDays,
      agedOverFourteenDays,
      averageOpenCaseAge,
      activeRules,
      topRules,
      noisyRules,
      connectorSyncStatusRows,
      topFailingConnectors,
      pendingJobs,
      retryingJobs,
      failedJobs,
      staleRunningJobs,
      queuedConnectorSyncJobs,
      queuedReportJobs,
      aiSessionStatusRows,
      averageAiDuration,
      soarStatusRows,
      averageSoarCompletionRate,
      criticalVulnerabilities,
      exploitAvailableVulnerabilities,
      openCloudFindings,
      criticalCloudFindings,
      passedControls,
      failedControls,
    ] = await Promise.all([
      this.dashboardsRepository.groupIncidentsByStatus(tenantId),
      this.dashboardsRepository.countOpenCases(tenantId),
      this.dashboardsRepository.countUnassignedOpenCases(tenantId),
      this.dashboardsRepository.countOpenCasesOlderThan(tenantId, caseWarningThreshold),
      this.dashboardsRepository.countOpenCasesOlderThan(tenantId, caseCriticalThreshold),
      this.dashboardsRepository.getAverageOpenCaseAgeHours(tenantId),
      this.dashboardsRepository.countActiveDetectionRules(tenantId),
      this.dashboardsRepository.findTopDetectionRules(
        tenantId,
        DASHBOARD_TOP_DETECTION_RULES_LIMIT
      ),
      this.dashboardsRepository.findTopNoisyDetectionRules(
        tenantId,
        DASHBOARD_TOP_DETECTION_RULES_LIMIT
      ),
      this.dashboardsRepository.groupConnectorSyncJobsByStatusSince(tenantId, sevenDaysAgo),
      this.dashboardsRepository.getTopFailingConnectorTypes(
        tenantId,
        sevenDaysAgo,
        DASHBOARD_TOP_FAILING_CONNECTORS_LIMIT
      ),
      this.dashboardsRepository.countJobsByStatus(tenantId, JobStatus.PENDING),
      this.dashboardsRepository.countJobsByStatus(tenantId, JobStatus.RETRYING),
      this.dashboardsRepository.countJobsByStatus(tenantId, JobStatus.FAILED),
      this.dashboardsRepository.countStaleRunningJobs(tenantId, staleRunningThreshold),
      this.dashboardsRepository.countJobsByTypeAndStatuses(tenantId, JobType.CONNECTOR_SYNC, [
        ...QUEUED_JOB_STATUSES,
      ]),
      this.dashboardsRepository.countJobsByTypeAndStatuses(tenantId, JobType.REPORT_GENERATION, [
        ...QUEUED_JOB_STATUSES,
      ]),
      this.dashboardsRepository.groupAiAgentSessionsByStatusSince(tenantId, sevenDaysAgo),
      this.dashboardsRepository.getAverageAiSessionDurationMsSince(tenantId, sevenDaysAgo),
      this.dashboardsRepository.groupSoarExecutionsByStatusSince(tenantId, thirtyDaysAgo),
      this.dashboardsRepository.getAverageSoarCompletionRateSince(tenantId, thirtyDaysAgo),
      this.dashboardsRepository.countVulnerabilitiesBySeverity(
        tenantId,
        VulnerabilitySeverity.CRITICAL
      ),
      this.dashboardsRepository.countExploitAvailableVulnerabilities(tenantId),
      this.dashboardsRepository.countCloudFindingsByStatus(tenantId, CloudFindingStatus.OPEN),
      this.dashboardsRepository.countCloudFindingsBySeverity(
        tenantId,
        CloudFindingSeverity.CRITICAL
      ),
      this.dashboardsRepository.countComplianceControlsByStatus(
        tenantId,
        ComplianceControlStatus.PASSED
      ),
      this.dashboardsRepository.countComplianceControlsByStatus(
        tenantId,
        ComplianceControlStatus.FAILED
      ),
    ])

    const incidentStatus = incidentStatusRows.map(row => ({
      status: row.status,
      count: row._count,
    }))
    const connectorSyncStatusCounts = buildConnectorSyncStatusCounts(connectorSyncStatusRows)
    const aiSessionStatusCounts = buildAiSessionStatusCounts(aiSessionStatusRows)
    const soarStatusCounts = buildSoarStatusCounts(soarStatusRows)

    return buildOperationsOverview({
      tenantId,
      incidentStatus,
      caseAging: {
        openCases,
        unassignedCases,
        agedOverSevenDays,
        agedOverFourteenDays,
        meanOpenAgeHours: Math.round(averageOpenCaseAge[0]?.avg_hours ?? 0),
      },
      rulePerformance: buildRulePerformanceSummary({
        activeRules,
        topRules,
        noisyRules,
      }),
      connectorSync: buildConnectorSyncSummary({
        statusCounts: connectorSyncStatusCounts,
        topFailingConnectors,
      }),
      runtimeBacklog: {
        pendingJobs,
        retryingJobs,
        failedJobs,
        staleRunningJobs,
        queuedConnectorSyncJobs,
        queuedReportJobs,
      },
      automationQuality: buildAutomationQuality({
        aiStatusCounts: aiSessionStatusCounts,
        averageAiDurationSeconds: Math.round((averageAiDuration[0]?.avg_ms ?? 0) / 100) / 10,
        soarStatusCounts,
        averageSoarCompletionRate:
          Math.round((averageSoarCompletionRate[0]?.avg_percentage ?? 0) * 10) / 10,
      }),
      exposureSummary: {
        criticalVulnerabilities,
        exploitAvailableVulnerabilities,
        openCloudFindings,
        criticalCloudFindings,
        passedControls,
        failedControls,
      },
    })
  }
}
