import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
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
import { encrypt, decrypt } from '../../common/utils/encryption.util'
import { maskSecrets } from '../../common/utils/mask.util'
import { validateUrl } from '../../common/utils/ssrf.util'
import { PrismaService } from '../../prisma/prisma.service'
import type { ConnectorResponse, ConnectorTestResult as TestResult } from './connectors.types'
import type { CreateConnectorDto, UpdateConnectorDto } from './dto/connector.dto'

@Injectable()
export class ConnectorsService {
  private readonly logger = new Logger(ConnectorsService.name)
  private readonly encryptionKey: string

  constructor(
    private readonly prisma: PrismaService,
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
  }

  async findAll(tenantId: string): Promise<ConnectorResponse[]> {
    const configs = await this.prisma.connectorConfig.findMany({
      where: { tenantId },
      orderBy: { type: 'asc' },
    })

    const results = configs.map(
      (c: {
        type: string
        name: string
        enabled: boolean
        authType: string
        encryptedConfig: string
        lastTestAt: Date | null
        lastTestOk: boolean | null
        lastError: string | null
      }) => ({
        type: c.type,
        name: c.name,
        enabled: c.enabled,
        authType: c.authType,
        config: maskSecrets(this.decryptConfig(c.encryptedConfig)),
        lastTestAt: c.lastTestAt,
        lastTestOk: c.lastTestOk,
        lastError: c.lastError,
      })
    )

    this.appLogger.info('Connectors listed', {
      feature: AppLogFeature.CONNECTORS,
      action: 'findAll',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'ConnectorsService',
      functionName: 'findAll',
      metadata: { count: results.length },
    })

    return results
  }

  async findByType(tenantId: string, type: string): Promise<ConnectorResponse> {
    const config = await this.prisma.connectorConfig.findUnique({
      where: { tenantId_type: { tenantId, type: type as never } },
    })

    if (!config) {
      this.appLogger.warn('Connector not found by type', {
        feature: AppLogFeature.CONNECTORS,
        action: 'findByType',
        className: 'ConnectorsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { tenantId, connectorType: type },
      })
      throw new BusinessException(
        404,
        `Connector '${type}' not found`,
        'errors.connectors.notFound'
      )
    }

    this.appLogger.info('Connector retrieved by type', {
      feature: AppLogFeature.CONNECTORS,
      action: 'findByType',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'ConnectorsService',
      functionName: 'findByType',
      metadata: { connectorType: type },
    })

    return {
      type: config.type,
      name: config.name,
      enabled: config.enabled,
      authType: config.authType,
      config: maskSecrets(this.decryptConfig(config.encryptedConfig)),
      lastTestAt: config.lastTestAt,
      lastTestOk: config.lastTestOk,
      lastError: config.lastError,
    }
  }

  async create(tenantId: string, dto: CreateConnectorDto): Promise<ConnectorResponse> {
    const existing = await this.prisma.connectorConfig.findUnique({
      where: { tenantId_type: { tenantId, type: dto.type as never } },
    })

    if (existing) {
      this.appLogger.warn('Connector already exists', {
        feature: AppLogFeature.CONNECTORS,
        action: 'create',
        className: 'ConnectorsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { tenantId, connectorType: dto.type },
      })
      throw new BusinessException(
        409,
        `Connector '${dto.type}' already exists`,
        'errors.connectors.alreadyExists'
      )
    }

    let validatedConfig: Record<string, unknown>
    try {
      validatedConfig = validateConnectorConfig(dto.type, dto.config as Record<string, unknown>)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid connector config'
      this.appLogger.warn('Invalid connector config during create', {
        feature: AppLogFeature.CONNECTORS,
        action: 'create',
        className: 'ConnectorsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { tenantId, connectorType: dto.type, error: message },
      })
      throw new BusinessException(
        400,
        `Invalid config for '${dto.type}': ${message}`,
        'errors.connectors.invalidConfig'
      )
    }

    // SSRF validation at input time — reject private/internal URLs before storing
    this.validateConfigUrls(validatedConfig)

    const encryptedConfig = encrypt(JSON.stringify(validatedConfig), this.encryptionKey)

    const config = await this.prisma.connectorConfig.create({
      data: {
        tenantId,
        type: dto.type as never,
        name: dto.name,
        enabled: dto.enabled,
        authType: dto.authType as never,
        encryptedConfig,
      },
    })

    this.appLogger.info('Connector created', {
      feature: AppLogFeature.CONNECTORS,
      action: 'create',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      targetResource: 'Connector',
      targetResourceId: dto.type,
      sourceType: AppLogSourceType.SERVICE,
      className: 'ConnectorsService',
      functionName: 'create',
      metadata: { connectorName: dto.name, authType: dto.authType },
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

  async update(
    tenantId: string,
    type: string,
    dto: UpdateConnectorDto
  ): Promise<ConnectorResponse> {
    const existing = await this.prisma.connectorConfig.findUnique({
      where: { tenantId_type: { tenantId, type: type as never } },
    })

    if (!existing) {
      this.appLogger.warn('Connector not found for update', {
        feature: AppLogFeature.CONNECTORS,
        action: 'update',
        className: 'ConnectorsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { tenantId, connectorType: type },
      })
      throw new BusinessException(
        404,
        `Connector '${type}' not found`,
        'errors.connectors.notFound'
      )
    }

    const updateData: Record<string, unknown> = {}
    if (dto.name !== undefined) updateData.name = dto.name
    if (dto.enabled !== undefined) updateData.enabled = dto.enabled
    if (dto.authType !== undefined) updateData.authType = dto.authType
    if (dto.config !== undefined) {
      let validatedConfig: Record<string, unknown>
      try {
        validatedConfig = validateConnectorConfig(type, dto.config as Record<string, unknown>)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid connector config'
        this.appLogger.warn('Invalid connector config during update', {
          feature: AppLogFeature.CONNECTORS,
          action: 'update',
          className: 'ConnectorsService',
          sourceType: AppLogSourceType.SERVICE,
          outcome: AppLogOutcome.FAILURE,
          metadata: { tenantId, connectorType: type, error: message },
        })
        throw new BusinessException(
          400,
          `Invalid config for '${type}': ${message}`,
          'errors.connectors.invalidConfig'
        )
      }
      // SSRF validation at input time — reject private/internal URLs before storing
      this.validateConfigUrls(validatedConfig)

      updateData.encryptedConfig = encrypt(JSON.stringify(validatedConfig), this.encryptionKey)
    }

    const updated = await this.prisma.connectorConfig.update({
      where: { tenantId_type: { tenantId, type: type as never } },
      data: updateData,
    })

    this.appLogger.info('Connector updated', {
      feature: AppLogFeature.CONNECTORS,
      action: 'update',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      targetResource: 'Connector',
      targetResourceId: type,
      sourceType: AppLogSourceType.SERVICE,
      className: 'ConnectorsService',
      functionName: 'update',
      metadata: { updatedFields: Object.keys(dto) },
    })

    return {
      type: updated.type,
      name: updated.name,
      enabled: updated.enabled,
      authType: updated.authType,
      config: maskSecrets(this.decryptConfig(updated.encryptedConfig)),
      lastTestAt: updated.lastTestAt,
      lastTestOk: updated.lastTestOk,
      lastError: updated.lastError,
    }
  }

  async remove(tenantId: string, type: string): Promise<{ deleted: boolean }> {
    const existing = await this.prisma.connectorConfig.findUnique({
      where: { tenantId_type: { tenantId, type: type as never } },
    })

    if (!existing) {
      this.appLogger.warn('Connector not found for removal', {
        feature: AppLogFeature.CONNECTORS,
        action: 'remove',
        className: 'ConnectorsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { tenantId, connectorType: type },
      })
      throw new BusinessException(
        404,
        `Connector '${type}' not found`,
        'errors.connectors.notFound'
      )
    }

    await this.prisma.connectorConfig.delete({
      where: { tenantId_type: { tenantId, type: type as never } },
    })

    this.appLogger.info('Connector removed', {
      feature: AppLogFeature.CONNECTORS,
      action: 'remove',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      targetResource: 'Connector',
      targetResourceId: type,
      sourceType: AppLogSourceType.SERVICE,
      className: 'ConnectorsService',
      functionName: 'remove',
    })

    return { deleted: true }
  }

  async toggle(
    tenantId: string,
    type: string,
    enabled: boolean
  ): Promise<{ type: string; enabled: boolean }> {
    await this.prisma.connectorConfig.update({
      where: { tenantId_type: { tenantId, type: type as never } },
      data: { enabled },
    })

    this.appLogger.info(`Connector ${enabled ? 'enabled' : 'disabled'}`, {
      feature: AppLogFeature.CONNECTORS,
      action: 'toggle',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      targetResource: 'Connector',
      targetResourceId: type,
      sourceType: AppLogSourceType.SERVICE,
      className: 'ConnectorsService',
      functionName: 'toggle',
      metadata: { enabled },
    })

    return { type, enabled }
  }

  async testConnection(tenantId: string, type: string): Promise<TestResult> {
    const config = await this.prisma.connectorConfig.findUnique({
      where: { tenantId_type: { tenantId, type: type as never } },
    })

    if (!config) {
      this.appLogger.warn('Connector not found for test', {
        feature: AppLogFeature.CONNECTORS,
        action: 'testConnection',
        className: 'ConnectorsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { tenantId, connectorType: type },
      })
      throw new BusinessException(
        404,
        `Connector '${type}' not found`,
        'errors.connectors.notFound'
      )
    }

    const decryptedConfig = this.decryptConfig(config.encryptedConfig)
    const start = Date.now()

    let ok = false
    let details = ''

    try {
      switch (type) {
        case 'wazuh': {
          const { ok: wazuhOk, details: wazuhDetails } =
            await this.wazuhService.testConnection(decryptedConfig)
          ok = wazuhOk
          details = wazuhDetails
          break
        }
        case 'graylog': {
          const { ok: graylogOk, details: graylogDetails } =
            await this.graylogService.testConnection(decryptedConfig)
          ok = graylogOk
          details = graylogDetails
          break
        }
        case 'logstash': {
          const { ok: logstashOk, details: logstashDetails } =
            await this.logstashService.testConnection(decryptedConfig)
          ok = logstashOk
          details = logstashDetails
          break
        }
        case 'velociraptor': {
          const { ok: velociraptorOk, details: velociraptorDetails } =
            await this.velociraptorService.testConnection(decryptedConfig)
          ok = velociraptorOk
          details = velociraptorDetails
          break
        }
        case 'grafana': {
          const { ok: grafanaOk, details: grafanaDetails } =
            await this.grafanaService.testConnection(decryptedConfig)
          ok = grafanaOk
          details = grafanaDetails
          break
        }
        case 'influxdb': {
          const { ok: influxdbOk, details: influxdbDetails } =
            await this.influxdbService.testConnection(decryptedConfig)
          ok = influxdbOk
          details = influxdbDetails
          break
        }
        case 'misp': {
          const { ok: mispOk, details: mispDetails } =
            await this.mispService.testConnection(decryptedConfig)
          ok = mispOk
          details = mispDetails
          break
        }
        case 'shuffle': {
          const { ok: shuffleOk, details: shuffleDetails } =
            await this.shuffleService.testConnection(decryptedConfig)
          ok = shuffleOk
          details = shuffleDetails
          break
        }
        case 'bedrock': {
          const { ok: bedrockOk, details: bedrockDetails } =
            await this.bedrockService.testConnection(decryptedConfig)
          ok = bedrockOk
          details = bedrockDetails
          break
        }
        default:
          details = `Unknown connector type: ${type}`
      }
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : 'Connection test failed'
      // L11: Sanitize error details — strip internal paths and stack traces
      details = rawMessage.replaceAll(/\/[\w./-]+/g, '[path]').slice(0, 500)
      this.logger.error(`Connector ${type} test failed for tenant ${tenantId}: ${rawMessage}`)
      this.appLogger.error('Connector test connection failed with exception', {
        feature: AppLogFeature.CONNECTORS,
        action: 'testConnection',
        className: 'ConnectorsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { tenantId, connectorType: type, error: rawMessage },
      })
    }

    const latencyMs = Date.now() - start
    const testedAt = new Date()

    await this.prisma.connectorConfig.update({
      where: { tenantId_type: { tenantId, type: type as never } },
      data: {
        lastTestAt: testedAt,
        lastTestOk: ok,
        lastError: ok ? null : details.slice(0, 500),
      },
    })

    this.appLogger.info(`Connector test ${ok ? 'succeeded' : 'failed'}`, {
      feature: AppLogFeature.CONNECTORS,
      action: 'testConnection',
      outcome: ok ? AppLogOutcome.SUCCESS : AppLogOutcome.FAILURE,
      tenantId,
      targetResource: 'Connector',
      targetResourceId: type,
      sourceType: AppLogSourceType.SERVICE,
      className: 'ConnectorsService',
      functionName: 'testConnection',
      metadata: { latencyMs, ok },
    })

    return { type, ok, latencyMs, details, testedAt: testedAt.toISOString() }
  }

  /**
   * Get decrypted config for a connector (used by other modules).
   */
  async getDecryptedConfig(
    tenantId: string,
    type: string
  ): Promise<Record<string, unknown> | null> {
    const config = await this.prisma.connectorConfig.findUnique({
      where: { tenantId_type: { tenantId, type: type as never } },
    })

    if (!config?.enabled) return null

    this.appLogger.debug('Decrypted connector config accessed', {
      feature: AppLogFeature.CONNECTORS,
      action: 'getDecryptedConfig',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      targetResource: 'Connector',
      targetResourceId: type,
      sourceType: AppLogSourceType.SERVICE,
      className: 'ConnectorsService',
      functionName: 'getDecryptedConfig',
    })

    return this.decryptConfig(config.encryptedConfig)
  }

  /**
   * Check if a connector is enabled for a tenant.
   */
  async isEnabled(tenantId: string, type: string): Promise<boolean> {
    const config = await this.prisma.connectorConfig.findUnique({
      where: { tenantId_type: { tenantId, type: type as never } },
      select: { enabled: true },
    })

    return config?.enabled ?? false
  }

  /**
   * Get all enabled connectors for a tenant.
   */
  async getEnabledConnectors(tenantId: string): Promise<Array<{ type: string; name: string }>> {
    const configs = await this.prisma.connectorConfig.findMany({
      where: { tenantId, enabled: true },
      select: { type: true, name: true },
      orderBy: { type: 'asc' },
    })

    return configs.map(c => ({ type: c.type, name: c.name }))
  }

  /**
   * Validate all URL fields in a connector config against SSRF rules at input time.
   * Connectors intentionally connect to private infrastructure, so this only rejects
   * metadata endpoints (169.254.x) and loopback — internal ranges are allowed.
   */
  private validateConfigUrls(config: Record<string, unknown>): void {
    const urlKeys = ['baseUrl', 'managerUrl', 'indexerUrl', 'webhookUrl']
    for (const key of urlKeys) {
      const value = config[key]
      if (typeof value === 'string' && value.length > 0) {
        // validateUrl throws BusinessException for private/invalid URLs
        validateUrl(value)
      }
    }
  }

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
      this.appLogger.warn('Failed to decrypt connector config', {
        feature: AppLogFeature.CONNECTORS,
        action: 'decryptConfig',
        className: 'ConnectorsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: {},
      })
      return {}
    }
  }
}
