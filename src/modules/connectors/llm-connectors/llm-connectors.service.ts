import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { REDACTED } from './llm-connectors.constants'
import { LlmConnectorsRepository } from './llm-connectors.repository'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../../common/enums'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { AppLoggerService } from '../../../common/services/app-logger.service'
import { decrypt, encrypt } from '../../../common/utils/encryption.utility'
import { buildLlmConnectorUpdateData } from '../connectors.utilities'
import { LlmApisService } from '../services/llm-apis.service'
import type { CreateLlmConnectorDto } from './dto/create-llm-connector.dto'
import type { UpdateLlmConnectorDto } from './dto/update-llm-connector.dto'
import type { LlmConnectorEnabledConfig, LlmConnectorResponse } from './llm-connectors.types'
import type { LlmConnector } from '@prisma/client'

@Injectable()
export class LlmConnectorsService {
  private readonly logger = new Logger(LlmConnectorsService.name)
  private readonly encryptionKey: string

  constructor(
    private readonly repository: LlmConnectorsRepository,
    private readonly configService: ConfigService,
    private readonly llmApisService: LlmApisService,
    private readonly appLogger: AppLoggerService
  ) {
    const key = this.configService.get<string>('CONFIG_ENCRYPTION_KEY')
    if (key?.length !== 64 || !/^[\da-f]+$/i.test(key)) {
      throw new Error('CONFIG_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)')
    }
    this.encryptionKey = key
  }

  /* ---------------------------------------------------------------- */
  /* LIST                                                              */
  /* ---------------------------------------------------------------- */

  async list(tenantId: string): Promise<LlmConnectorResponse[]> {
    const connectors = await this.repository.findAllByTenant(tenantId)
    this.logSuccess('list', tenantId, undefined, { count: connectors.length })
    return connectors.map(c => this.toResponse(c))
  }

  /* ---------------------------------------------------------------- */
  /* GET BY ID                                                         */
  /* ---------------------------------------------------------------- */

  async getById(id: string, tenantId: string): Promise<LlmConnectorResponse> {
    const connector = await this.findOrThrow(id, tenantId, 'getById')
    this.logSuccess('getById', tenantId, id)
    return this.toResponse(connector)
  }

  /* ---------------------------------------------------------------- */
  /* CREATE                                                            */
  /* ---------------------------------------------------------------- */

  async create(
    tenantId: string,
    dto: CreateLlmConnectorDto,
    actorEmail: string
  ): Promise<LlmConnectorResponse> {
    await this.guardUniqueName(tenantId, dto.name)

    const encryptedApiKey = encrypt(dto.apiKey, this.encryptionKey)

    const connector = await this.repository.create({
      tenantId,
      name: dto.name,
      description: dto.description,
      baseUrl: dto.baseUrl,
      encryptedApiKey,
      defaultModel: dto.defaultModel,
      organizationId: dto.organizationId,
      maxTokensParam: dto.maxTokensParam ?? 'max_tokens',
      timeout: dto.timeout ?? 60000,
    })

    this.logSuccess('create', tenantId, connector.id, {
      name: dto.name,
      actorEmail,
    })
    return this.toResponse(connector)
  }

  /* ---------------------------------------------------------------- */
  /* UPDATE                                                            */
  /* ---------------------------------------------------------------- */

  async update(
    id: string,
    tenantId: string,
    dto: UpdateLlmConnectorDto,
    actorEmail: string
  ): Promise<LlmConnectorResponse> {
    const existing = await this.findOrThrow(id, tenantId, 'update')

    if (dto.name !== undefined && dto.name !== existing.name) {
      await this.guardUniqueName(tenantId, dto.name, id)
    }

    const updateData = buildLlmConnectorUpdateData(dto, value =>
      encrypt(value, this.encryptionKey)
    )

    const updated = await this.repository.updateAndReturn(id, tenantId, updateData)
    if (!updated) {
      throw new BusinessException(404, 'LLM connector not found', 'errors.llmConnectors.notFound')
    }

    this.logSuccess('update', tenantId, id, {
      updatedFields: Object.keys(dto),
      actorEmail,
    })
    return this.toResponse(updated)
  }

  /* ---------------------------------------------------------------- */
  /* DELETE                                                            */
  /* ---------------------------------------------------------------- */

  async delete(id: string, tenantId: string, actorEmail: string): Promise<{ deleted: boolean }> {
    await this.findOrThrow(id, tenantId, 'delete')
    await this.repository.delete(id, tenantId)

    this.logSuccess('delete', tenantId, id, { actorEmail })
    return { deleted: true }
  }

  /* ---------------------------------------------------------------- */
  /* TOGGLE                                                            */
  /* ---------------------------------------------------------------- */

  async toggle(
    id: string,
    tenantId: string,
    actorEmail: string
  ): Promise<{ id: string; enabled: boolean }> {
    const existing = await this.findOrThrow(id, tenantId, 'toggle')
    const newEnabled = !existing.enabled

    await this.repository.updateAndReturn(id, tenantId, { enabled: newEnabled })

    this.logSuccess('toggle', tenantId, id, { enabled: newEnabled, actorEmail })
    return { id, enabled: newEnabled }
  }

  /* ---------------------------------------------------------------- */
  /* TEST CONNECTION                                                   */
  /* ---------------------------------------------------------------- */

  async testConnection(
    id: string,
    tenantId: string
  ): Promise<{ id: string; ok: boolean; details: string; testedAt: string }> {
    const connector = await this.findOrThrow(id, tenantId, 'testConnection')
    const config = this.buildDecryptedConfig(connector)
    const { ok, details, latencyMs } = await this.executeTest(connector.name, config)

    const testedAt = new Date()
    await this.persistTestResult(id, tenantId, ok, details, testedAt)
    this.logTestOutcome(tenantId, id, ok, latencyMs, details)

    return { id, ok, details, testedAt: testedAt.toISOString() }
  }

  private async executeTest(
    connectorName: string,
    config: Record<string, unknown>
  ): Promise<{ ok: boolean; details: string; latencyMs: number }> {
    const start = Date.now()
    try {
      const result = await this.llmApisService.testConnection(config)
      return { ok: result.ok, details: result.details, latencyMs: Date.now() - start }
    } catch (error) {
      const details = error instanceof Error ? error.message : 'Connection test failed'
      this.logger.warn(`LLM connector test failed for ${connectorName}: ${details}`)
      return { ok: false, details, latencyMs: Date.now() - start }
    }
  }

  private async persistTestResult(
    id: string,
    tenantId: string,
    ok: boolean,
    details: string,
    testedAt: Date
  ): Promise<void> {
    await this.repository.updateTestResult(id, tenantId, {
      lastTestAt: testedAt,
      lastTestOk: ok,
      lastError: ok ? null : details.slice(0, 500),
    })
  }

  private logTestOutcome(
    tenantId: string,
    id: string,
    ok: boolean,
    latencyMs: number,
    details: string
  ): void {
    if (ok) {
      this.logSuccess('testConnection', tenantId, id, { latencyMs, ok })
    } else {
      this.logWarn('testConnection', tenantId, id, {
        latencyMs,
        ok,
        details: details.slice(0, 300),
      })
    }
  }

  /* ---------------------------------------------------------------- */
  /* PUBLIC: Decrypted Config (for AI service)                         */
  /* ---------------------------------------------------------------- */

  async getDecryptedConfig(id: string, tenantId: string): Promise<Record<string, unknown> | null> {
    const connector = await this.repository.findByIdAndTenant(id, tenantId)
    if (!connector?.enabled) return null
    return this.buildDecryptedConfig(connector)
  }

  /* ---------------------------------------------------------------- */
  /* PUBLIC: Enabled Configs (for AI service)                          */
  /* ---------------------------------------------------------------- */

  async getEnabledConfigs(tenantId: string): Promise<LlmConnectorEnabledConfig[]> {
    const connectors = await this.repository.findEnabledByTenant(tenantId)
    return connectors.map(c => ({
      id: c.id,
      name: c.name,
      config: this.buildDecryptedConfig(c),
    }))
  }

  /* ---------------------------------------------------------------- */
  /* PUBLIC: Has any enabled (for AI gate check)                       */
  /* ---------------------------------------------------------------- */

  async hasEnabledConnectors(tenantId: string): Promise<boolean> {
    const connectors = await this.repository.findEnabledByTenant(tenantId)
    return connectors.length > 0
  }

  /* ---------------------------------------------------------------- */
  /* PUBLIC: Get all for AI available list                              */
  /* ---------------------------------------------------------------- */

  async getEnabledSummaries(
    tenantId: string
  ): Promise<Array<{ id: string; name: string; enabled: boolean }>> {
    const connectors = await this.repository.findAllByTenant(tenantId)
    return connectors
      .filter(c => c.enabled)
      .map(c => ({ id: c.id, name: c.name, enabled: c.enabled }))
  }

  /**
   * Like getEnabledSummaries but returns an empty array on error
   * (e.g. if the LlmConnector table does not exist yet).
   */
  async getEnabledSummariesSafe(
    tenantId: string
  ): Promise<Array<{ id: string; name: string; enabled: boolean }>> {
    try {
      return await this.getEnabledSummaries(tenantId)
    } catch {
      return []
    }
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Helpers                                                   */
  /* ---------------------------------------------------------------- */

  private async findOrThrow(id: string, tenantId: string, action: string): Promise<LlmConnector> {
    const connector = await this.repository.findByIdAndTenant(id, tenantId)
    if (!connector) {
      this.logWarn(action, tenantId, id)
      throw new BusinessException(404, 'LLM connector not found', 'errors.llmConnectors.notFound')
    }
    return connector
  }

  private async guardUniqueName(tenantId: string, name: string, excludeId?: string): Promise<void> {
    const existing = await this.repository.findByNameAndTenant(name, tenantId)
    if (existing && existing.id !== excludeId) {
      throw new BusinessException(
        409,
        `LLM connector with name "${name}" already exists`,
        'errors.llmConnectors.nameExists'
      )
    }
  }

  private buildDecryptedConfig(connector: LlmConnector): Record<string, unknown> {
    let apiKey: string
    try {
      apiKey = decrypt(connector.encryptedApiKey, this.encryptionKey)
    } catch {
      this.logger.warn(`Failed to decrypt API key for LLM connector ${connector.id}`)
      apiKey = ''
    }

    return {
      baseUrl: connector.baseUrl,
      apiKey,
      defaultModel: connector.defaultModel,
      organizationId: connector.organizationId,
      maxTokensParameter: connector.maxTokensParam,
      timeout: connector.timeout,
    }
  }

  private toResponse(connector: LlmConnector): LlmConnectorResponse {
    return {
      id: connector.id,
      tenantId: connector.tenantId,
      name: connector.name,
      description: connector.description,
      enabled: connector.enabled,
      baseUrl: connector.baseUrl,
      apiKey: REDACTED,
      defaultModel: connector.defaultModel,
      organizationId: connector.organizationId,
      maxTokensParam: connector.maxTokensParam,
      timeout: connector.timeout,
      lastTestAt: connector.lastTestAt?.toISOString() ?? null,
      lastTestOk: connector.lastTestOk,
      lastError: connector.lastError,
      createdAt: connector.createdAt.toISOString(),
      updatedAt: connector.updatedAt.toISOString(),
    }
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Logging                                                   */
  /* ---------------------------------------------------------------- */

  private logSuccess(
    action: string,
    tenantId: string,
    resourceId?: string,
    metadata?: Record<string, unknown>
  ): void {
    this.appLogger.info(`LlmConnector ${action}`, {
      feature: AppLogFeature.CONNECTORS,
      action,
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      targetResource: 'LlmConnector',
      targetResourceId: resourceId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'LlmConnectorsService',
      functionName: action,
      metadata,
    })
  }

  private logWarn(
    action: string,
    tenantId: string,
    resourceId?: string,
    metadata?: Record<string, unknown>
  ): void {
    this.appLogger.warn(`LlmConnector ${action} failed`, {
      feature: AppLogFeature.CONNECTORS,
      action,
      outcome: AppLogOutcome.FAILURE,
      sourceType: AppLogSourceType.SERVICE,
      className: 'LlmConnectorsService',
      functionName: action,
      metadata: { ...metadata, tenantId, resourceId },
    })
  }
}
