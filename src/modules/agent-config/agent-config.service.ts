import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AI_DEFAULT_PROVIDER_KEY } from './agent-config.constants'
import { AgentConfigRepository } from './agent-config.repository'
import {
  buildAgentConfigWithDefaults,
  buildTokenResetData,
  isValidAgentId,
  redactOsintSource,
} from './agent-config.utilities'
import {
  AiAgentId,
  ApprovalStatus,
  AppLogFeature,
  AppLogOutcome,
  AppLogSourceType,
  TokenResetPeriod,
} from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { AppLoggerService } from '../../common/services/app-logger.service'
import { encrypt } from '../../common/utils/encryption.utility'
import { validateUrl } from '../../common/utils/ssrf.utility'
import type {
  AgentConfigWithDefaults,
  OsintSourceRedacted,
  AiApprovalRequestRecord,
  ResolvedProvider,
  OsintTestResult,
} from './agent-config.types'
import type { CreateOsintSourceDto } from './dto/create-osint-source.dto'
import type { ResolveApprovalDto } from './dto/resolve-approval.dto'
import type { UpdateAgentConfigDto } from './dto/update-agent-config.dto'
import type { UpdateOsintSourceDto } from './dto/update-osint-source.dto'
import type { InputJsonValue } from '@prisma/client/runtime/library'

@Injectable()
export class AgentConfigService {
  private readonly logger = new Logger(AgentConfigService.name)

  constructor(
    private readonly repository: AgentConfigRepository,
    private readonly appLogger: AppLoggerService,
    private readonly configService: ConfigService
  ) {}

  // ─── Agent Configs ──────────────────────────────────────────

  async getAgentConfigs(tenantId: string): Promise<AgentConfigWithDefaults[]> {
    const records = await this.repository.findAllAgentConfigs(tenantId)

    const agentIds = Object.values(AiAgentId)
    const configMap = new Map(records.map(record => [record.agentId, record]))

    const result: AgentConfigWithDefaults[] = []
    for (const agentId of agentIds) {
      const record = configMap.get(agentId) ?? null
      result.push(buildAgentConfigWithDefaults(agentId, record))
    }

    this.logSuccess('listAgentConfigs', tenantId)

    return result
  }

  async getAgentConfig(tenantId: string, agentId: string): Promise<AgentConfigWithDefaults> {
    this.validateAgentId(agentId)

    const record = await this.repository.findAgentConfig(tenantId, agentId)

    return buildAgentConfigWithDefaults(agentId as AiAgentId, record)
  }

  async updateAgentConfig(
    tenantId: string,
    agentId: string,
    dto: UpdateAgentConfigDto,
    actor: string
  ): Promise<AgentConfigWithDefaults> {
    this.validateAgentId(agentId)

    const updateData: Record<string, unknown> = { ...dto }
    if (dto.triggerConfig) {
      updateData.triggerConfig = dto.triggerConfig as InputJsonValue
    }

    await this.repository.upsertAgentConfig(tenantId, agentId, updateData)

    this.logSuccess('updateAgentConfig', tenantId, { agentId, actor })

    return this.getAgentConfig(tenantId, agentId)
  }

  async toggleAgent(
    tenantId: string,
    agentId: string,
    enabled: boolean,
    actor: string
  ): Promise<AgentConfigWithDefaults> {
    this.validateAgentId(agentId)

    await this.repository.upsertAgentConfig(tenantId, agentId, { isEnabled: enabled })

    this.logSuccess('toggleAgent', tenantId, { agentId, enabled, actor })

    return this.getAgentConfig(tenantId, agentId)
  }

  async resetUsage(
    tenantId: string,
    agentId: string,
    period: TokenResetPeriod,
    actor: string
  ): Promise<AgentConfigWithDefaults> {
    this.validateAgentId(agentId)

    const existing = await this.repository.findAgentConfig(tenantId, agentId)
    if (!existing) {
      throw new BusinessException(404, 'Agent config not found', 'errors.agentConfig.notFound')
    }

    const resetData = buildTokenResetData(period)
    await this.repository.resetTokenCounters(tenantId, agentId, resetData)

    this.logSuccess('resetUsage', tenantId, { agentId, period, actor })

    return this.getAgentConfig(tenantId, agentId)
  }

  async resolveProviderForAgent(tenantId: string, agentId: string): Promise<ResolvedProvider> {
    this.validateAgentId(agentId)

    const config = await this.repository.findAgentConfig(tenantId, agentId)

    const providerMode = config?.providerMode ?? AI_DEFAULT_PROVIDER_KEY

    if (providerMode === AI_DEFAULT_PROVIDER_KEY) {
      return { mode: AI_DEFAULT_PROVIDER_KEY, connectorId: null, model: null }
    }

    return {
      mode: providerMode,
      connectorId: null,
      model: config?.model ?? null,
    }
  }

  // ─── OSINT Sources ─────────────────────────────────────────

  async listOsintSources(tenantId: string): Promise<OsintSourceRedacted[]> {
    const sources = await this.repository.findAllOsintSources(tenantId)

    return sources.map(redactOsintSource)
  }

  async createOsintSource(
    tenantId: string,
    dto: CreateOsintSourceDto,
    actor: string
  ): Promise<OsintSourceRedacted> {
    if (dto.baseUrl) {
      validateUrl(dto.baseUrl)
    }

    let encryptedKey: string | null = null
    if (dto.apiKey) {
      const encryptionKey = this.configService.get<string>('CONFIG_ENCRYPTION_KEY')
      if (!encryptionKey) {
        throw new BusinessException(
          500,
          'Encryption key not configured',
          'errors.agentConfig.encryptionKeyMissing'
        )
      }
      encryptedKey = encrypt(dto.apiKey, encryptionKey)
    }

    const record = await this.repository.createOsintSource({
      tenant: { connect: { id: tenantId } },
      sourceType: dto.sourceType,
      name: dto.name,
      isEnabled: dto.isEnabled ?? true,
      encryptedApiKey: encryptedKey,
      baseUrl: dto.baseUrl ?? null,
      authType: dto.authType,
      headerName: dto.headerName ?? null,
      queryParamName: dto.queryParamName ?? null,
      responsePath: dto.responsePath ?? null,
      requestMethod: dto.requestMethod ?? 'GET',
      timeout: dto.timeout ?? 30_000,
    })

    this.logSuccess('createOsintSource', tenantId, {
      sourceId: record.id,
      sourceType: dto.sourceType,
      actor,
    })

    return redactOsintSource(record)
  }

  async updateOsintSource(
    id: string,
    tenantId: string,
    dto: UpdateOsintSourceDto,
    actor: string
  ): Promise<OsintSourceRedacted> {
    const existing = await this.repository.findOsintSource(id, tenantId)
    if (!existing) {
      throw new BusinessException(
        404,
        'OSINT source not found',
        'errors.agentConfig.osintSourceNotFound'
      )
    }

    if (dto.baseUrl) {
      validateUrl(dto.baseUrl)
    }

    const updateData: Record<string, unknown> = { ...dto }
    delete updateData.apiKey

    if (dto.apiKey) {
      const encryptionKey = this.configService.get<string>('CONFIG_ENCRYPTION_KEY')
      if (!encryptionKey) {
        throw new BusinessException(
          500,
          'Encryption key not configured',
          'errors.agentConfig.encryptionKeyMissing'
        )
      }
      updateData.encryptedApiKey = encrypt(dto.apiKey, encryptionKey)
    }

    const record = await this.repository.updateOsintSource(id, tenantId, updateData)

    this.logSuccess('updateOsintSource', tenantId, { sourceId: id, actor })

    return redactOsintSource(record)
  }

  async deleteOsintSource(id: string, tenantId: string, actor: string): Promise<void> {
    const existing = await this.repository.findOsintSource(id, tenantId)
    if (!existing) {
      throw new BusinessException(
        404,
        'OSINT source not found',
        'errors.agentConfig.osintSourceNotFound'
      )
    }

    await this.repository.deleteOsintSource(id, tenantId)

    this.logSuccess('deleteOsintSource', tenantId, { sourceId: id, actor })
  }

  async testOsintSource(id: string, tenantId: string, actor: string): Promise<OsintTestResult> {
    const source = await this.repository.findOsintSource(id, tenantId)
    if (!source) {
      throw new BusinessException(
        404,
        'OSINT source not found',
        'errors.agentConfig.osintSourceNotFound'
      )
    }

    const startTime = Date.now()
    let testSuccess = false
    let testStatusCode: number | null = null
    let testError: string | null = null

    try {
      // Simple connectivity test - just check the base URL responds
      if (source.baseUrl) {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), source.timeout)

        const response = await fetch(source.baseUrl, {
          method: 'HEAD',
          signal: controller.signal,
        })

        clearTimeout(timeoutId)
        testStatusCode = response.status
        testSuccess = response.status < 500
      }
    } catch (fetchError: unknown) {
      testError = fetchError instanceof Error ? fetchError.message : 'Connection failed'
    }

    const responseTime = Date.now() - startTime

    await this.repository.updateOsintSource(id, tenantId, {
      lastTestAt: new Date(),
      lastTestOk: testSuccess,
      lastError: testError,
    })

    this.logSuccess('testOsintSource', tenantId, { sourceId: id, success: testSuccess, actor })

    return {
      success: testSuccess,
      statusCode: testStatusCode,
      responseTime,
      error: testError,
    }
  }

  // ─── Approvals ─────────────────────────────────────────────

  async listApprovals(tenantId: string, status?: string): Promise<AiApprovalRequestRecord[]> {
    return this.repository.findAllApprovals(tenantId, status)
  }

  async resolveApproval(
    id: string,
    tenantId: string,
    dto: ResolveApprovalDto,
    actor: string
  ): Promise<AiApprovalRequestRecord> {
    const existing = await this.repository.findApproval(id, tenantId)
    if (!existing) {
      throw new BusinessException(
        404,
        'Approval request not found',
        'errors.agentConfig.approvalNotFound'
      )
    }

    if (existing.status !== ApprovalStatus.PENDING) {
      throw new BusinessException(
        400,
        'Approval already resolved',
        'errors.agentConfig.approvalAlreadyResolved'
      )
    }

    if (new Date() > existing.expiresAt) {
      throw new BusinessException(400, 'Approval has expired', 'errors.agentConfig.approvalExpired')
    }

    const record = await this.repository.updateApprovalStatus(id, tenantId, {
      status: dto.status,
      reviewedBy: actor,
      reviewedAt: new Date(),
      comment: dto.comment ?? null,
    })

    this.logSuccess('resolveApproval', tenantId, { approvalId: id, status: dto.status, actor })

    return record
  }

  // ─── Token Usage Tracking ──────────────────────────────────

  /**
   * Best-effort increment of per-agent token usage counters.
   * Called by AiService after successful AI execution to track
   * hour/day/month consumption against agent quotas.
   */
  async incrementUsage(tenantId: string, agentId: string, tokens: number): Promise<void> {
    try {
      await this.repository.incrementTokenUsage(tenantId, agentId, tokens)
    } catch {
      this.logger.warn(`Failed to increment token usage for agent ${agentId} in tenant ${tenantId}`)
    }
  }

  // ─── Private Helpers ───────────────────────────────────────

  private validateAgentId(agentId: string): void {
    if (!isValidAgentId(agentId)) {
      throw new BusinessException(400, 'Invalid agent ID', 'errors.agentConfig.invalidAgentId')
    }
  }

  private logSuccess(action: string, tenantId: string, metadata?: Record<string, unknown>): void {
    this.appLogger.info(`AgentConfig action: ${action}`, {
      feature: AppLogFeature.AI_CONFIG,
      action,
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AgentConfigService',
      functionName: action,
      metadata,
    })
  }
}
