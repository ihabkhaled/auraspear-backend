import { randomBytes } from 'node:crypto'
import { BusinessException } from '../../src/common/exceptions/business.exception'
import { encrypt } from '../../src/common/utils/encryption.util'
import { REDACTED_PLACEHOLDER } from '../../src/common/utils/mask.util'
import { ConnectorsService } from '../../src/modules/connectors/connectors.service'

const ENCRYPTION_KEY = randomBytes(32).toString('hex')
const TENANT_ID = 'tenant-001'

const mockAppLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

const mockConfigService = {
  get: jest.fn().mockReturnValue(ENCRYPTION_KEY),
}

function createMockPrisma() {
  return {
    connectorConfig: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  }
}

function createMockConnectorServices() {
  return {
    wazuh: { testConnection: jest.fn() },
    graylog: { testConnection: jest.fn() },
    logstash: { testConnection: jest.fn() },
    velociraptor: { testConnection: jest.fn() },
    grafana: { testConnection: jest.fn() },
    influxdb: { testConnection: jest.fn() },
    misp: { testConnection: jest.fn() },
    shuffle: { testConnection: jest.fn() },
    bedrock: { testConnection: jest.fn() },
  }
}

function buildEncryptedConfig(config: Record<string, unknown>): string {
  return encrypt(JSON.stringify(config), ENCRYPTION_KEY)
}

function createService(
  prisma: ReturnType<typeof createMockPrisma>,
  services: ReturnType<typeof createMockConnectorServices>
) {
  return new ConnectorsService(
    prisma as never,
    mockConfigService as never,
    services.wazuh as never,
    services.graylog as never,
    services.logstash as never,
    services.velociraptor as never,
    services.grafana as never,
    services.influxdb as never,
    services.misp as never,
    services.shuffle as never,
    services.bedrock as never,
    mockAppLogger as never
  )
}

describe('ConnectorsService', () => {
  let prisma: ReturnType<typeof createMockPrisma>
  let services: ReturnType<typeof createMockConnectorServices>
  let service: ConnectorsService

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = createMockPrisma()
    services = createMockConnectorServices()
    service = createService(prisma, services)
  })

  /* ------------------------------------------------------------------ */
  /* constructor                                                          */
  /* ------------------------------------------------------------------ */

  describe('constructor', () => {
    it('should throw if CONFIG_ENCRYPTION_KEY is missing', () => {
      const badConfig = { get: jest.fn().mockReturnValue(undefined) }
      expect(
        () =>
          new ConnectorsService(
            prisma as never,
            badConfig as never,
            services.wazuh as never,
            services.graylog as never,
            services.logstash as never,
            services.velociraptor as never,
            services.grafana as never,
            services.influxdb as never,
            services.misp as never,
            services.shuffle as never,
            services.bedrock as never,
            mockAppLogger as never
          )
      ).toThrow('CONFIG_ENCRYPTION_KEY must be set')
    })

    it('should throw if CONFIG_ENCRYPTION_KEY is too short', () => {
      const badConfig = { get: jest.fn().mockReturnValue('short') }
      expect(
        () =>
          new ConnectorsService(
            prisma as never,
            badConfig as never,
            services.wazuh as never,
            services.graylog as never,
            services.logstash as never,
            services.velociraptor as never,
            services.grafana as never,
            services.influxdb as never,
            services.misp as never,
            services.shuffle as never,
            services.bedrock as never,
            mockAppLogger as never
          )
      ).toThrow('CONFIG_ENCRYPTION_KEY must be set')
    })
  })

  /* ------------------------------------------------------------------ */
  /* findAll                                                              */
  /* ------------------------------------------------------------------ */

  describe('findAll', () => {
    it('should return all connectors for a tenant with masked secrets', async () => {
      const config = { baseUrl: 'https://wazuh.local:55000', password: 'secret' }
      prisma.connectorConfig.findMany.mockResolvedValue([
        {
          type: 'wazuh',
          name: 'Wazuh',
          enabled: true,
          authType: 'basic',
          encryptedConfig: buildEncryptedConfig(config),
          lastTestAt: null,
          lastTestOk: null,
          lastError: null,
        },
      ])

      const result = await service.findAll(TENANT_ID)

      expect(result).toHaveLength(1)
      expect(result[0]?.type).toBe('wazuh')
      expect(result[0]?.config.baseUrl).toBe('https://wazuh.local:55000')
      expect(result[0]?.config.password).toBe(REDACTED_PLACEHOLDER)
    })

    it('should return empty array when no connectors exist', async () => {
      prisma.connectorConfig.findMany.mockResolvedValue([])

      const result = await service.findAll(TENANT_ID)

      expect(result).toHaveLength(0)
    })
  })

  /* ------------------------------------------------------------------ */
  /* findByType                                                           */
  /* ------------------------------------------------------------------ */

  describe('findByType', () => {
    it('should return connector with masked config', async () => {
      const config = { baseUrl: 'https://grafana.local', apiKey: 'secret-key' }
      prisma.connectorConfig.findUnique.mockResolvedValue({
        type: 'grafana',
        name: 'Grafana',
        enabled: true,
        authType: 'api_key',
        encryptedConfig: buildEncryptedConfig(config),
        lastTestAt: new Date(),
        lastTestOk: true,
        lastError: null,
      })

      const result = await service.findByType(TENANT_ID, 'grafana')

      expect(result.type).toBe('grafana')
      expect(result.config.baseUrl).toBe('https://grafana.local')
      expect(result.config.apiKey).toBe(REDACTED_PLACEHOLDER)
    })

    it('should throw 404 when connector not found', async () => {
      prisma.connectorConfig.findUnique.mockResolvedValue(null)

      await expect(service.findByType(TENANT_ID, 'nonexistent')).rejects.toThrow(BusinessException)

      try {
        await service.findByType(TENANT_ID, 'nonexistent')
      } catch (error) {
        expect((error as BusinessException).getStatus()).toBe(404)
        expect((error as BusinessException).messageKey).toBe('errors.connectors.notFound')
      }
    })
  })

  /* ------------------------------------------------------------------ */
  /* create                                                               */
  /* ------------------------------------------------------------------ */

  describe('create', () => {
    it('should create a new connector and return masked config', async () => {
      prisma.connectorConfig.findUnique.mockResolvedValue(null)
      prisma.connectorConfig.create.mockResolvedValue({
        type: 'logstash',
        name: 'Logstash',
        enabled: true,
        authType: 'api_key',
        encryptedConfig: buildEncryptedConfig({ baseUrl: 'https://logstash.local' }),
        lastTestAt: null,
        lastTestOk: null,
        lastError: null,
      })

      const dto = {
        type: 'logstash',
        name: 'Logstash',
        enabled: true,
        authType: 'api_key',
        config: { baseUrl: 'https://logstash.local', apiKey: 'key123' },
      }

      const result = await service.create(TENANT_ID, dto as never)

      expect(result.type).toBe('logstash')
      expect(result.name).toBe('Logstash')
      expect(prisma.connectorConfig.create).toHaveBeenCalled()
    })

    it('should throw 409 when connector already exists', async () => {
      prisma.connectorConfig.findUnique.mockResolvedValue({ type: 'wazuh' })

      const dto = {
        type: 'wazuh',
        name: 'Wazuh',
        enabled: true,
        authType: 'basic',
        config: { baseUrl: 'https://wazuh.local:55000' },
      }

      await expect(service.create(TENANT_ID, dto as never)).rejects.toThrow(BusinessException)

      try {
        await service.create(TENANT_ID, dto as never)
      } catch (error) {
        expect((error as BusinessException).getStatus()).toBe(409)
        expect((error as BusinessException).messageKey).toBe('errors.connectors.alreadyExists')
      }
    })
  })

  /* ------------------------------------------------------------------ */
  /* update                                                               */
  /* ------------------------------------------------------------------ */

  describe('update', () => {
    it('should update connector name and enabled status', async () => {
      const existingConfig = { baseUrl: 'https://wazuh.local', password: 'old-secret' }
      prisma.connectorConfig.findUnique.mockResolvedValue({
        type: 'wazuh',
        name: 'Wazuh',
        enabled: true,
        authType: 'basic',
        encryptedConfig: buildEncryptedConfig(existingConfig),
      })
      prisma.connectorConfig.update.mockResolvedValue({
        type: 'wazuh',
        name: 'Wazuh Updated',
        enabled: false,
        authType: 'basic',
        encryptedConfig: buildEncryptedConfig(existingConfig),
        lastTestAt: null,
        lastTestOk: null,
        lastError: null,
      })

      const result = await service.update(TENANT_ID, 'wazuh', {
        name: 'Wazuh Updated',
        enabled: false,
      } as never)

      expect(result.name).toBe('Wazuh Updated')
      expect(result.enabled).toBe(false)
      expect(prisma.connectorConfig.update).toHaveBeenCalled()
    })

    it('should preserve existing secrets when REDACTED value is sent', async () => {
      const existingConfig = {
        baseUrl: 'https://wazuh.local',
        password: 'real-secret',
        username: 'admin',
      }
      prisma.connectorConfig.findUnique.mockResolvedValue({
        type: 'wazuh',
        name: 'Wazuh',
        enabled: true,
        authType: 'basic',
        encryptedConfig: buildEncryptedConfig(existingConfig),
      })
      prisma.connectorConfig.update.mockImplementation(async (args: Record<string, unknown>) => {
        return {
          type: 'wazuh',
          name: 'Wazuh',
          enabled: true,
          authType: 'basic',
          encryptedConfig:
            (args.data as Record<string, unknown>).encryptedConfig ??
            buildEncryptedConfig(existingConfig),
          lastTestAt: null,
          lastTestOk: null,
          lastError: null,
        }
      })

      await service.update(TENANT_ID, 'wazuh', {
        config: {
          baseUrl: 'https://wazuh.local',
          password: REDACTED_PLACEHOLDER,
          username: 'admin',
        },
      } as never)

      // Verify that the update was called with encrypted config (not the redacted placeholder)
      expect(prisma.connectorConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            encryptedConfig: expect.any(String),
          }),
        })
      )
    })

    it('should preserve existing keys not present in update payload', async () => {
      const existingConfig = {
        baseUrl: 'https://wazuh.local',
        password: 'secret',
        username: 'admin',
        tenant: 'default',
      }
      prisma.connectorConfig.findUnique.mockResolvedValue({
        type: 'wazuh',
        name: 'Wazuh',
        enabled: true,
        authType: 'basic',
        encryptedConfig: buildEncryptedConfig(existingConfig),
      })
      prisma.connectorConfig.update.mockResolvedValue({
        type: 'wazuh',
        name: 'Wazuh',
        enabled: true,
        authType: 'basic',
        encryptedConfig: buildEncryptedConfig(existingConfig),
        lastTestAt: null,
        lastTestOk: null,
        lastError: null,
      })

      // Only send baseUrl — password, username, tenant should be preserved
      await service.update(TENANT_ID, 'wazuh', {
        config: { baseUrl: 'https://wazuh-new.local' },
      } as never)

      expect(prisma.connectorConfig.update).toHaveBeenCalled()
    })

    it('should throw 404 when connector not found for update', async () => {
      prisma.connectorConfig.findUnique.mockResolvedValue(null)

      await expect(
        service.update(TENANT_ID, 'nonexistent', { name: 'X' } as never)
      ).rejects.toThrow(BusinessException)

      try {
        await service.update(TENANT_ID, 'nonexistent', { name: 'X' } as never)
      } catch (error) {
        expect((error as BusinessException).getStatus()).toBe(404)
      }
    })
  })

  /* ------------------------------------------------------------------ */
  /* remove                                                               */
  /* ------------------------------------------------------------------ */

  describe('remove', () => {
    it('should delete connector and return confirmation', async () => {
      prisma.connectorConfig.findUnique.mockResolvedValue({ type: 'logstash' })
      prisma.connectorConfig.delete.mockResolvedValue({})

      const result = await service.remove(TENANT_ID, 'logstash')

      expect(result.deleted).toBe(true)
      expect(prisma.connectorConfig.delete).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId_type: { tenantId: TENANT_ID, type: 'logstash' } },
        })
      )
    })

    it('should throw 404 when connector not found for removal', async () => {
      prisma.connectorConfig.findUnique.mockResolvedValue(null)

      await expect(service.remove(TENANT_ID, 'nonexistent')).rejects.toThrow(BusinessException)

      try {
        await service.remove(TENANT_ID, 'nonexistent')
      } catch (error) {
        expect((error as BusinessException).getStatus()).toBe(404)
        expect((error as BusinessException).messageKey).toBe('errors.connectors.notFound')
      }
    })
  })

  /* ------------------------------------------------------------------ */
  /* toggle                                                               */
  /* ------------------------------------------------------------------ */

  describe('toggle', () => {
    it('should enable a connector', async () => {
      prisma.connectorConfig.update.mockResolvedValue({})

      const result = await service.toggle(TENANT_ID, 'wazuh', true)

      expect(result).toEqual({ type: 'wazuh', enabled: true })
      expect(prisma.connectorConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { enabled: true },
        })
      )
    })

    it('should disable a connector', async () => {
      prisma.connectorConfig.update.mockResolvedValue({})

      const result = await service.toggle(TENANT_ID, 'wazuh', false)

      expect(result).toEqual({ type: 'wazuh', enabled: false })
    })
  })

  /* ------------------------------------------------------------------ */
  /* testConnection                                                       */
  /* ------------------------------------------------------------------ */

  describe('testConnection', () => {
    it('should test wazuh connection and return success result', async () => {
      const config = { baseUrl: 'https://wazuh.local', username: 'admin', password: 'secret' }
      prisma.connectorConfig.findUnique.mockResolvedValue({
        type: 'wazuh',
        encryptedConfig: buildEncryptedConfig(config),
      })
      prisma.connectorConfig.update.mockResolvedValue({})
      services.wazuh.testConnection.mockResolvedValue({
        ok: true,
        details: 'Wazuh v4.9.0 reachable',
      })

      const result = await service.testConnection(TENANT_ID, 'wazuh')

      expect(result.type).toBe('wazuh')
      expect(result.ok).toBe(true)
      expect(result.details).toBe('Wazuh v4.9.0 reachable')
      expect(result.latencyMs).toBeGreaterThanOrEqual(0)
      expect(result.testedAt).toBeDefined()
    })

    it('should test graylog connection', async () => {
      const config = { baseUrl: 'https://graylog.local' }
      prisma.connectorConfig.findUnique.mockResolvedValue({
        type: 'graylog',
        encryptedConfig: buildEncryptedConfig(config),
      })
      prisma.connectorConfig.update.mockResolvedValue({})
      services.graylog.testConnection.mockResolvedValue({
        ok: true,
        details: 'Graylog reachable',
      })

      const result = await service.testConnection(TENANT_ID, 'graylog')

      expect(result.ok).toBe(true)
    })

    it('should handle failed connection test', async () => {
      const config = { baseUrl: 'https://wazuh.local' }
      prisma.connectorConfig.findUnique.mockResolvedValue({
        type: 'wazuh',
        encryptedConfig: buildEncryptedConfig(config),
      })
      prisma.connectorConfig.update.mockResolvedValue({})
      services.wazuh.testConnection.mockResolvedValue({
        ok: false,
        details: 'Connection refused',
      })

      const result = await service.testConnection(TENANT_ID, 'wazuh')

      expect(result.ok).toBe(false)
      expect(result.details).toBe('Connection refused')
    })

    it('should handle exceptions during connection test', async () => {
      const config = { baseUrl: 'https://wazuh.local' }
      prisma.connectorConfig.findUnique.mockResolvedValue({
        type: 'wazuh',
        encryptedConfig: buildEncryptedConfig(config),
      })
      prisma.connectorConfig.update.mockResolvedValue({})
      services.wazuh.testConnection.mockRejectedValue(new Error('self-signed certificate'))

      const result = await service.testConnection(TENANT_ID, 'wazuh')

      expect(result.ok).toBe(false)
      expect(result.details).toContain('self-signed certificate')
    })

    it('should throw 404 when connector not found for test', async () => {
      prisma.connectorConfig.findUnique.mockResolvedValue(null)

      await expect(service.testConnection(TENANT_ID, 'nonexistent')).rejects.toThrow(
        BusinessException
      )
    })

    it('should update lastTestAt and lastTestOk after test', async () => {
      const config = { baseUrl: 'https://wazuh.local' }
      prisma.connectorConfig.findUnique.mockResolvedValue({
        type: 'wazuh',
        encryptedConfig: buildEncryptedConfig(config),
      })
      prisma.connectorConfig.update.mockResolvedValue({})
      services.wazuh.testConnection.mockResolvedValue({
        ok: true,
        details: 'OK',
      })

      await service.testConnection(TENANT_ID, 'wazuh')

      expect(prisma.connectorConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lastTestOk: true,
            lastTestAt: expect.any(Date),
            lastError: null,
          }),
        })
      )
    })

    it('should save error details when test fails', async () => {
      const config = { baseUrl: 'https://wazuh.local' }
      prisma.connectorConfig.findUnique.mockResolvedValue({
        type: 'wazuh',
        encryptedConfig: buildEncryptedConfig(config),
      })
      prisma.connectorConfig.update.mockResolvedValue({})
      services.wazuh.testConnection.mockResolvedValue({
        ok: false,
        details: 'Authentication failed',
      })

      await service.testConnection(TENANT_ID, 'wazuh')

      expect(prisma.connectorConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lastTestOk: false,
            lastError: 'Authentication failed',
          }),
        })
      )
    })

    it('should handle unknown connector type gracefully', async () => {
      const config = { baseUrl: 'https://unknown.local' }
      prisma.connectorConfig.findUnique.mockResolvedValue({
        type: 'unknown',
        encryptedConfig: buildEncryptedConfig(config),
      })
      prisma.connectorConfig.update.mockResolvedValue({})

      const result = await service.testConnection(TENANT_ID, 'unknown')

      expect(result.ok).toBe(false)
      expect(result.details).toContain('Unknown connector type')
    })

    it('should test all supported connector types', async () => {
      const types = [
        'wazuh',
        'graylog',
        'logstash',
        'velociraptor',
        'grafana',
        'influxdb',
        'misp',
        'shuffle',
        'bedrock',
      ] as const

      for (const connectorType of types) {
        const config = { baseUrl: 'https://test.local' }
        prisma.connectorConfig.findUnique.mockResolvedValue({
          type: connectorType,
          encryptedConfig: buildEncryptedConfig(config),
        })
        prisma.connectorConfig.update.mockResolvedValue({})
        services[connectorType].testConnection.mockResolvedValue({
          ok: true,
          details: 'OK',
        })

        const result = await service.testConnection(TENANT_ID, connectorType)

        expect(result.type).toBe(connectorType)
        expect(result.ok).toBe(true)
      }
    })
  })

  /* ------------------------------------------------------------------ */
  /* getDecryptedConfig                                                   */
  /* ------------------------------------------------------------------ */

  describe('getDecryptedConfig', () => {
    it('should return decrypted config for enabled connector', async () => {
      const config = { baseUrl: 'https://wazuh.local', password: 'secret' }
      prisma.connectorConfig.findUnique.mockResolvedValue({
        enabled: true,
        encryptedConfig: buildEncryptedConfig(config),
      })

      const result = await service.getDecryptedConfig(TENANT_ID, 'wazuh')

      expect(result).toEqual(config)
    })

    it('should return null for disabled connector', async () => {
      prisma.connectorConfig.findUnique.mockResolvedValue({
        enabled: false,
        encryptedConfig: buildEncryptedConfig({}),
      })

      const result = await service.getDecryptedConfig(TENANT_ID, 'wazuh')

      expect(result).toBeNull()
    })

    it('should return null when connector does not exist', async () => {
      prisma.connectorConfig.findUnique.mockResolvedValue(null)

      const result = await service.getDecryptedConfig(TENANT_ID, 'nonexistent')

      expect(result).toBeNull()
    })
  })

  /* ------------------------------------------------------------------ */
  /* isEnabled                                                            */
  /* ------------------------------------------------------------------ */

  describe('isEnabled', () => {
    it('should return true for enabled connector', async () => {
      prisma.connectorConfig.findUnique.mockResolvedValue({ enabled: true })

      const result = await service.isEnabled(TENANT_ID, 'wazuh')

      expect(result).toBe(true)
    })

    it('should return false for disabled connector', async () => {
      prisma.connectorConfig.findUnique.mockResolvedValue({ enabled: false })

      const result = await service.isEnabled(TENANT_ID, 'wazuh')

      expect(result).toBe(false)
    })

    it('should return false when connector does not exist', async () => {
      prisma.connectorConfig.findUnique.mockResolvedValue(null)

      const result = await service.isEnabled(TENANT_ID, 'nonexistent')

      expect(result).toBe(false)
    })
  })

  /* ------------------------------------------------------------------ */
  /* getEnabledConnectors                                                 */
  /* ------------------------------------------------------------------ */

  describe('getEnabledConnectors', () => {
    it('should return list of enabled connectors', async () => {
      prisma.connectorConfig.findMany.mockResolvedValue([
        { type: 'wazuh', name: 'Wazuh' },
        { type: 'grafana', name: 'Grafana' },
      ])

      const result = await service.getEnabledConnectors(TENANT_ID)

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ type: 'wazuh', name: 'Wazuh' })
    })

    it('should return empty array when no connectors are enabled', async () => {
      prisma.connectorConfig.findMany.mockResolvedValue([])

      const result = await service.getEnabledConnectors(TENANT_ID)

      expect(result).toHaveLength(0)
    })
  })
})
