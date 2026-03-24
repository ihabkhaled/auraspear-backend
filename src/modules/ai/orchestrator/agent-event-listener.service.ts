import { Injectable } from '@nestjs/common'
import { OrchestratorService } from './orchestrator.service'
import { AgentActionType, AiAgentId, AppLogFeature } from '../../../common/enums'
import { AppLoggerService } from '../../../common/services/app-logger.service'
import { ServiceLogger } from '../../../common/services/service-logger'

/**
 * Listens for domain events and dispatches agent tasks via the orchestrator.
 * All methods are fire-and-forget — they never throw and never block the caller.
 */
@Injectable()
export class AgentEventListenerService {
  private readonly log: ServiceLogger

  constructor(
    private readonly orchestratorService: OrchestratorService,
    private readonly appLogger: AppLoggerService
  ) {
    this.log = new ServiceLogger(this.appLogger, AppLogFeature.AI, 'AgentEventListenerService')
  }

  /**
   * Called after a new alert is persisted.
   * Dispatches the alert-triage agent to auto-triage the alert.
   */
  async onAlertCreated(tenantId: string, alertId: string): Promise<void> {
    try {
      await this.orchestratorService.dispatchAgentTask({
        tenantId,
        agentId: AiAgentId.ALERT_TRIAGE,
        actionType: AgentActionType.TRIAGE,
        payload: { alertId },
        triggeredBy: 'system:event-listener',
      })
      this.log.success('onAlertCreated', tenantId, { alertId })
    } catch (error) {
      this.log.error('onAlertCreated', tenantId, error, { alertId })
    }
  }

  /**
   * Called after an incident status changes (e.g., escalation).
   * Dispatches the incident-escalation agent.
   */
  async onIncidentStatusChanged(
    tenantId: string,
    incidentId: string,
    newStatus: string
  ): Promise<void> {
    try {
      await this.orchestratorService.dispatchAgentTask({
        tenantId,
        agentId: AiAgentId.INCIDENT_ESCALATION,
        actionType: AgentActionType.ESCALATE,
        payload: { incidentId, newStatus },
        triggeredBy: 'system:event-listener',
      })
      this.log.success('onIncidentStatusChanged', tenantId, { incidentId, newStatus })
    } catch (error) {
      this.log.error('onIncidentStatusChanged', tenantId, error, { incidentId, newStatus })
    }
  }

  /**
   * Called after a job fails permanently (no more retries).
   * Dispatches the job-health agent for diagnosis.
   */
  async onJobFailed(tenantId: string, jobId: string, jobType: string): Promise<void> {
    try {
      await this.orchestratorService.dispatchAgentTask({
        tenantId,
        agentId: AiAgentId.JOB_HEALTH,
        actionType: AgentActionType.INVESTIGATE,
        payload: { jobId, jobType },
        triggeredBy: 'system:event-listener',
      })
      this.log.success('onJobFailed', tenantId, { jobId, jobType })
    } catch (error) {
      this.log.error('onJobFailed', tenantId, error, { jobId, jobType })
    }
  }

  /**
   * Called after a connector sync completes successfully.
   * Dispatches the orchestrator agent to process sync results.
   */
  async onConnectorSyncCompleted(
    tenantId: string,
    connectorId: string,
    connectorType: string
  ): Promise<void> {
    try {
      await this.orchestratorService.dispatchAgentTask({
        tenantId,
        agentId: AiAgentId.ORCHESTRATOR,
        actionType: AgentActionType.SYNC,
        payload: { connectorId, connectorType },
        triggeredBy: 'system:event-listener',
      })
      this.log.success('onConnectorSyncCompleted', tenantId, { connectorId, connectorType })
    } catch (error) {
      this.log.error('onConnectorSyncCompleted', tenantId, error, {
        connectorId,
        connectorType,
      })
    }
  }
}
