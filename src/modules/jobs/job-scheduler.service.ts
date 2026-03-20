import { Injectable } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'
import { JobType } from './enums/job.enums'
import { JobService } from './jobs.service'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../common/enums'
import { AppLoggerService } from '../../common/services/app-logger.service'
import { PrismaService } from '../../prisma/prisma.service'

const SCHEDULE_INTERVAL_MS = 5 * 60_000 // 5 minutes

@Injectable()
export class JobSchedulerService {
  constructor(
    private readonly jobService: JobService,
    private readonly prisma: PrismaService,
    private readonly appLogger: AppLoggerService
  ) {}

  /**
   * Every 5 minutes, enqueue detection and correlation rule execution jobs
   * for all active rules across all tenants.
   */
  @Interval(SCHEDULE_INTERVAL_MS)
  async scheduleRuleExecution(): Promise<void> {
    try {
      const detectionCount = await this.scheduleDetectionRules()
      const correlationCount = await this.scheduleCorrelationRules()

      if (detectionCount > 0 || correlationCount > 0) {
        this.appLogger.info(
          `Scheduled rule execution: ${String(detectionCount)} detection, ${String(correlationCount)} correlation`,
          {
            feature: AppLogFeature.JOBS,
            action: 'scheduleRuleExecution',
            outcome: AppLogOutcome.SUCCESS,
            sourceType: AppLogSourceType.CRON,
            className: 'JobSchedulerService',
            functionName: 'scheduleRuleExecution',
            metadata: {
              detectionRulesEnqueued: detectionCount,
              correlationRulesEnqueued: correlationCount,
              intervalMs: SCHEDULE_INTERVAL_MS,
            },
          }
        )
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      this.appLogger.error(`Scheduled rule execution failed: ${errorMessage}`, {
        feature: AppLogFeature.JOBS,
        action: 'scheduleRuleExecution',
        outcome: AppLogOutcome.FAILURE,
        sourceType: AppLogSourceType.CRON,
        className: 'JobSchedulerService',
        functionName: 'scheduleRuleExecution',
        stackTrace: error instanceof Error ? error.stack : undefined,
        metadata: { error: errorMessage },
      })
    }
  }

  private async scheduleDetectionRules(): Promise<number> {
    const activeRules = await this.prisma.detectionRule.findMany({
      where: { status: 'active' },
      select: { id: true, tenantId: true, name: true },
    })

    const currentWindow = this.getCurrentWindow()

    const results = await Promise.allSettled(
      activeRules.map(rule =>
        this.jobService.enqueue({
          tenantId: rule.tenantId,
          type: JobType.DETECTION_RULE_EXECUTION,
          payload: { ruleId: rule.id },
          maxAttempts: 1,
          idempotencyKey: `detection:${rule.id}:${currentWindow}`,
        })
      )
    )

    let enqueued = 0

    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') {
        enqueued += 1
      } else {
        const rule = activeRules.at(index)
        if (rule) {
          this.appLogger.warn(`Failed to enqueue detection rule ${rule.id}: ${result.reason}`, {
            feature: AppLogFeature.JOBS,
            action: 'scheduleDetectionRules',
            outcome: AppLogOutcome.WARNING,
            sourceType: AppLogSourceType.CRON,
            className: 'JobSchedulerService',
            functionName: 'scheduleDetectionRules',
            tenantId: rule.tenantId,
            targetResource: 'DetectionRule',
            targetResourceId: rule.id,
            metadata: { ruleName: rule.name, error: String(result.reason) },
          })
        }
      }
    }

    return enqueued
  }

  private async scheduleCorrelationRules(): Promise<number> {
    const activeRules = await this.prisma.correlationRule.findMany({
      where: { status: 'active' },
      select: { id: true, tenantId: true, title: true },
    })

    const currentWindow = this.getCurrentWindow()

    const results = await Promise.allSettled(
      activeRules.map(rule =>
        this.jobService.enqueue({
          tenantId: rule.tenantId,
          type: JobType.CORRELATION_RULE_EXECUTION,
          payload: { ruleId: rule.id },
          maxAttempts: 1,
          idempotencyKey: `correlation:${rule.id}:${currentWindow}`,
        })
      )
    )

    let enqueued = 0

    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') {
        enqueued += 1
      } else {
        const rule = activeRules.at(index)
        if (rule) {
          this.appLogger.warn(`Failed to enqueue correlation rule ${rule.id}: ${result.reason}`, {
            feature: AppLogFeature.JOBS,
            action: 'scheduleCorrelationRules',
            outcome: AppLogOutcome.WARNING,
            sourceType: AppLogSourceType.CRON,
            className: 'JobSchedulerService',
            functionName: 'scheduleCorrelationRules',
            tenantId: rule.tenantId,
            targetResource: 'CorrelationRule',
            targetResourceId: rule.id,
            metadata: { ruleTitle: rule.title, error: String(result.reason) },
          })
        }
      }
    }

    return enqueued
  }

  /**
   * Returns a time-window key (floored to the nearest 5 minutes) to use as
   * part of idempotency keys, preventing duplicate jobs within the same window.
   */
  private getCurrentWindow(): string {
    const now = Date.now()
    const windowMs = SCHEDULE_INTERVAL_MS
    const windowStart = Math.floor(now / windowMs) * windowMs
    return String(windowStart)
  }
}
