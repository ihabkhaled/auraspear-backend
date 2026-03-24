import { Injectable } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'
import { JobType } from './enums/job.enums'
import { SCHEDULE_INTERVAL_MS } from './jobs.constants'
import { JobService } from './jobs.service'
import { countScheduleResults, getCurrentScheduleWindow } from './jobs.utilities'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../common/enums'
import { AppLoggerService } from '../../common/services/app-logger.service'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class JobSchedulerService {
  private readonly enabled: boolean

  constructor(
    private readonly jobService: JobService,
    private readonly prisma: PrismaService,
    private readonly appLogger: AppLoggerService
  ) {
    // Only enable automatic scheduling when ENABLE_JOB_SCHEDULER=true
    // Without real event ingestion, auto-scheduling creates noise
    this.enabled = process.env['ENABLE_JOB_SCHEDULER'] === 'true'
  }

  /**
   * Every 5 minutes, enqueue detection and correlation rule execution jobs
   * for all active rules across all tenants.
   * Only runs when ENABLE_JOB_SCHEDULER=true.
   */
  @Interval(SCHEDULE_INTERVAL_MS)
  async scheduleRuleExecution(): Promise<void> {
    if (!this.enabled) return
    try {
      const detectionCount = await this.scheduleDetectionRules()
      const correlationCount = await this.scheduleCorrelationRules()
      this.logScheduleSuccess(detectionCount, correlationCount)
    } catch (error) {
      this.logScheduleError(error)
    }
  }

  private async scheduleDetectionRules(): Promise<number> {
    const activeRules = await this.prisma.detectionRule.findMany({
      where: { status: 'active' },
      select: { id: true, tenantId: true, name: true },
    })

    const currentWindow = getCurrentScheduleWindow()
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

    const { enqueued, rejectedIndices } = countScheduleResults(results)
    this.logRejectedRules(rejectedIndices, activeRules, 'scheduleDetectionRules', 'DetectionRule')
    return enqueued
  }

  private async scheduleCorrelationRules(): Promise<number> {
    const activeRules = await this.prisma.correlationRule.findMany({
      where: { status: 'active' },
      select: { id: true, tenantId: true, title: true },
    })

    const currentWindow = getCurrentScheduleWindow()
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

    const { enqueued, rejectedIndices } = countScheduleResults(results)
    this.logRejectedRules(
      rejectedIndices,
      activeRules,
      'scheduleCorrelationRules',
      'CorrelationRule'
    )
    return enqueued
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Logging                                                  */
  /* ---------------------------------------------------------------- */

  private logRejectedRules(
    rejectedIndices: number[],
    rules: Array<{ id: string; tenantId: string; name?: string; title?: string }>,
    functionName: string,
    resourceName: string
  ): void {
    for (const index of rejectedIndices) {
      const rule = rules.at(index)
      if (rule) {
        this.appLogger.warn(`Failed to enqueue ${resourceName} ${rule.id}`, {
          feature: AppLogFeature.JOBS,
          action: functionName,
          outcome: AppLogOutcome.WARNING,
          sourceType: AppLogSourceType.CRON,
          className: 'JobSchedulerService',
          functionName,
          tenantId: rule.tenantId,
          targetResource: resourceName,
          targetResourceId: rule.id,
          metadata: { ruleName: rule.name ?? rule.title },
        })
      }
    }
  }

  private logScheduleSuccess(detectionCount: number, correlationCount: number): void {
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
  }

  private logScheduleError(error: unknown): void {
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
