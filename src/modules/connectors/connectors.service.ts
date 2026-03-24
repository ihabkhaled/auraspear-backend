import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ConnectorsRepository } from './connectors.repository'
import {
  buildConnectorStats,
  buildConnectorUpdateData,
  buildNewConnectorResponse,
  extractUrlFields,
  mapConnectorToResponse,
  mergeConfigWithRedacted,
  normalizeConnectorConfig,
  sanitizeErrorDetails,
} from './connectors.utilities'
import { validateConnectorConfig } from './dto/connector.dto'
import { BedrockService } from './services/bedrock.service'
import { GrafanaService } from './services/grafana.service'
import { GraylogService } from './services/graylog.service'
import { InfluxDBService } from './services/influxdb.service'
import { LlmApisService } from './services/llm-apis.service'
import { LogstashService } from './services/logstash.service'
import { MispService } from './services/misp.service'
import { OpenClawGatewayService } from './services/openclaw-gateway.service'
import { ShuffleService } from './services/shuffle.service'
import { VelociraptorService } from './services/velociraptor.service'
import { WazuhService } from './services/wazuh.service'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { AppLoggerService } from '../../common/services/app-logger.service'
import { encrypt, decrypt } from '../../common/utils/encryption.utility'
import { maskSecrets } from '../../common/utils/mask.utility'
import { resolveAndValidateUrl } from '../../common/utils/ssrf.utility'
import type {
  ConnectorResponse,
  ConnectorStats,
  ConnectorTestable,
  ConnectorTestResult as TestResult,
} from './connectors.types'
import type { CreateConnectorDto, UpdateConnectorDto } from './dto/connector.dto'
import type { ConnectorConfig } from '@prisma/client'

@Injectable()
export class ConnectorsService {
  private readonly logger = new Logger(ConnectorsService.name)
  private readonly encryptionKey: string

  private readonly testServiceMap: Map<string, ConnectorTestable>

  constructor(
    private readonly connectorsRepository: ConnectorsRepository,
    private readonly configService: ConfigService,
    private readonly wazuhService: WazuhService,
    private readonly graylogService: GraylogService,
    private readonly logstashService: LogstashService,
    private readonly velociraptorService: VelociraptorService,
    private readonly grafanaService: GrafanaService,
    private readonly influxdbService: InfluxDBService,
    private readonly mispService: MispService,
    private readonly shuffleService: ShuffleService,
    private readonly bedrockService: BedrockService,
    private readonly llmApisService: LlmApisService,
    private readonly openClawGatewayService: OpenClawGatewayService,
    private readonly appLogger: AppLoggerService
  ) {
    this.encryptionKey = this.validateEncryptionKey()
    this.testServiceMap = this.buildTestServiceMap()
  }

  private validateEncryptionKey(): string {
    const key = this.configService.get<string>('CONFIG_ENCRYPTION_KEY')
    if (key?.length !== 64 || !/^[\da-f]+$/i.test(key)) {
      throw new Error('CONFIG_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)')
    }
    return key
  }

  private buildTestServiceMap(): Map<string, ConnectorTestable> {
    return new Map<string, ConnectorTestable>([
      ['wazuh', this.wazuhService],
      ['graylog', this.graylogService],
      ['logstash', this.logstashService],
      ['velociraptor', this.velociraptorService],
      ['grafana', this.grafanaService],
      ['influxdb', this.influxdbService],
      ['misp', this.mispService],
      ['shuffle', this.shuffleService],
      ['bedrock', this.bedrockService],
      ['llm_apis', this.llmApisService],
      ['openclaw_gateway', this.openClawGatewayService],
    ])
  }

  /* ---------------------------------------------------------------- */
  /* FIND ALL                                                          */
  /* ---------------------------------------------------------------- */

  async findAll(tenantId: string): Promise<ConnectorResponse[]> {
    const configs = await this.connectorsRepository.findAllByTenant(tenantId)
    const results = configs.map(c =>
      mapConnectorToResponse(c, e => this.decryptConfig(e), maskSecrets)
    )
    this.logSuccess('findAll', tenantId, undefined, { count: results.length })
    return results
  }

  /* ---------------------------------------------------------------- */
  /* FIND BY TYPE                                                      */
  /* ---------------------------------------------------------------- */

  async findByType(tenantId: string, type: string): Promise<ConnectorResponse> {
    const config = await this.findConnectorOrThrow(tenantId, type, 'findByType')
    this.logSuccess('findByType', tenantId, type)
    return mapConnectorToResponse(config, e => this.decryptConfig(e), maskSecrets)
  }

  async getStats(tenantId: string): Promise<ConnectorStats> {
    const connectors = await this.connectorsRepository.findAllByTenant(tenantId)
    const stats = buildConnectorStats(connectors)

    this.logSuccess('getStats', tenantId, undefined, { ...stats })
    return stats
  }

  /* ---------------------------------------------------------------- */
  /* CREATE                                                            */
  /* ---------------------------------------------------------------- */

  async create(tenantId: string, dto: CreateConnectorDto): Promise<ConnectorResponse> {
    await this.guardDuplicate(tenantId, dto.type)
    const validatedConfig = await this.validateAndSanitizeConfig(
      dto.type,
      dto.config as Record<string, unknown>,
      'create',
      tenantId
    )
    const encryptedConfig = encrypt(JSON.stringify(validatedConfig), this.encryptionKey)

    const config = await this.connectorsRepository.create({
      tenantId,
      type: dto.type as never,
      name: dto.name,
      enabled: dto.enabled,
      authType: dto.authType as never,
      encryptedConfig,
    })

    this.logSuccess('create', tenantId, dto.type, {
      connectorName: dto.name,
      authType: dto.authType,
    })
    return buildNewConnectorResponse(config, maskSecrets(validatedConfig))
  }

  /* ---------------------------------------------------------------- */
  /* UPDATE                                                            */
  /* ---------------------------------------------------------------- */

  async update(
    tenantId: string,
    type: string,
    dto: UpdateConnectorDto
  ): Promise<ConnectorResponse> {
    const existing = await this.findConnectorOrThrow(tenantId, type, 'update')
    const updateData = buildConnectorUpdateData(dto)

    if (dto.config !== undefined) {
      updateData.encryptedConfig = await this.buildMergedEncryptedConfig(
        type,
        dto.config as Record<string, unknown>,
        existing.encryptedConfig,
        tenantId
      )
    }

    const updated = await this.connectorsRepository.updateByTenantAndType(
      tenantId,
      type,
      updateData
    )
    this.logSuccess('update', tenantId, type, { updatedFields: Object.keys(dto) })
    return mapConnectorToResponse(updated, e => this.decryptConfig(e), maskSecrets)
  }

  /* ---------------------------------------------------------------- */
  /* REMOVE                                                            */
  /* ---------------------------------------------------------------- */

  async remove(tenantId: string, type: string): Promise<{ deleted: boolean }> {
    await this.findConnectorOrThrow(tenantId, type, 'remove')
    await this.connectorsRepository.deleteByTenantAndType(tenantId, type)
    this.logSuccess('remove', tenantId, type)
    return { deleted: true }
  }

  /* ---------------------------------------------------------------- */
  /* TOGGLE                                                            */
  /* ---------------------------------------------------------------- */

  async toggle(
    tenantId: string,
    type: string,
    enabled: boolean
  ): Promise<{ type: string; enabled: boolean }> {
    await this.connectorsRepository.updateByTenantAndType(tenantId, type, { enabled })
    this.logSuccess('toggle', tenantId, type, { enabled })
    return { type, enabled }
  }

  /* ---------------------------------------------------------------- */
  /* TEST CONNECTION                                                   */
  /* ---------------------------------------------------------------- */

  async testConnection(tenantId: string, type: string): Promise<TestResult> {
    const config = await this.findConnectorOrThrow(tenantId, type, 'testConnection')
    const decryptedConfig = this.decryptConfig(config.encryptedConfig)
    const { ok, details, latencyMs } = await this.runConnectionTest(type, decryptedConfig, tenantId)

    const testedAt = new Date()
    await this.connectorsRepository.updateByTenantAndType(tenantId, type, {
      lastTestAt: testedAt,
      lastTestOk: ok,
      lastError: ok ? null : details.slice(0, 500),
    })

    if (ok) {
      this.logSuccess('testConnection', tenantId, type, { latencyMs, ok })
    } else {
      this.logWarn('testConnection', tenantId, type, {
        latencyMs,
        ok,
        details: details.slice(0, 300),
      })
    }
    return { type, ok, latencyMs, details, testedAt: testedAt.toISOString() }
  }

  /* ---------------------------------------------------------------- */
  /* PUBLIC: Config Access (used by other modules)                     */
  /* ---------------------------------------------------------------- */

  async getDecryptedConfig(
    tenantId: string,
    type: string
  ): Promise<Record<string, unknown> | null> {
    const config = await this.connectorsRepository.findByTenantAndType(tenantId, type)
    if (!config?.enabled) return null
    this.logDebug('getDecryptedConfig', tenantId, type)
    return this.decryptConfig(config.encryptedConfig)
  }

  async isEnabled(tenantId: string, type: string): Promise<boolean> {
    const config = await this.connectorsRepository.findEnabledStatus(tenantId, type)
    return config?.enabled ?? false
  }

  async getEnabledConnectors(tenantId: string): Promise<Array<{ type: string; name: string }>> {
    const configs = await this.connectorsRepository.findEnabledByTenant(tenantId)
    return configs.map(c => ({ type: c.type, name: c.name }))
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Finders                                                  */
  /* ---------------------------------------------------------------- */

  private async findConnectorOrThrow(
    tenantId: string,
    type: string,
    action: string
  ): Promise<ConnectorConfig> {
    const config = await this.connectorsRepository.findByTenantAndType(tenantId, type)
    if (!config) {
      this.logWarn(action, tenantId, type)
      throw new BusinessException(
        404,
        `Connector '${type}' not found`,
        'errors.connectors.notFound'
      )
    }
    return config
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Validation                                               */
  /* ---------------------------------------------------------------- */

  private async guardDuplicate(tenantId: string, type: string): Promise<void> {
    const existing = await this.connectorsRepository.findByTenantAndType(tenantId, type)
    if (existing) {
      this.logWarn('create', tenantId, type)
      throw new BusinessException(
        409,
        `Connector '${type}' already exists`,
        'errors.connectors.alreadyExists'
      )
    }
  }

  private async validateAndSanitizeConfig(
    type: string,
    config: Record<string, unknown>,
    action: string,
    tenantId: string
  ): Promise<Record<string, unknown>> {
    let validated: Record<string, unknown>
    try {
      validated = validateConnectorConfig(type, config)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid connector config'
      this.logWarn(action, tenantId, type, { error: message })
      throw new BusinessException(
        400,
        `Invalid config for '${type}': ${message}`,
        'errors.connectors.invalidConfig'
      )
    }
    await this.validateConfigUrls(validated)
    return validated
  }

  /**
   * Validates all URL fields in the connector config using DNS-aware SSRF defense.
   * In production, hostnames are resolved to IP addresses and checked against
   * the private IP blocklist to prevent DNS rebinding attacks.
   * Falls back to synchronous validation for basic URL structure checks.
   */
  private async validateConfigUrls(config: Record<string, unknown>): Promise<void> {
    await Promise.all(
      extractUrlFields(config).map(async ({ value }) => resolveAndValidateUrl(value))
    )
  }

  private async buildMergedEncryptedConfig(
    type: string,
    incomingConfig: Record<string, unknown>,
    existingEncrypted: string,
    tenantId: string
  ): Promise<string> {
    const existingDecrypted = this.decryptConfig(existingEncrypted)
    const mergedConfig = mergeConfigWithRedacted(incomingConfig, existingDecrypted)
    const validatedConfig = await this.validateAndSanitizeConfig(
      type,
      mergedConfig,
      'update',
      tenantId
    )
    return encrypt(JSON.stringify(validatedConfig), this.encryptionKey)
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Connection Test Runner                                   */
  /* ---------------------------------------------------------------- */

  private async runConnectionTest(
    type: string,
    config: Record<string, unknown>,
    tenantId: string
  ): Promise<{ ok: boolean; details: string; latencyMs: number }> {
    const start = Date.now()
    const service = this.testServiceMap.get(type)

    if (!service) {
      return { ok: false, details: `Unknown connector type: ${type}`, latencyMs: Date.now() - start }
    }

    try {
      const { ok, details } = await service.testConnection(config)
      return { ok, details, latencyMs: Date.now() - start }
    } catch (error) {
      const details = sanitizeErrorDetails(error)
      this.logConnectionTestError(type, tenantId, error, Date.now() - start)
      return { ok: false, details, latencyMs: Date.now() - start }
    }
  }

  private logConnectionTestError(
    type: string,
    tenantId: string,
    error: unknown,
    latencyMs: number
  ): void {
    const errorMessage = error instanceof Error ? error.message : 'unknown'
    this.logger.error(
      `Connector ${type} test failed for tenant ${tenantId} after ${latencyMs}ms: ${errorMessage}`
    )
    this.appLogger.error(`Connector ${type} connection test failed`, {
      feature: AppLogFeature.CONNECTORS,
      action: 'testConnection',
      outcome: AppLogOutcome.FAILURE,
      sourceType: AppLogSourceType.SERVICE,
      className: 'ConnectorsService',
      functionName: 'runConnectionTest',
      tenantId,
      metadata: { connectorType: type, error: errorMessage, latencyMs },
      stackTrace: error instanceof Error ? error.stack : undefined,
    })
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Encryption                                               */
  /* ---------------------------------------------------------------- */

  private decryptConfig(encryptedConfig: string): Record<string, unknown> {
    const config = this.parseOrDecryptConfig(encryptedConfig)
    if (!config) {
      this.logger.warn('Failed to decrypt connector config, returning empty')
      this.logWarn('decryptConfig', '', '')
      return {}
    }
    return normalizeConnectorConfig(config)
  }

  private parseOrDecryptConfig(encryptedConfig: string): Record<string, unknown> | null {
    try {
      const raw = JSON.parse(encryptedConfig) as Record<string, unknown>
      if ('placeholder' in raw) return raw
      return raw
    } catch {
      // Not plain JSON — try decrypting
    }

    try {
      const decrypted = decrypt(encryptedConfig, this.encryptionKey)
      return JSON.parse(decrypted) as Record<string, unknown>
    } catch {
      return null
    }
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Logging                                                  */
  /* ---------------------------------------------------------------- */

  private logSuccess(
    action: string,
    tenantId: string,
    resourceId?: string,
    metadata?: Record<string, unknown>
  ): void {
    this.appLogger.info(`Connector ${action}`, {
      feature: AppLogFeature.CONNECTORS,
      action,
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      targetResource: 'Connector',
      targetResourceId: resourceId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'ConnectorsService',
      functionName: action,
      metadata,
    })
  }

  private logDebug(action: string, tenantId: string, resourceId?: string): void {
    this.appLogger.debug(`Connector ${action}`, {
      feature: AppLogFeature.CONNECTORS,
      action,
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      targetResource: 'Connector',
      targetResourceId: resourceId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'ConnectorsService',
      functionName: action,
    })
  }

  private logWarn(
    action: string,
    tenantId: string,
    type?: string,
    metadata?: Record<string, unknown>
  ): void {
    this.appLogger.warn(`Connector ${action} failed`, {
      feature: AppLogFeature.CONNECTORS,
      action,
      outcome: AppLogOutcome.FAILURE,
      sourceType: AppLogSourceType.SERVICE,
      className: 'ConnectorsService',
      functionName: action,
      metadata: { ...metadata, tenantId, connectorType: type },
    })
  }
}
