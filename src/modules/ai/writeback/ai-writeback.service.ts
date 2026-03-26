import { Injectable } from '@nestjs/common'
import {
  ACTION_TYPE_TO_FINDING_TYPE,
  AI_NOTIFICATION_MESSAGE_MAX_LENGTH,
  AI_SUMMARY_MAX_LENGTH,
  SEVERITY_PATTERN,
} from './ai-writeback.constants'
import { AiWritebackRepository } from './ai-writeback.repository'
import {
  AiFindingStatus,
  AiFindingType,
  AlertSeverity,
  AppLogFeature,
  NotificationEntityType,
  NotificationType,
} from '../../../common/enums'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { UserRole } from '../../../common/interfaces/authenticated-request.interface'
import { AppLoggerService } from '../../../common/services/app-logger.service'
import { ServiceLogger } from '../../../common/services/service-logger'
import { PrismaService } from '../../../prisma/prisma.service'
import type {
  AiWritebackParameters,
  AiWritebackResponse,
  ParsedAiFinding,
} from './ai-writeback.types'
import type { AiExecutionFinding } from '@prisma/client'

@Injectable()
export class AiWritebackService {
  private readonly log: ServiceLogger

  constructor(
    private readonly prisma: PrismaService,
    private readonly appLogger: AppLoggerService,
    private readonly repository: AiWritebackRepository
  ) {
    this.log = new ServiceLogger(this.appLogger, AppLogFeature.AI, 'AiWritebackService')
  }

  /**
   * Get a single AI execution finding by ID.
   * Throws BusinessException if not found.
   */
  async getFindingById(tenantId: string, id: string): Promise<AiExecutionFinding> {
    const finding = await this.repository.getFindingById(tenantId, id)
    if (!finding) {
      throw new BusinessException(404, 'AI finding not found', 'errors.ai.findingNotFound')
    }
    return finding
  }

  /**
   * Process and persist results from a completed system-triggered AI run.
   * Called by AiAgentTaskHandler after successful AI execution.
   *
   * Writeback failures are logged but never re-thrown — they must not crash the job handler.
   */
  async processSystemTriggeredResult(params: AiWritebackParameters): Promise<void> {
    try {
      this.log.entry('processSystemTriggeredResult', params.tenantId, {
        sessionId: params.sessionId,
        agentId: params.agentId,
        sourceModule: params.sourceModule,
      })

      // 1. Parse structured findings from AI response
      const findings = this.parseFindings(params)

      // 2. Persist findings to ai_execution_findings table
      await this.persistFindings(
        params.tenantId,
        params.sessionId,
        params.agentId,
        params.sourceModule,
        params.sourceEntityId,
        findings
      )

      // 3. Write back to source entity (alert, case, incident, etc.)
      await this.writeBackToSource(params)

      // 4. Update session counts only when a real AiAgentSession record exists
      if (params.hasRealSession !== false) {
        await this.updateSessionCounts(params.sessionId, findings.length)
      }

      // 5. Create notification for tenant admin
      await this.createAiNotification({
        tenantId: params.tenantId,
        sourceModule: params.sourceModule,
        sourceEntityId: params.sourceEntityId,
        agentId: params.agentId,
        summary: params.aiResponse.result.substring(0, AI_NOTIFICATION_MESSAGE_MAX_LENGTH),
      })

      // 6. Persist job run summary for the AI Job Runs dashboard
      await this.persistJobRunSummary(params, findings.length)

      // 7. Log completion
      this.log.success('processSystemTriggeredResult', params.tenantId, {
        sessionId: params.sessionId,
        agentId: params.agentId,
        findingsCount: findings.length,
        sourceModule: params.sourceModule,
      })
    } catch (error) {
      this.log.error('processSystemTriggeredResult', params.tenantId, error, {
        sessionId: params.sessionId,
        agentId: params.agentId,
        sourceModule: params.sourceModule,
      })
    }
  }

  /**
   * Extract structured findings from the AI response text.
   * Falls back to a single summary finding when structured data cannot be parsed.
   */
  private parseFindings(params: AiWritebackParameters): ParsedAiFinding[] {
    const { aiResponse, actionType } = params
    const findingType = this.resolveFindingType(actionType)
    const severity = this.extractSeveritySuggestion(aiResponse.result)

    return [
      {
        findingType,
        title: `${actionType} result for ${params.sourceModule}`,
        summary: aiResponse.result.substring(0, AI_SUMMARY_MAX_LENGTH),
        confidence: aiResponse.confidence ?? null,
        severity,
        recommendedAction: null,
      },
    ]
  }

  private async persistFindings(
    tenantId: string,
    sessionId: string,
    agentId: string,
    sourceModule: string,
    sourceEntityId: string | undefined,
    findings: ParsedAiFinding[]
  ): Promise<void> {
    if (findings.length === 0) {
      return
    }

    const data = findings.map(finding => ({
      tenantId,
      sessionId,
      agentId,
      sourceModule,
      sourceEntityId: sourceEntityId ?? null,
      findingType: finding.findingType,
      title: finding.title,
      summary: finding.summary,
      confidenceScore: finding.confidence,
      severity: finding.severity,
      recommendedAction: finding.recommendedAction,
      status: AiFindingStatus.PROPOSED,
    }))

    await this.prisma.aiExecutionFinding.createMany({ data })
  }

  private async writeBackToSource(params: AiWritebackParameters): Promise<void> {
    const { sourceModule, sourceEntityId, tenantId, aiResponse, sessionId } = params

    if (!sourceEntityId) {
      this.log.debug(
        'writeBackToSource',
        tenantId,
        'No sourceEntityId provided, skipping source writeback'
      )
      return
    }

    switch (sourceModule) {
      case 'alert':
        await this.writeBackToAlert(tenantId, sourceEntityId, aiResponse, sessionId)
        break

      case 'incident':
        await this.writeBackToIncident(sourceEntityId, aiResponse)
        break

      case 'case':
        await this.writeBackToCase(sourceEntityId, aiResponse)
        break

      default:
        this.log.debug(
          'writeBackToSource',
          tenantId,
          `Unsupported source module "${sourceModule}", logging only`
        )
        break
    }
  }

  private async writeBackToAlert(
    tenantId: string,
    alertId: string,
    response: AiWritebackResponse,
    sessionId: string
  ): Promise<void> {
    await this.prisma.alert.updateMany({
      where: { id: alertId, tenantId },
      data: {
        aiSummary: response.result.substring(0, AI_SUMMARY_MAX_LENGTH),
        aiConfidence: response.confidence ?? null,
        aiSeveritySuggestion: this.extractSeveritySuggestion(response.result),
        aiLastRunAt: new Date(),
        aiLastExecutionId: sessionId,
        aiStatus: 'completed',
      },
    })
  }

  private async writeBackToIncident(
    incidentId: string,
    response: AiWritebackResponse
  ): Promise<void> {
    const summaryText = response.result.substring(0, AI_SUMMARY_MAX_LENGTH)

    await this.prisma.incidentTimeline.create({
      data: {
        incidentId,
        event: `AI analysis (${response.model}): ${summaryText}`,
        actorType: 'system',
        actorName: `AI/${response.provider}`,
      },
    })
  }

  private async writeBackToCase(caseId: string, response: AiWritebackResponse): Promise<void> {
    const summaryText = response.result.substring(0, AI_SUMMARY_MAX_LENGTH)

    await this.prisma.caseNote.create({
      data: {
        caseId,
        author: `AI/${response.provider}`,
        body: `**AI Analysis (${response.model}):**\n\n${summaryText}`,
      },
    })
  }

  private async persistJobRunSummary(
    params: AiWritebackParameters,
    findingsCount: number
  ): Promise<void> {
    try {
      const scheduleId = params.scheduleId ?? null
      await this.prisma.aiJobRunSummary.create({
        data: {
          tenantId: params.tenantId,
          jobId: params.sessionId,
          scheduleId,
          jobKey: `agent.${params.agentId}`,
          agentId: params.agentId,
          triggerType: params.sourceModule.startsWith('scheduler:') ? 'scheduled' : 'manual',
          status: 'completed',
          startedAt: new Date(Date.now() - (params.durationMs ?? 0)),
          completedAt: new Date(),
          durationMs: params.durationMs ?? null,
          providerKey: params.aiResponse.provider,
          modelKey: params.aiResponse.model,
          tokensUsed:
            (params.aiResponse.tokensUsed?.input ?? 0) +
            (params.aiResponse.tokensUsed?.output ?? 0),
          findingsCount,
          sourceModule: params.sourceModule,
          sourceEntityId: params.sourceEntityId ?? null,
          summaryText: params.aiResponse.result.substring(0, 500),
          confidenceScore: params.aiResponse.confidence ?? null,
        },
      })
    } catch (error) {
      this.log.warn(
        'persistJobRunSummary',
        params.tenantId,
        `Failed to persist run summary: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  private async updateSessionCounts(sessionId: string, findingsCount: number): Promise<void> {
    try {
      await this.prisma.aiAgentSession.update({
        where: { id: sessionId },
        data: {
          findingsCount,
          writebacksCount: findingsCount > 0 ? 1 : 0,
        },
      })
    } catch (error) {
      // Session may not exist for config-only agents — log and continue
      this.log.warn(
        'updateSessionCounts',
        'unknown',
        `Failed to update session counts for ${sessionId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Create a notification for the tenant admin when an AI analysis completes.
   * Notification failures are logged but never re-thrown.
   */
  private async createAiNotification(params: {
    tenantId: string
    sourceModule: string
    sourceEntityId?: string
    agentId: string
    summary: string
  }): Promise<void> {
    try {
      // Find the first active TENANT_ADMIN for the tenant
      const adminMembership = await this.prisma.tenantMembership.findFirst({
        where: {
          tenantId: params.tenantId,
          role: UserRole.TENANT_ADMIN,
          status: 'active',
        },
        select: { userId: true },
      })

      if (!adminMembership) {
        this.log.debug(
          'createAiNotification',
          params.tenantId,
          'No active TENANT_ADMIN found, skipping notification'
        )
        return
      }

      const entityType = this.resolveNotificationEntityType(params.sourceModule)
      // entityId column is @db.Uuid — only set if sourceEntityId is present
      const entityId = params.sourceEntityId ?? params.tenantId

      await this.prisma.notification.create({
        data: {
          tenantId: params.tenantId,
          type: NotificationType.AI_ANALYSIS_COMPLETE,
          actorUserId: null,
          recipientUserId: adminMembership.userId,
          title: `AI Analysis Complete: ${params.agentId} (${params.sourceModule})`,
          message: params.summary,
          entityType,
          entityId,
        },
      })

      this.log.debug('createAiNotification', params.tenantId, 'AI notification created', {
        recipientUserId: adminMembership.userId,
        sourceModule: params.sourceModule,
      })
    } catch (error) {
      // Notification failures must never crash writebacks
      this.log.warn(
        'createAiNotification',
        params.tenantId,
        `Failed to create AI notification: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Map a source module string to the appropriate NotificationEntityType.
   */
  private resolveNotificationEntityType(sourceModule: string): string {
    switch (sourceModule) {
      case 'alert':
        return NotificationEntityType.ALERT
      case 'incident':
        return NotificationEntityType.INCIDENT
      case 'case':
        return NotificationEntityType.CASE
      default:
        return sourceModule
    }
  }

  /**
   * Map an action type string to the appropriate AiFindingType enum value.
   */
  private resolveFindingType(actionType: string): AiFindingType {
    return ACTION_TYPE_TO_FINDING_TYPE.get(actionType) ?? AiFindingType.OTHER
  }

  /**
   * Extract a severity suggestion from the AI response text by looking for
   * known AlertSeverity values.
   */
  private extractSeveritySuggestion(text: string): string | null {
    const match = SEVERITY_PATTERN.exec(text)
    if (!match) {
      return null
    }

    const matched = match[0]?.toLowerCase()
    switch (matched) {
      case AlertSeverity.CRITICAL:
        return AlertSeverity.CRITICAL
      case AlertSeverity.HIGH:
        return AlertSeverity.HIGH
      case AlertSeverity.MEDIUM:
        return AlertSeverity.MEDIUM
      case AlertSeverity.LOW:
        return AlertSeverity.LOW
      case AlertSeverity.INFO:
        return AlertSeverity.INFO
      default:
        return null
    }
  }
}
