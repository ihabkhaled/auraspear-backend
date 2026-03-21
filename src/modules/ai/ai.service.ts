import { randomUUID } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import {
  AI_BEDROCK_MAX_TOKENS,
  AI_CONNECTOR_PRIORITY,
  AI_DEFAULT_MODEL,
  AI_LLM_APIS_MAX_TOKENS,
  AI_OPENCLAW_MAX_TOKENS,
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
  buildBedrockExplainResponse,
  buildLlmApisHuntResponse,
  buildLlmApisInvestigateResponse,
  buildLlmApisAgentTaskResponse,
  buildLlmApisExplainResponse,
  buildOpenClawHuntResponse,
  buildOpenClawInvestigateResponse,
  buildOpenClawAgentTaskResponse,
  buildOpenClawExplainResponse,
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
import { LlmApisService } from '../connectors/services/llm-apis.service'
import { OpenClawGatewayService } from '../connectors/services/openclaw-gateway.service'
import type {
  AgentTaskExecutionInput,
  AiAuditRecord,
  AiResponse,
  ResolvedAiConnector,
} from './ai.types'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'
import type { Alert, Prisma } from '@prisma/client'

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name)

  constructor(
    private readonly aiRepository: AiRepository,
    private readonly appLogger: AppLoggerService,
    private readonly connectorsService: ConnectorsService,
    private readonly bedrockService: BedrockService,
    private readonly llmApisService: LlmApisService,
    private readonly openClawGatewayService: OpenClawGatewayService
  ) {}

  /* ---------------------------------------------------------------- */
  /* AI-Assisted Threat Hunting                                        */
  /* ---------------------------------------------------------------- */

  async aiHunt(dto: AiHuntDto, user: JwtPayload): Promise<AiResponse> {
    this.logAction('aiHunt', user, 'AiHunt', undefined, { queryLength: dto.query.length })
    await this.ensureAiEnabled(user.tenantId)

    const startTime = Date.now()
    const connectors = await this.findAvailableAiConnectors(user.tenantId)
    const response =
      (await this.tryConnectorsInOrder(connectors, c => this.routeHunt(c, dto, user))) ??
      buildFallbackHuntResponse(dto.query)

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
    const connectors = await this.findAvailableAiConnectors(user.tenantId)
    const response =
      (await this.tryConnectorsInOrder(connectors, c =>
        this.routeInvestigate(c, fullAlert, relatedAlerts, dto.alertId, user)
      )) ?? buildFallbackInvestigateResponse(fullAlert, relatedAlerts, dto.alertId)

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
    const connectors = await this.findAvailableAiConnectors(user.tenantId)
    const response =
      (await this.tryConnectorsInOrder(connectors, c => this.routeExplain(c, body.prompt, user))) ??
      this.buildFallbackExplainResponse(body.prompt)

    const latencyMs = Date.now() - startTime
    await this.logAudit(
      this.buildAuditRecord(user, AiAuditAction.EXPLAIN, response, latencyMs, body.prompt)
    )

    this.logAction('aiExplain', user, 'AiExplain', undefined, {
      model: response.model,
      confidence: response.confidence,
      latencyMs,
    })
    return response
  }

  async runAgentTask(input: AgentTaskExecutionInput): Promise<AiResponse> {
    await this.ensureAiEnabled(input.tenantId)

    const startTime = Date.now()
    const connectors = await this.findAvailableAiConnectors(input.tenantId)

    this.appLogger.info(
      `AI agent task: ${String(connectors.length)} connector(s) available to try`,
      {
        feature: AppLogFeature.AI_AGENTS,
        action: 'runAgentTask',
        sourceType: AppLogSourceType.SERVICE,
        className: 'AiService',
        functionName: 'runAgentTask',
        tenantId: input.tenantId,
        metadata: {
          connectors: connectors.map(c => c.type),
          agentName: input.agentName,
        },
      }
    )

    const response =
      (await this.tryConnectorsInOrder(connectors, c => this.routeAgentTask(c, input))) ??
      buildFallbackAgentTaskResponse({
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
  /* PRIVATE: Multi-Provider Connector Resolution                      */
  /* ---------------------------------------------------------------- */

  /**
   * Returns ALL configured AI connectors in priority order.
   * The caller cascades through them until one succeeds.
   */
  private async findAvailableAiConnectors(tenantId: string): Promise<ResolvedAiConnector[]> {
    const configs = await Promise.all(
      AI_CONNECTOR_PRIORITY.map(async connectorType => {
        const config = await this.connectorsService.getDecryptedConfig(tenantId, connectorType)
        return config ? { type: connectorType, config } : undefined
      })
    )

    const resolved = configs.filter((entry): entry is ResolvedAiConnector => entry !== undefined)

    this.appLogger.info(
      `AI connector resolution: ${String(resolved.length)} of ${String(AI_CONNECTOR_PRIORITY.length)} configured`,
      {
        feature: AppLogFeature.AI,
        action: 'findAvailableAiConnectors',
        sourceType: AppLogSourceType.SERVICE,
        className: 'AiService',
        functionName: 'findAvailableAiConnectors',
        tenantId,
        metadata: {
          checked: AI_CONNECTOR_PRIORITY,
          available: resolved.map(c => c.type),
          missing: AI_CONNECTOR_PRIORITY.filter(t => !resolved.some(r => r.type === t)),
        },
      }
    )

    return resolved
  }

  /**
   * Try each connector sequentially until one returns a response.
   * Uses recursion to avoid await-in-loop lint warning.
   * Returns undefined if all connectors fail.
   */
  private async tryConnectorsInOrder(
    connectors: ResolvedAiConnector[],
    attempt: (connector: ResolvedAiConnector) => Promise<AiResponse | undefined>,
    index = 0
  ): Promise<AiResponse | undefined> {
    if (index >= connectors.length) {
      this.appLogger.warn('AI: all connectors failed, using rule-based fallback', {
        feature: AppLogFeature.AI,
        action: 'tryConnectorsInOrder',
        outcome: AppLogOutcome.WARNING,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AiService',
        functionName: 'tryConnectorsInOrder',
        metadata: { triedConnectors: connectors.map(c => c.type) },
      })
      return undefined
    }

    const connector = connectors.at(index)
    if (!connector) {
      return undefined
    }

    this.appLogger.info(`AI: trying provider ${connector.type}...`, {
      feature: AppLogFeature.AI,
      action: 'tryConnectorsInOrder',
      sourceType: AppLogSourceType.SERVICE,
      className: 'AiService',
      functionName: 'tryConnectorsInOrder',
      metadata: { provider: connector.type },
    })

    const response = await attempt(connector)

    if (response) {
      this.appLogger.info(`AI: ${connector.type} succeeded`, {
        feature: AppLogFeature.AI,
        action: 'tryConnectorsInOrder',
        outcome: AppLogOutcome.SUCCESS,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AiService',
        functionName: 'tryConnectorsInOrder',
        metadata: { provider: connector.type, model: response.model },
      })
      return response
    }

    this.appLogger.warn(`AI: ${connector.type} failed, trying next...`, {
      feature: AppLogFeature.AI,
      action: 'tryConnectorsInOrder',
      outcome: AppLogOutcome.FAILURE,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AiService',
      functionName: 'tryConnectorsInOrder',
      metadata: { provider: connector.type },
    })

    return this.tryConnectorsInOrder(connectors, attempt, index + 1)
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Hunt Routing                                             */
  /* ---------------------------------------------------------------- */

  private async routeHunt(
    connector: ResolvedAiConnector,
    dto: AiHuntDto,
    user: JwtPayload
  ): Promise<AiResponse | undefined> {
    switch (connector.type) {
      case ConnectorType.BEDROCK:
        return this.tryBedrockHunt(connector.config, dto, user)
      case ConnectorType.LLM_APIS:
        return this.tryLlmApisHunt(connector.config, dto, user)
      case ConnectorType.OPENCLAW_GATEWAY:
        return this.tryOpenClawHunt(connector.config, dto, user)
      default:
        return undefined
    }
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Investigate Routing                                      */
  /* ---------------------------------------------------------------- */

  private async routeInvestigate(
    connector: ResolvedAiConnector,
    alert: Alert,
    relatedAlerts: Array<Pick<Alert, 'id' | 'title' | 'severity' | 'timestamp'>>,
    alertId: string,
    user: JwtPayload
  ): Promise<AiResponse | undefined> {
    switch (connector.type) {
      case ConnectorType.BEDROCK:
        return this.tryBedrockInvestigate(connector.config, alert, relatedAlerts, alertId, user)
      case ConnectorType.LLM_APIS:
        return this.tryLlmApisInvestigate(connector.config, alert, relatedAlerts, alertId, user)
      case ConnectorType.OPENCLAW_GATEWAY:
        return this.tryOpenClawInvestigate(connector.config, alert, relatedAlerts, alertId, user)
      default:
        return undefined
    }
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Explain Routing                                          */
  /* ---------------------------------------------------------------- */

  private async routeExplain(
    connector: ResolvedAiConnector,
    prompt: string,
    user: JwtPayload
  ): Promise<AiResponse | undefined> {
    switch (connector.type) {
      case ConnectorType.BEDROCK:
        return this.tryBedrockExplain(connector.config, prompt, user)
      case ConnectorType.LLM_APIS:
        return this.tryLlmApisExplain(connector.config, prompt, user)
      case ConnectorType.OPENCLAW_GATEWAY:
        return this.tryOpenClawExplain(connector.config, prompt, user)
      default:
        return undefined
    }
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Agent Task Routing                                       */
  /* ---------------------------------------------------------------- */

  private async routeAgentTask(
    connector: ResolvedAiConnector,
    input: AgentTaskExecutionInput
  ): Promise<AiResponse | undefined> {
    switch (connector.type) {
      case ConnectorType.BEDROCK:
        return this.tryBedrockAgentTask(connector.config, input)
      case ConnectorType.LLM_APIS:
        return this.tryLlmApisAgentTask(connector.config, input)
      case ConnectorType.OPENCLAW_GATEWAY:
        return this.tryOpenClawAgentTask(connector.config, input)
      default:
        return undefined
    }
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
      this.logProviderFailure('Bedrock', 'aiHunt', error, user.tenantId, user.sub)
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
      this.logProviderFailure('Bedrock', 'aiInvestigate', error, user.tenantId, user.sub, {
        targetResource: 'Alert',
        targetResourceId: alertId,
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
      this.logProviderFailure('Bedrock', 'runAgentTask', error, input.tenantId, input.actorUserId, {
        targetResource: 'AiAgent',
        targetResourceId: input.agentId,
        feature: AppLogFeature.AI_AGENTS,
      })
      return undefined
    }
  }

  private async tryBedrockExplain(
    config: Record<string, unknown>,
    prompt: string,
    user: JwtPayload
  ): Promise<AiResponse | undefined> {
    try {
      const aiResult = await this.bedrockService.invoke(config, prompt, AI_BEDROCK_MAX_TOKENS)
      return buildBedrockExplainResponse(
        aiResult.text,
        (config.modelId as string) ?? AI_DEFAULT_MODEL,
        aiResult.inputTokens,
        aiResult.outputTokens
      )
    } catch (error) {
      this.logProviderFailure('Bedrock', 'aiExplain', error, user.tenantId, user.sub)
      return undefined
    }
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: LLM APIs Attempt Helpers                                 */
  /* ---------------------------------------------------------------- */

  private async tryLlmApisHunt(
    config: Record<string, unknown>,
    dto: AiHuntDto,
    user: JwtPayload
  ): Promise<AiResponse | undefined> {
    try {
      const prompt = buildHuntPrompt(dto.query, dto.context)
      const aiResult = await this.llmApisService.invoke(config, prompt, AI_LLM_APIS_MAX_TOKENS)
      const modelId = (config.defaultModel as string) ?? 'gpt-4'
      return buildLlmApisHuntResponse(
        aiResult.text,
        dto.query,
        modelId,
        aiResult.inputTokens,
        aiResult.outputTokens
      )
    } catch (error) {
      this.logProviderFailure('LLM APIs', 'aiHunt', error, user.tenantId, user.sub)
      return undefined
    }
  }

  private async tryLlmApisInvestigate(
    config: Record<string, unknown>,
    alert: Alert,
    relatedAlerts: Array<Pick<Alert, 'id' | 'title' | 'severity' | 'timestamp'>>,
    alertId: string,
    user: JwtPayload
  ): Promise<AiResponse | undefined> {
    try {
      const prompt = buildInvestigationPrompt(alert, relatedAlerts)
      const aiResult = await this.llmApisService.invoke(config, prompt, AI_LLM_APIS_MAX_TOKENS)
      const modelId = (config.defaultModel as string) ?? 'gpt-4'
      return buildLlmApisInvestigateResponse(
        aiResult.text,
        alertId,
        relatedAlerts.length,
        alert,
        relatedAlerts,
        modelId,
        aiResult.inputTokens,
        aiResult.outputTokens
      )
    } catch (error) {
      this.logProviderFailure('LLM APIs', 'aiInvestigate', error, user.tenantId, user.sub, {
        targetResource: 'Alert',
        targetResourceId: alertId,
      })
      return undefined
    }
  }

  private async tryLlmApisAgentTask(
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
      const aiResult = await this.llmApisService.invoke(config, prompt, AI_LLM_APIS_MAX_TOKENS)
      const modelId = (config.defaultModel as string) ?? 'gpt-4'
      return buildLlmApisAgentTaskResponse(
        aiResult.text,
        input.agentName,
        modelId,
        aiResult.inputTokens,
        aiResult.outputTokens
      )
    } catch (error) {
      this.logProviderFailure(
        'LLM APIs',
        'runAgentTask',
        error,
        input.tenantId,
        input.actorUserId,
        {
          targetResource: 'AiAgent',
          targetResourceId: input.agentId,
          feature: AppLogFeature.AI_AGENTS,
        }
      )
      return undefined
    }
  }

  private async tryLlmApisExplain(
    config: Record<string, unknown>,
    prompt: string,
    user: JwtPayload
  ): Promise<AiResponse | undefined> {
    try {
      const aiResult = await this.llmApisService.invoke(config, prompt, AI_LLM_APIS_MAX_TOKENS)
      const modelId = (config.defaultModel as string) ?? 'gpt-4'
      return buildLlmApisExplainResponse(
        aiResult.text,
        modelId,
        aiResult.inputTokens,
        aiResult.outputTokens
      )
    } catch (error) {
      this.logProviderFailure('LLM APIs', 'aiExplain', error, user.tenantId, user.sub)
      return undefined
    }
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: OpenClaw Gateway Attempt Helpers                         */
  /* ---------------------------------------------------------------- */

  private async tryOpenClawHunt(
    config: Record<string, unknown>,
    dto: AiHuntDto,
    user: JwtPayload
  ): Promise<AiResponse | undefined> {
    try {
      const prompt = buildHuntPrompt(dto.query, dto.context)
      const aiResult = await this.openClawGatewayService.invoke(
        config,
        prompt,
        AI_OPENCLAW_MAX_TOKENS,
        'hunt'
      )
      return buildOpenClawHuntResponse(
        aiResult.text,
        dto.query,
        aiResult.inputTokens,
        aiResult.outputTokens
      )
    } catch (error) {
      this.logProviderFailure('OpenClaw Gateway', 'aiHunt', error, user.tenantId, user.sub)
      return undefined
    }
  }

  private async tryOpenClawInvestigate(
    config: Record<string, unknown>,
    alert: Alert,
    relatedAlerts: Array<Pick<Alert, 'id' | 'title' | 'severity' | 'timestamp'>>,
    alertId: string,
    user: JwtPayload
  ): Promise<AiResponse | undefined> {
    try {
      const prompt = buildInvestigationPrompt(alert, relatedAlerts)
      const aiResult = await this.openClawGatewayService.invoke(
        config,
        prompt,
        AI_OPENCLAW_MAX_TOKENS,
        'investigate'
      )
      return buildOpenClawInvestigateResponse(
        aiResult.text,
        alertId,
        relatedAlerts.length,
        alert,
        relatedAlerts,
        aiResult.inputTokens,
        aiResult.outputTokens
      )
    } catch (error) {
      this.logProviderFailure('OpenClaw Gateway', 'aiInvestigate', error, user.tenantId, user.sub, {
        targetResource: 'Alert',
        targetResourceId: alertId,
      })
      return undefined
    }
  }

  private async tryOpenClawAgentTask(
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
      const aiResult = await this.openClawGatewayService.invoke(
        config,
        prompt,
        AI_OPENCLAW_MAX_TOKENS,
        'agent_task'
      )
      return buildOpenClawAgentTaskResponse(
        aiResult.text,
        input.agentName,
        aiResult.inputTokens,
        aiResult.outputTokens
      )
    } catch (error) {
      this.logProviderFailure(
        'OpenClaw Gateway',
        'runAgentTask',
        error,
        input.tenantId,
        input.actorUserId,
        {
          targetResource: 'AiAgent',
          targetResourceId: input.agentId,
          feature: AppLogFeature.AI_AGENTS,
        }
      )
      return undefined
    }
  }

  private async tryOpenClawExplain(
    config: Record<string, unknown>,
    prompt: string,
    user: JwtPayload
  ): Promise<AiResponse | undefined> {
    try {
      const aiResult = await this.openClawGatewayService.invoke(
        config,
        prompt,
        AI_OPENCLAW_MAX_TOKENS,
        'explain'
      )
      return buildOpenClawExplainResponse(
        aiResult.text,
        aiResult.inputTokens,
        aiResult.outputTokens
      )
    } catch (error) {
      this.logProviderFailure('OpenClaw Gateway', 'aiExplain', error, user.tenantId, user.sub)
      return undefined
    }
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Fallback Explain (rule-based)                            */
  /* ---------------------------------------------------------------- */

  private buildFallbackExplainResponse(prompt: string): AiResponse {
    return {
      result: generateExplainResponse(prompt),
      reasoning: [
        'Parsing the security concept or finding to explain',
        'Breaking down technical details into analyst-friendly language',
        'Mapping to MITRE ATT&CK tactics, techniques, and procedures',
        'Providing contextual examples relevant to the environment',
        'Including remediation guidance and best practices',
        'Generating rule-based explanation (AI model not available)',
      ],
      confidence: 0.85,
      model: 'rule-based',
      provider: 'rule-based',
      tokensUsed: { input: 0, output: 0 },
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
      const enabledConnectors = await this.aiRepository.findEnabledConnectorByTypes(tenantId, [
        ConnectorType.BEDROCK,
        ConnectorType.LLM_APIS,
        ConnectorType.OPENCLAW_GATEWAY,
      ])

      if (enabledConnectors.length === 0) {
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
          'AI features are not enabled for this tenant. Configure an AI connector (Bedrock, LLM APIs, or OpenClaw Gateway).',
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

  private logProviderFailure(
    providerName: string,
    action: string,
    error: unknown,
    tenantId: string,
    actorUserId: string,
    extra?: {
      targetResource?: string
      targetResourceId?: string
      feature?: AppLogFeature
    }
  ): void {
    const errorMessage = error instanceof Error ? error.message : 'Unknown'
    this.logger.warn(`${providerName} ${action} failed, falling back: ${errorMessage}`)
    this.appLogger.warn(`${providerName} ${action} invocation failed, using fallback`, {
      feature: extra?.feature ?? AppLogFeature.AI,
      action,
      outcome: AppLogOutcome.FAILURE,
      tenantId,
      actorUserId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AiService',
      functionName: action,
      targetResource: extra?.targetResource,
      targetResourceId: extra?.targetResourceId,
      metadata: { error: errorMessage, provider: providerName },
    })
  }
}
