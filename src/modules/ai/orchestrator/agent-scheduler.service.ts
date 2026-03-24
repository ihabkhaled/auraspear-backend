import { Injectable, Logger } from '@nestjs/common'
import { OrchestratorService } from './orchestrator.service'
import {
  AgentActionType,
  AiAgentId,
  AiTriggerMode,
  AppLogFeature,
  AppLogOutcome,
  AppLogSourceType,
} from '../../../common/enums'
import { AppLoggerService } from '../../../common/services/app-logger.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { AgentConfigService } from '../../agent-config/agent-config.service'

/**
 * Processes scheduled agent tasks and daily digests.
 * Intended to be called from a cron job or scheduler module.
 */
@Injectable()
export class AgentSchedulerService {
  private readonly logger = new Logger(AgentSchedulerService.name)

  constructor(
    private readonly orchestratorService: OrchestratorService,
    private readonly agentConfigService: AgentConfigService,
    private readonly prisma: PrismaService,
    private readonly appLogger: AppLoggerService
  ) {}

  /**
   * Iterates all tenant agent configs with `triggerMode: 'scheduled'`
   * and dispatches their tasks through the orchestrator.
   */
  async processScheduledAgents(): Promise<number> {
    const scheduledConfigs = await this.prisma.tenantAgentConfig.findMany({
      where: { isEnabled: true, triggerMode: AiTriggerMode.SCHEDULED },
      select: { tenantId: true, agentId: true },
    })

    const results = await Promise.allSettled(
      scheduledConfigs.map(config =>
        this.orchestratorService.dispatchAgentTask({
          tenantId: config.tenantId,
          agentId: config.agentId,
          actionType: AgentActionType.REVIEW,
          payload: { source: 'scheduler' },
          triggeredBy: 'system:scheduler',
        })
      )
    )

    const dispatched = this.logScheduledResults(results, scheduledConfigs)
    return dispatched
  }

  /**
   * Dispatches the reporting agent for each active tenant.
   * Intended to run once per day to generate daily digest reports.
   */
  async runDailyDigests(): Promise<number> {
    const tenants = await this.prisma.tenant.findMany({
      select: { id: true },
    })

    const results = await Promise.allSettled(
      tenants.map(tenant =>
        this.orchestratorService.dispatchAgentTask({
          tenantId: tenant.id,
          agentId: AiAgentId.REPORTING,
          actionType: AgentActionType.REPORT,
          payload: { type: 'daily_digest' },
          triggeredBy: 'system:scheduler',
        })
      )
    )

    return this.logDigestResults(results, tenants)
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Helpers                                                   */
  /* ---------------------------------------------------------------- */

  private logScheduledResults(
    results: PromiseSettledResult<unknown>[],
    configs: { tenantId: string; agentId: string }[]
  ): number {
    const dispatched = this.countSuccessful(results)

    for (let index = 0; index < results.length; index += 1) {
      const result = results.at(index)
      const config = configs.at(index)
      if (result?.status === 'rejected' && config) {
        this.logScheduledFailure(result, config)
      }
    }

    this.appLogger.info(`Scheduler processed ${String(dispatched)} scheduled agents`, {
      feature: AppLogFeature.AI,
      action: 'processScheduledAgents',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AgentSchedulerService',
      functionName: 'processScheduledAgents',
      metadata: { totalConfigs: configs.length, dispatched },
    })

    return dispatched
  }

  private logScheduledFailure(
    result: PromiseRejectedResult,
    config: { tenantId: string; agentId: string }
  ): void {
    const errorMessage = result.reason instanceof Error ? result.reason.message : 'Unknown error'
    this.appLogger.warn(
      `Scheduler failed to dispatch agent ${config.agentId} for tenant ${config.tenantId}: ${errorMessage}`,
      {
        feature: AppLogFeature.AI,
        action: 'processScheduledAgents',
        outcome: AppLogOutcome.FAILURE,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AgentSchedulerService',
        functionName: 'processScheduledAgents',
        tenantId: config.tenantId,
        metadata: { agentId: config.agentId, error: errorMessage },
      }
    )
  }

  private logDigestResults(
    results: PromiseSettledResult<unknown>[],
    tenants: { id: string }[]
  ): number {
    for (let index = 0; index < results.length; index += 1) {
      const result = results.at(index)
      const tenant = tenants.at(index)
      if (result?.status === 'rejected' && tenant) {
        const errorMessage =
          result.reason instanceof Error ? result.reason.message : 'Unknown error'
        this.appLogger.warn(`Daily digest failed for tenant ${tenant.id}: ${errorMessage}`, {
          feature: AppLogFeature.AI,
          action: 'runDailyDigests',
          outcome: AppLogOutcome.FAILURE,
          sourceType: AppLogSourceType.SERVICE,
          className: 'AgentSchedulerService',
          functionName: 'runDailyDigests',
          tenantId: tenant.id,
          metadata: { error: errorMessage },
        })
      }
    }
    return this.countSuccessful(results)
  }

  private countSuccessful(results: PromiseSettledResult<unknown>[]): number {
    return results.filter(r => r.status === 'fulfilled').length
  }
}
