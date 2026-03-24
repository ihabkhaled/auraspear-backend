import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { OrchestratorService } from './orchestrator.service'
import { AgentActionType, AiAgentId, AiTriggerMode, AppLogFeature } from '../../../common/enums'
import { AppLoggerService } from '../../../common/services/app-logger.service'
import { ServiceLogger } from '../../../common/services/service-logger'
import { PrismaService } from '../../../prisma/prisma.service'
import { AgentConfigService } from '../../agent-config/agent-config.service'

/**
 * Processes scheduled agent tasks and daily digests.
 * Intended to be called from a cron job or scheduler module.
 */
@Injectable()
export class AgentSchedulerService {
  private readonly log: ServiceLogger

  constructor(
    private readonly orchestratorService: OrchestratorService,
    private readonly agentConfigService: AgentConfigService,
    private readonly prisma: PrismaService,
    private readonly appLogger: AppLoggerService
  ) {
    this.log = new ServiceLogger(this.appLogger, AppLogFeature.AI, 'AgentSchedulerService')
  }

  /**
   * Iterates all tenant agent configs with `triggerMode: 'scheduled'`
   * and dispatches their tasks through the orchestrator.
   */
  @Cron('0 */15 * * * *')
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

    const dispatched = this.countSuccessful(results)

    for (let index = 0; index < results.length; index += 1) {
      const result = results.at(index)
      const config = scheduledConfigs.at(index)
      if (result?.status === 'rejected' && config) {
        const errorMessage =
          result.reason instanceof Error ? result.reason.message : 'Unknown error'
        this.log.warn(
          'processScheduledAgents',
          config.tenantId,
          `Failed to dispatch agent ${config.agentId}: ${errorMessage}`,
          { agentId: config.agentId, error: errorMessage }
        )
      }
    }

    this.log.success('processScheduledAgents', 'system', {
      totalConfigs: scheduledConfigs.length,
      dispatched,
    })

    return dispatched
  }

  /**
   * Dispatches the reporting agent for each active tenant.
   * Intended to run once per day to generate daily digest reports.
   */
  @Cron('0 0 6 * * *')
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

    for (let index = 0; index < results.length; index += 1) {
      const result = results.at(index)
      const tenant = tenants.at(index)
      if (result?.status === 'rejected' && tenant) {
        const errorMessage =
          result.reason instanceof Error ? result.reason.message : 'Unknown error'
        this.log.warn('runDailyDigests', tenant.id, `Daily digest failed: ${errorMessage}`, {
          error: errorMessage,
        })
      }
    }

    return this.countSuccessful(results)
  }

  /**
   * Dispatches the provider-health agent for all tenants where it is enabled.
   * Runs every 5 minutes to monitor AI provider availability.
   */
  @Cron('0 */5 * * * *')
  async checkProviderHealth(): Promise<number> {
    const tenants = await this.prisma.tenant.findMany({
      select: { id: true },
    })

    const results = await Promise.allSettled(
      tenants.map(tenant =>
        this.orchestratorService.dispatchAgentTask({
          tenantId: tenant.id,
          agentId: AiAgentId.PROVIDER_HEALTH,
          actionType: AgentActionType.VALIDATE,
          payload: { source: 'scheduler:health-check' },
          triggeredBy: 'system:scheduler',
        })
      )
    )

    return this.countSuccessful(results)
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Helpers                                                   */
  /* ---------------------------------------------------------------- */

  private countSuccessful(results: PromiseSettledResult<unknown>[]): number {
    return results.filter(r => r.status === 'fulfilled').length
  }
}
