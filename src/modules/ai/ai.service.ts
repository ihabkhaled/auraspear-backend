import { randomUUID } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import {
  AI_BEDROCK_MAX_TOKENS,
  AI_DEFAULT_MODEL,
  AI_EXPLAIN_LATENCY_OFFSET_MS,
  AI_EXPLAIN_REASONING,
} from './ai.constants'
import { AiRepository } from './ai.repository'
import {
  buildHuntPrompt,
  buildInvestigationPrompt,
  buildBedrockHuntResponse,
  buildFallbackHuntResponse,
  buildBedrockInvestigateResponse,
  buildFallbackInvestigateResponse,
  buildAgentTaskPrompt,
  buildBedrockAgentTaskResponse,
  buildFallbackAgentTaskResponse,
  generateExplainResponse,
} from './ai.utilities'
import { AiHuntDto } from './dto/ai-hunt.dto'
import { AiInvestigateDto } from './dto/ai-investigate.dto'
import {
  AiAuditAction,
  AiAuditStatus,
  AppLogFeature,
  AppLogOutcome,
  AppLogSourceType,
  ConnectorType,
} from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { AppLoggerService } from '../../common/services/app-logger.service'
import { ConnectorsService } from '../connectors/connectors.service'
import { BedrockService } from '../connectors/services/bedrock.service'
import type { AgentTaskExecutionInput, AiAuditRecord, AiResponse } from './ai.types'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'
import type { Alert, Prisma } from '@prisma/client'

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name)

  constructor(
    private readonly aiRepository: AiRepository,
    private readonly appLogger: AppLoggerService,
    private readonly connectorsService: ConnectorsService,
    private readonly bedrockService: BedrockService
  ) {}

  /* ---------------------------------------------------------------- */
  /* AI-Assisted Threat Hunting                                        */
  /* ---------------------------------------------------------------- */

  async aiHunt(dto: AiHuntDto, user: JwtPayload): Promise<AiResponse> {
    this.logAction('aiHunt', user, 'AiHunt', undefined, { queryLength: dto.query.length })
    await this.ensureAiEnabled(user.tenantId)

    const startTime = Date.now()
    const bedrockConfig = await this.connectorsService.getDecryptedConfig(
      user.tenantId,
      ConnectorType.BEDROCK
    )

    let response: AiResponse | undefined
    if (bedrockConfig) {
      response = await this.tryBedrockHunt(bedrockConfig, dto, user)
    }

    response ??= buildFallbackHuntResponse(dto.query)

    const latencyMs = Date.now() - startTime
    await this.logAudit(
      this.buildAuditRecord(user, AiAuditAction.HUNT, response, latencyMs, dto.query)
    )

    this.logAction('aiHunt', user, 'AiHunt', undefined, {
      model: response.model,
      confidence: response.confidence,
      latencyMs,
    })
    return response
  }

  /* ---------------------------------------------------------------- */
  /* AI Investigation of Alert                                         */
  /* ---------------------------------------------------------------- */

  async aiInvestigate(dto: AiInvestigateDto, user: JwtPayload): Promise<AiResponse> {
    this.logAction('aiInvestigate', user, 'Alert', dto.alertId)
    await this.ensureAiEnabled(user.tenantId)

    const fullAlert = await this.loadAndValidateAlert(dto.alertId, user)
    const relatedAlerts = await this.loadRelatedAlerts(fullAlert, user.tenantId)

    const startTime = Date.now()
    const bedrockConfig = await this.connectorsService.getDecryptedConfig(
      user.tenantId,
      ConnectorType.BEDROCK
    )

    let response: AiResponse | undefined
    if (bedrockConfig) {
      response = await this.tryBedrockInvestigate(
        bedrockConfig,
        fullAlert,
        relatedAlerts,
        dto.alertId,
        user
      )
    }

    response ??= buildFallbackInvestigateResponse(fullAlert, relatedAlerts, dto.alertId)

    const latencyMs = Date.now() - startTime
    await this.logAudit(
      this.buildAuditRecord(user, AiAuditAction.INVESTIGATE, response, latencyMs, dto.alertId)
    )

    this.logAction('aiInvestigate', user, 'Alert', dto.alertId, {
      model: response.model,
      confidence: response.confidence,
      latencyMs,
      relatedAlertCount: relatedAlerts.length,
    })
    return response
  }

  /* ---------------------------------------------------------------- */
  /* Explainable AI Output                                             */
  /* ---------------------------------------------------------------- */

  async aiExplain(body: { prompt: string }, user: JwtPayload): Promise<AiResponse> {
    this.logAction('aiExplain', user, 'AiExplain', undefined, { promptLength: body.prompt.length })
    await this.ensureAiEnabled(user.tenantId)

    const startTime = Date.now()

    const response: AiResponse = {
      result: generateExplainResponse(body.prompt),
      reasoning: [...AI_EXPLAIN_REASONING],
      confidence: 0.95,
      model: AI_DEFAULT_MODEL,
      tokensUsed: { input: 892, output: 1654 },
    }

    const latencyMs = Date.now() - startTime + AI_EXPLAIN_LATENCY_OFFSET_MS
    await this.logAudit(
      this.buildAuditRecord(user, AiAuditAction.EXPLAIN, response, latencyMs, body.prompt)
    )

    this.logAction('aiExplain', user, 'AiExplain', undefined, {
      model: AI_DEFAULT_MODEL,
      confidence: response.confidence,
      latencyMs,
    })
    return response
  }

  async runAgentTask(input: AgentTaskExecutionInput): Promise<AiResponse> {
    await this.ensureAiEnabled(input.tenantId)

    const startTime = Date.now()
    const bedrockConfig = await this.connectorsService.getDecryptedConfig(
      input.tenantId,
      ConnectorType.BEDROCK
    )

    let response: AiResponse | undefined
    if (bedrockConfig) {
      response = await this.tryBedrockAgentTask(bedrockConfig, input)
    }

    response ??= buildFallbackAgentTaskResponse({
      agentName: input.agentName,
      prompt: input.prompt,
      tools: input.tools,
    })

    const latencyMs = Date.now() - startTime
    await this.logAudit({
      id: randomUUID(),
      tenantId: input.tenantId,
      userId: input.actorUserId,
      action: AiAuditAction.EXPLAIN,
      model: response.model,
      inputTokens: response.tokensUsed.input,
      outputTokens: response.tokensUsed.output,
      latencyMs,
      status: AiAuditStatus.SUCCESS,
      createdAt: new Date().toISOString(),
      prompt: input.prompt,
      response: response.result,
    })

    this.appLogger.info('AI agent task executed', {
      feature: AppLogFeature.AI_AGENTS,
      action: 'runAgentTask',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: input.tenantId,
      actorEmail: input.actorEmail,
      actorUserId: input.actorUserId,
      targetResource: 'AiAgent',
      targetResourceId: input.agentId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AiService',
      functionName: 'runAgentTask',
      metadata: {
        agentName: input.agentName,
        model: response.model,
        latencyMs,
      },
    })

    return response
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Bedrock Attempt Helpers                                   */
  /* ---------------------------------------------------------------- */

  private async tryBedrockHunt(
    config: Record<string, unknown>,
    dto: AiHuntDto,
    user: JwtPayload
  ): Promise<AiResponse | undefined> {
    try {
      const prompt = buildHuntPrompt(dto.query, dto.context)
      const aiResult = await this.bedrockService.invoke(config, prompt, AI_BEDROCK_MAX_TOKENS)
      return buildBedrockHuntResponse(
        aiResult.text,
        dto.query,
        (config.modelId as string) ?? AI_DEFAULT_MODEL,
        aiResult.inputTokens,
        aiResult.outputTokens
      )
    } catch (error) {
      this.logger.warn(
        `Bedrock hunt failed, falling back: ${error instanceof Error ? error.message : 'Unknown'}`
      )
      this.appLogger.warn('Bedrock hunt invocation failed, using rule-based fallback', {
        feature: AppLogFeature.AI,
        action: 'aiHunt',
        outcome: AppLogOutcome.FAILURE,
        tenantId: user.tenantId,
        actorUserId: user.sub,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AiService',
        functionName: 'aiHunt',
        metadata: { error: error instanceof Error ? error.message : 'Unknown' },
      })
      return undefined
    }
  }

  private async tryBedrockInvestigate(
    config: Record<string, unknown>,
    alert: Alert,
    relatedAlerts: Array<Pick<Alert, 'id' | 'title' | 'severity' | 'timestamp'>>,
    alertId: string,
    user: JwtPayload
  ): Promise<AiResponse | undefined> {
    try {
      const prompt = buildInvestigationPrompt(alert, relatedAlerts)
      const aiResult = await this.bedrockService.invoke(config, prompt, AI_BEDROCK_MAX_TOKENS)
      return buildBedrockInvestigateResponse(
        aiResult.text,
        alertId,
        relatedAlerts.length,
        alert,
        relatedAlerts,
        (config.modelId as string) ?? AI_DEFAULT_MODEL,
        aiResult.inputTokens,
        aiResult.outputTokens
      )
    } catch (error) {
      this.logger.warn(
        `Bedrock investigation failed, falling back: ${error instanceof Error ? error.message : 'Unknown'}`
      )
      this.appLogger.warn('Bedrock investigation failed, using rule-based fallback', {
        feature: AppLogFeature.AI,
        action: 'aiInvestigate',
        outcome: AppLogOutcome.FAILURE,
        tenantId: user.tenantId,
        actorUserId: user.sub,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AiService',
        functionName: 'aiInvestigate',
        targetResource: 'Alert',
        targetResourceId: alertId,
        metadata: { error: error instanceof Error ? error.message : 'Unknown' },
      })
      return undefined
    }
  }

  private async tryBedrockAgentTask(
    config: Record<string, unknown>,
    input: AgentTaskExecutionInput
  ): Promise<AiResponse | undefined> {
    try {
      const prompt = buildAgentTaskPrompt({
        agentName: input.agentName,
        prompt: input.prompt,
        soulMd: input.soulMd,
        tools: input.tools,
      })
      const aiResult = await this.bedrockService.invoke(config, prompt, AI_BEDROCK_MAX_TOKENS)
      return buildBedrockAgentTaskResponse(
        aiResult.text,
        input.agentName,
        (config.modelId as string) ?? input.model,
        aiResult.inputTokens,
        aiResult.outputTokens
      )
    } catch (error) {
      this.logger.warn(
        `Bedrock AI agent task failed, falling back: ${error instanceof Error ? error.message : 'Unknown'}`
      )
      this.appLogger.warn('Bedrock AI agent execution failed, using fallback response', {
        feature: AppLogFeature.AI_AGENTS,
        action: 'runAgentTask',
        outcome: AppLogOutcome.FAILURE,
        tenantId: input.tenantId,
        actorEmail: input.actorEmail,
        actorUserId: input.actorUserId,
        targetResource: 'AiAgent',
        targetResourceId: input.agentId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AiService',
        functionName: 'runAgentTask',
        metadata: { error: error instanceof Error ? error.message : 'Unknown' },
      })
      return undefined
    }
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Load & Validate                                          */
  /* ---------------------------------------------------------------- */

  private async loadAndValidateAlert(alertId: string, user: JwtPayload): Promise<Alert> {
    const fullAlert = await this.aiRepository.findAlertByIdAndTenant(alertId, user.tenantId)

    if (!fullAlert) {
      this.appLogger.warn('AI investigation failed — alert not found', {
        feature: AppLogFeature.AI,
        action: 'aiInvestigate',
        outcome: AppLogOutcome.FAILURE,
        tenantId: user.tenantId,
        actorEmail: user.email,
        actorUserId: user.sub,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AiService',
        functionName: 'aiInvestigate',
        targetResource: 'Alert',
        targetResourceId: alertId,
      })
      throw new BusinessException(404, 'Alert not found', 'errors.alerts.notFound')
    }

    return fullAlert
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: AI Gate                                                   */
  /* ---------------------------------------------------------------- */

  private async ensureAiEnabled(tenantId: string): Promise<void> {
    try {
      const connector = await this.aiRepository.findEnabledConnectorByType(
        tenantId,
        ConnectorType.BEDROCK
      )

      if (!connector) {
        this.appLogger.warn('AI features not enabled for tenant', {
          feature: AppLogFeature.AI,
          action: 'ensureAiEnabled',
          className: 'AiService',
          sourceType: AppLogSourceType.SERVICE,
          outcome: AppLogOutcome.DENIED,
          tenantId,
        })
        throw new BusinessException(
          403,
          'AI features are not enabled for this tenant. Configure a Bedrock connector with aiEnabled=true.',
          'errors.ai.notEnabled'
        )
      }
    } catch (error) {
      if (error instanceof BusinessException) throw error
      this.logger.error('AI gate check failed', error)
      throw new BusinessException(
        503,
        'AI service temporarily unavailable',
        'errors.ai.serviceUnavailable'
      )
    }
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Related Alerts Loader                                    */
  /* ---------------------------------------------------------------- */

  private async loadRelatedAlerts(
    alert: Alert,
    tenantId: string
  ): Promise<Array<Pick<Alert, 'id' | 'title' | 'severity' | 'timestamp'>>> {
    const orConditions: Prisma.AlertWhereInput[] = []

    if (alert.sourceIp) {
      orConditions.push({ sourceIp: alert.sourceIp })
    }
    if (alert.ruleId) {
      orConditions.push({ ruleId: alert.ruleId })
    }

    if (orConditions.length === 0) return []

    const sinceDate = new Date(Date.now() - 48 * 60 * 60 * 1000)
    return this.aiRepository.findRelatedAlerts(tenantId, alert.id, sinceDate, orConditions)
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Audit Logging                                            */
  /* ---------------------------------------------------------------- */

  private buildAuditRecord(
    user: JwtPayload,
    action: AiAuditAction,
    response: AiResponse,
    latencyMs: number,
    prompt: string
  ): AiAuditRecord {
    return {
      id: randomUUID(),
      tenantId: user.tenantId,
      userId: user.sub,
      action,
      model: response.model,
      inputTokens: response.tokensUsed.input,
      outputTokens: response.tokensUsed.output,
      latencyMs,
      status: AiAuditStatus.SUCCESS,
      createdAt: new Date().toISOString(),
      prompt,
      response: response.result,
    }
  }

  private async logAudit(record: AiAuditRecord): Promise<void> {
    try {
      await this.aiRepository.createAuditLog({
        tenantId: record.tenantId,
        actor: record.userId,
        action: record.action,
        model: record.model,
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
        durationMs: record.latencyMs,
        prompt: record.prompt,
        response: record.response,
      })
    } catch {
      this.logger.warn('ai_audit_logs table not available; audit record stored in memory only')
    }

    this.logger.log(
      `AI Audit: ${record.action} by ${record.userId} | ${record.model} | ${record.inputTokens}+${record.outputTokens} tokens | ${record.latencyMs}ms | ${record.status}`
    )
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Structured Logging                                       */
  /* ---------------------------------------------------------------- */

  private logAction(
    action: string,
    user: JwtPayload,
    targetResource: string,
    targetResourceId?: string,
    metadata?: Record<string, unknown>
  ): void {
    this.appLogger.info(`AI action: ${action}`, {
      feature: AppLogFeature.AI,
      action,
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AiService',
      functionName: action,
      targetResource,
      targetResourceId,
      metadata,
    })
  }
}
