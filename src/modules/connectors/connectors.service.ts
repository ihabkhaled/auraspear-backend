import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ConnectorsRepository } from './connectors.repository'
import {
  buildConnectorUpdateData,
  extractUrlFields,
  mapConnectorToResponse,
  mergeConfigWithRedacted,
  sanitizeErrorDetails,
} from './connectors.utilities'
import { validateConnectorConfig } from './dto/connector.dto'
import { BedrockService } from './services/bedrock.service'
import { GrafanaService } from './services/grafana.service'
import { GraylogService } from './services/graylog.service'
import { InfluxDBService } from './services/influxdb.service'
import { LogstashService } from './services/logstash.service'
import { MispService } from './services/misp.service'
import { ShuffleService } from './services/shuffle.service'
import { VelociraptorService } from './services/velociraptor.service'
import { WazuhService } from './services/wazuh.service'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { AppLoggerService } from '../../common/services/app-logger.service'
import { encrypt, decrypt } from '../../common/utils/encryption.utility'
import { maskSecrets } from '../../common/utils/mask.utility'
import { validateUrl } from '../../common/utils/ssrf.utility'
import type { ConnectorResponse, ConnectorTestResult as TestResult } from './connectors.types'
import type { CreateConnectorDto, UpdateConnectorDto } from './dto/connector.dto'
import type { ConnectorConfig } from '@prisma/client'

interface ConnectorTestable {
  testConnection(config: Record<string, unknown>): Promise<{ ok: boolean; details: string }>
}

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
    private readonly appLogger: AppLoggerService
  ) {
    const key = this.configService.get<string>('CONFIG_ENCRYPTION_KEY')
    if (!key || key.length < 32) {
      throw new Error('CONFIG_ENCRYPTION_KEY must be set and at least 32 characters')
    }
    this.encryptionKey = key

    this.testServiceMap = new Map<string, ConnectorTestable>([
      ['wazuh', this.wazuhService],
      ['graylog', this.graylogService],
      ['logstash', this.logstashService],
      ['velociraptor', this.velociraptorService],
      ['grafana', this.grafanaService],
      ['influxdb', this.influxdbService],
      ['misp', this.mispService],
      ['shuffle', this.shuffleService],
      ['bedrock', this.bedrockService],
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

  /* ---------------------------------------------------------------- */
  /* CREATE                                                            */
  /* ---------------------------------------------------------------- */

  async create(tenantId: string, dto: CreateConnectorDto): Promise<ConnectorResponse> {
    await this.guardDuplicate(tenantId, dto.type)
    const validatedConfig = this.validateAndSanitizeConfig(
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
    return {
      type: config.type,
      name: config.name,
      enabled: config.enabled,
      authType: config.authType,
      config: maskSecrets(validatedConfig),
      lastTestAt: null,
      lastTestOk: null,
      lastError: null,
    }
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
      updateData.encryptedConfig = this.buildMergedEncryptedConfig(
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

    this.logSuccess('testConnection', tenantId, type, { latencyMs, ok })
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

  private validateAndSanitizeConfig(
    type: string,
    config: Record<string, unknown>,
    action: string,
    tenantId: string
  ): Record<string, unknown> {
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
    this.validateConfigUrls(validated)
    return validated
  }

  private validateConfigUrls(config: Record<string, unknown>): void {
    for (const { value } of extractUrlFields(config)) {
      validateUrl(value)
    }
  }

  private buildMergedEncryptedConfig(
    type: string,
    incomingConfig: Record<string, unknown>,
    existingEncrypted: string,
    tenantId: string
  ): string {
    const existingDecrypted = this.decryptConfig(existingEncrypted)
    const mergedConfig = mergeConfigWithRedacted(incomingConfig, existingDecrypted)
    const validatedConfig = this.validateAndSanitizeConfig(type, mergedConfig, 'update', tenantId)
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
    let ok = false
    let details = ''

    try {
      const service = this.testServiceMap.get(type)
      if (service) {
        const { ok: resultOk, details: resultDetails } = await service.testConnection(config)
        ok = resultOk
        details = resultDetails
      } else {
        details = `Unknown connector type: ${type}`
      }
    } catch (error) {
      details = sanitizeErrorDetails(error)
      this.logger.error(
        `Connector ${type} test failed for tenant ${tenantId}: ${error instanceof Error ? error.message : 'unknown'}`
      )
      this.logError('testConnection', tenantId, type, error)
    }

    return { ok, details, latencyMs: Date.now() - start }
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Encryption                                               */
  /* ---------------------------------------------------------------- */

  private decryptConfig(encryptedConfig: string): Record<string, unknown> {
    try {
      const raw = JSON.parse(encryptedConfig) as Record<string, unknown>
      if ('placeholder' in raw) return raw
      return raw
    } catch {
      // Try decrypting
    }

    try {
      const decrypted = decrypt(encryptedConfig, this.encryptionKey)
      return JSON.parse(decrypted) as Record<string, unknown>
    } catch {
      this.logger.warn('Failed to decrypt connector config, returning empty')
      this.logWarn('decryptConfig', '', '')
      return {}
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

  private logError(action: string, tenantId: string, type: string, error: unknown): void {
    this.appLogger.error(`Connector ${action} error`, {
      feature: AppLogFeature.CONNECTORS,
      action,
      outcome: AppLogOutcome.FAILURE,
      sourceType: AppLogSourceType.SERVICE,
      className: 'ConnectorsService',
      metadata: {
        tenantId,
        connectorType: type,
        error: error instanceof Error ? error.message : 'unknown',
      },
    })
  }
}
