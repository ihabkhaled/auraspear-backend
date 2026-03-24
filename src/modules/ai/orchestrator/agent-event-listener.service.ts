import { Injectable, Logger } from '@nestjs/common'
import { OrchestratorService } from './orchestrator.service'
import {
  AgentActionType,
  AiAgentId,
  AppLogFeature,
  AppLogOutcome,
  AppLogSourceType,
} from '../../../common/enums'
import { AppLoggerService } from '../../../common/services/app-logger.service'

/**
 * Listens for domain events and dispatches agent tasks via the orchestrator.
 * All methods are fire-and-forget — they never throw and never block the caller.
 */
@Injectable()
export class AgentEventListenerService {
  private readonly logger = new Logger(AgentEventListenerService.name)

  constructor(
    private readonly orchestratorService: OrchestratorService,
    private readonly appLogger: AppLoggerService
  ) {}

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
      this.logEventDispatched('onAlertCreated', tenantId, { alertId })
    } catch (error) {
      this.logEventError('onAlertCreated', tenantId, error, { alertId })
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
      this.logEventDispatched('onIncidentStatusChanged', tenantId, { incidentId, newStatus })
    } catch (error) {
      this.logEventError('onIncidentStatusChanged', tenantId, error, { incidentId, newStatus })
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
      this.logEventDispatched('onJobFailed', tenantId, { jobId, jobType })
    } catch (error) {
      this.logEventError('onJobFailed', tenantId, error, { jobId, jobType })
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
      this.logEventDispatched('onConnectorSyncCompleted', tenantId, { connectorId, connectorType })
    } catch (error) {
      this.logEventError('onConnectorSyncCompleted', tenantId, error, {
        connectorId,
        connectorType,
      })
    }
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Logging                                                   */
  /* ---------------------------------------------------------------- */

  private logEventDispatched(
    event: string,
    tenantId: string,
    metadata: Record<string, unknown>
  ): void {
    this.appLogger.info(`Agent event dispatched: ${event}`, {
      feature: AppLogFeature.AI,
      action: event,
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AgentEventListenerService',
      functionName: event,
      tenantId,
      metadata,
    })
  }

  private logEventError(
    event: string,
    tenantId: string,
    error: unknown,
    metadata: Record<string, unknown>
  ): void {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    this.appLogger.warn(`Agent event dispatch failed (non-blocking): ${event} — ${errorMessage}`, {
      feature: AppLogFeature.AI,
      action: event,
      outcome: AppLogOutcome.FAILURE,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AgentEventListenerService',
      functionName: event,
      tenantId,
      stackTrace: error instanceof Error ? error.stack : undefined,
      metadata: { ...metadata, error: errorMessage },
    })
  }
}
