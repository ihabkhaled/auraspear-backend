import { Injectable, Logger } from '@nestjs/common'
import {
  DETECTION_ALERT_SOURCE,
  DETECTION_SEVERITY_TO_ALERT_SEVERITY,
} from './detection-execution.constants'
import { AlertsRepository } from '../../alerts/alerts.repository'
import { DetectionRulesExecutor } from '../../detection-rules/detection-rules.executor'
import { DetectionRulesRepository } from '../../detection-rules/detection-rules.repository'
import type { DetectionRuleMatch } from '../../detection-rules/detection-rules.types'
import type { Job, Prisma, AlertSeverity as PrismaAlertSeverity } from '@prisma/client'

@Injectable()
export class DetectionExecutionHandler {
  private readonly logger = new Logger(DetectionExecutionHandler.name)

  constructor(
    private readonly detectionRulesRepository: DetectionRulesRepository,
    private readonly detectionRulesExecutor: DetectionRulesExecutor,
    private readonly alertsRepository: AlertsRepository
  ) {}

  async handle(job: Job): Promise<Record<string, unknown>> {
    const payload = job.payload as Record<string, unknown> | null
    const ruleId = payload?.['ruleId'] as string | undefined

    if (!ruleId) {
      throw new Error('ruleId is required in job payload')
    }

    const rule = await this.detectionRulesRepository.findByIdAndTenant(ruleId, job.tenantId)

    if (!rule) {
      throw new Error(`Detection rule ${ruleId} not found for tenant ${job.tenantId}`)
    }

    if (rule.status !== 'active') {
      this.logger.warn(
        `Detection rule ${ruleId} is not active (status=${rule.status}), skipping execution`
      )
      return {
        ruleId,
        ruleName: rule.name,
        skipped: true,
        reason: `Rule status is ${rule.status}`,
      }
    }

    this.logger.log(
      `Executing detection rule "${rule.name}" (${rule.ruleType}) for tenant ${job.tenantId}`
    )

    // Execute rule against events (empty array as foundation for real event ingestion)
    const events: Record<string, unknown>[] = []
    const result = await this.detectionRulesExecutor.evaluateRule(
      {
        id: rule.id,
        name: rule.name,
        severity: rule.severity,
        conditions: rule.conditions as Record<string, unknown>,
      },
      events
    )

    // Update rule metrics if matched
    if (result.status === 'matched' && result.matchCount > 0) {
      await this.detectionRulesRepository.updateMany({
        where: { id: ruleId, tenantId: job.tenantId },
        data: {
          hitCount: rule.hitCount + result.matchCount,
          lastTriggeredAt: new Date(),
        },
      })

      // Create alerts for each match
      const alertsCreated = await this.createAlertsFromMatches(
        job.tenantId,
        rule.ruleNumber,
        result.matches
      )

      return {
        ruleId,
        ruleName: rule.name,
        ruleType: rule.ruleType,
        status: result.status,
        matchCount: result.matchCount,
        alertsCreated,
        engine: result.engine,
        durationMs: result.durationMs,
        executedAt: result.executedAt,
      }
    }

    return {
      ruleId,
      ruleName: rule.name,
      ruleType: rule.ruleType,
      status: result.status,
      matchCount: result.matchCount,
      alertsCreated: 0,
      engine: result.engine,
      durationMs: result.durationMs,
      executedAt: result.executedAt,
    }
  }

  private async createAlertsFromMatches(
    tenantId: string,
    ruleNumber: string,
    matches: DetectionRuleMatch[]
  ): Promise<number> {
    const alertData = matches.map(match => {
      const alertSeverity =
        Reflect.get(DETECTION_SEVERITY_TO_ALERT_SEVERITY, match.severity) ?? 'medium'

      return {
        tenantId,
        title: `Detection: ${match.ruleName}`,
        description: match.description,
        severity: alertSeverity as PrismaAlertSeverity,
        source: DETECTION_ALERT_SOURCE,
        ruleName: match.ruleName,
        ruleId: ruleNumber,
        rawEvent: match.matchedEvent as Prisma.InputJsonValue,
        timestamp: new Date(match.matchedAt),
      }
    })

    const results = await Promise.all(
      alertData.map(data =>
        this.alertsRepository
          .create(data)
          .then(() => true)
          .catch((error: unknown) => {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error'
            this.logger.error(
              `Failed to create alert for detection match (rule=${ruleNumber}): ${errorMessage}`
            )

            return false
          })
      )
    )

    const created = results.filter(Boolean).length

    if (created > 0) {
      this.logger.log(
        `Created ${String(created)} alert(s) from detection rule ${ruleNumber} in tenant ${tenantId}`
      )
    }

    return created
  }
}
