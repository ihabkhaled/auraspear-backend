import { BusinessException } from '../../src/common/exceptions/business.exception'
import { AlertsService } from '../../src/modules/alerts/alerts.service'

const mockAppLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

function createMockPrisma() {
  return {
    alert: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      groupBy: jest.fn(),
      upsert: jest.fn(),
    },
    $queryRaw: jest.fn(),
  }
}

function createMockConnectorsService() {
  return {
    getDecryptedConfig: jest.fn(),
  }
}

function createMockWazuhService() {
  return {
    searchAlerts: jest.fn(),
  }
}

const TENANT_ID = 'tenant-001'
const ALERT_ID = 'alert-001'
const USER_EMAIL = 'analyst@auraspear.com'

function buildDefaultQuery(overrides: Record<string, unknown> = {}) {
  return {
    query: '*',
    page: 1,
    limit: 20,
    sortBy: 'timestamp' as const,
    sortOrder: 'desc' as const,
    ...overrides,
  }
}

function buildMockAlert(overrides: Record<string, unknown> = {}) {
  return {
    id: ALERT_ID,
    tenantId: TENANT_ID,
    externalId: 'ext-001',
    title: 'Suspicious Login Attempt',
    description: 'Multiple failed SSH login attempts detected',
    severity: 'high',
    status: 'new_alert',
    source: 'wazuh',
    ruleName: 'SSH brute force',
    ruleId: 'rule-5710',
    agentName: 'web-server-01',
    sourceIp: '192.168.1.100',
    destinationIp: '10.0.0.5',
    mitreTactics: ['Initial Access'],
    mitreTechniques: ['T1078'],
    rawEvent: {},
    acknowledgedBy: null,
    acknowledgedAt: null,
    closedBy: null,
    closedAt: null,
    resolution: null,
    timestamp: new Date('2025-06-01T12:00:00Z'),
    createdAt: new Date('2025-06-01T12:00:00Z'),
    updatedAt: new Date('2025-06-01T12:00:00Z'),
    ...overrides,
  }
}

describe('AlertsService', () => {
  let service: AlertsService
  let prisma: ReturnType<typeof createMockPrisma>
  let connectorsService: ReturnType<typeof createMockConnectorsService>
  let wazuhService: ReturnType<typeof createMockWazuhService>

  beforeEach(() => {
    prisma = createMockPrisma()
    connectorsService = createMockConnectorsService()
    wazuhService = createMockWazuhService()
    jest.clearAllMocks()

    service = new AlertsService(
      prisma as never,
      connectorsService as never,
      wazuhService as never,
      mockAppLogger as never
    )
  })

  // ---------------------------------------------------------------------------
  // search
  // ---------------------------------------------------------------------------
  describe('search', () => {
    it('should return paginated results with data and pagination meta', async () => {
      const alerts = [buildMockAlert(), buildMockAlert({ id: 'alert-002' })]
      prisma.alert.findMany.mockResolvedValue(alerts)
      prisma.alert.count.mockResolvedValue(2)

      const result = await service.search(TENANT_ID, buildDefaultQuery())

      expect(result.data).toHaveLength(2)
      expect(result.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      })
      expect(prisma.alert.findMany).toHaveBeenCalledTimes(1)
      expect(prisma.alert.count).toHaveBeenCalledTimes(1)
    })

    it('should filter by single severity', async () => {
      prisma.alert.findMany.mockResolvedValue([])
      prisma.alert.count.mockResolvedValue(0)

      await service.search(TENANT_ID, buildDefaultQuery({ severity: 'critical' }))

      const whereArgument = prisma.alert.findMany.mock.calls[0][0].where
      expect(whereArgument.severity).toBe('critical')
    })

    it('should filter by comma-separated multiple severities', async () => {
      prisma.alert.findMany.mockResolvedValue([])
      prisma.alert.count.mockResolvedValue(0)

      await service.search(TENANT_ID, buildDefaultQuery({ severity: 'critical,high' }))

      const whereArgument = prisma.alert.findMany.mock.calls[0][0].where
      expect(whereArgument.severity).toEqual({ in: ['critical', 'high'] })
    })

    it('should ignore invalid severities in comma-separated list', async () => {
      prisma.alert.findMany.mockResolvedValue([])
      prisma.alert.count.mockResolvedValue(0)

      await service.search(TENANT_ID, buildDefaultQuery({ severity: 'critical,bogus' }))

      const whereArgument = prisma.alert.findMany.mock.calls[0][0].where
      expect(whereArgument.severity).toBe('critical')
    })

    it('should filter by status', async () => {
      prisma.alert.findMany.mockResolvedValue([])
      prisma.alert.count.mockResolvedValue(0)

      await service.search(TENANT_ID, buildDefaultQuery({ status: 'new_alert' }))

      const whereArgument = prisma.alert.findMany.mock.calls[0][0].where
      expect(whereArgument.status).toBe('new_alert')
    })

    it('should filter by source', async () => {
      prisma.alert.findMany.mockResolvedValue([])
      prisma.alert.count.mockResolvedValue(0)

      await service.search(TENANT_ID, buildDefaultQuery({ source: 'wazuh' }))

      const whereArgument = prisma.alert.findMany.mock.calls[0][0].where
      expect(whereArgument.source).toBe('wazuh')
    })

    it('should filter by agentName with case-insensitive contains', async () => {
      prisma.alert.findMany.mockResolvedValue([])
      prisma.alert.count.mockResolvedValue(0)

      await service.search(TENANT_ID, buildDefaultQuery({ agentName: 'web-01' }))

      const whereArgument = prisma.alert.findMany.mock.calls[0][0].where
      expect(whereArgument.agentName).toEqual({ contains: 'web-01', mode: 'insensitive' })
    })

    it('should filter by ruleGroup with case-insensitive contains on ruleName', async () => {
      prisma.alert.findMany.mockResolvedValue([])
      prisma.alert.count.mockResolvedValue(0)

      await service.search(TENANT_ID, buildDefaultQuery({ ruleGroup: 'SSH' }))

      const whereArgument = prisma.alert.findMany.mock.calls[0][0].where
      expect(whereArgument.ruleName).toEqual({ contains: 'SSH', mode: 'insensitive' })
    })

    it('should filter by timeRange 24h', async () => {
      prisma.alert.findMany.mockResolvedValue([])
      prisma.alert.count.mockResolvedValue(0)

      const before = new Date()
      await service.search(TENANT_ID, buildDefaultQuery({ timeRange: '24h' }))

      const whereArgument = prisma.alert.findMany.mock.calls[0][0].where
      expect(whereArgument.timestamp).toBeDefined()
      expect(whereArgument.timestamp.gte).toBeInstanceOf(Date)
      const diffMs = before.getTime() - whereArgument.timestamp.gte.getTime()
      // Should be approximately 24 hours (86400000ms), allow 5s tolerance
      expect(diffMs).toBeGreaterThan(86400000 - 5000)
      expect(diffMs).toBeLessThan(86400000 + 5000)
    })

    it('should filter by timeRange 7d', async () => {
      prisma.alert.findMany.mockResolvedValue([])
      prisma.alert.count.mockResolvedValue(0)

      const before = new Date()
      await service.search(TENANT_ID, buildDefaultQuery({ timeRange: '7d' }))

      const whereArgument = prisma.alert.findMany.mock.calls[0][0].where
      expect(whereArgument.timestamp).toBeDefined()
      const diffMs = before.getTime() - whereArgument.timestamp.gte.getTime()
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
      expect(diffMs).toBeGreaterThan(sevenDaysMs - 5000)
      expect(diffMs).toBeLessThan(sevenDaysMs + 5000)
    })

    it('should filter by timeRange 30d', async () => {
      prisma.alert.findMany.mockResolvedValue([])
      prisma.alert.count.mockResolvedValue(0)

      const before = new Date()
      await service.search(TENANT_ID, buildDefaultQuery({ timeRange: '30d' }))

      const whereArgument = prisma.alert.findMany.mock.calls[0][0].where
      expect(whereArgument.timestamp).toBeDefined()
      const diffMs = before.getTime() - whereArgument.timestamp.gte.getTime()
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
      expect(diffMs).toBeGreaterThan(thirtyDaysMs - 5000)
      expect(diffMs).toBeLessThan(thirtyDaysMs + 5000)
    })

    it('should filter by explicit from/to date range', async () => {
      prisma.alert.findMany.mockResolvedValue([])
      prisma.alert.count.mockResolvedValue(0)

      const from = '2025-01-01T00:00:00Z'
      const to = '2025-06-01T00:00:00Z'
      await service.search(TENANT_ID, buildDefaultQuery({ from, to }))

      const whereArgument = prisma.alert.findMany.mock.calls[0][0].where
      expect(whereArgument.timestamp.gte).toEqual(new Date(from))
      expect(whereArgument.timestamp.lte).toEqual(new Date(to))
    })

    it('should prefer timeRange over explicit from/to', async () => {
      prisma.alert.findMany.mockResolvedValue([])
      prisma.alert.count.mockResolvedValue(0)

      await service.search(
        TENANT_ID,
        buildDefaultQuery({
          timeRange: '24h',
          from: '2020-01-01T00:00:00Z',
          to: '2020-12-31T00:00:00Z',
        })
      )

      const whereArgument = prisma.alert.findMany.mock.calls[0][0].where
      // Should use timeRange (gte only), not explicit from/to (gte + lte from 2020)
      expect(whereArgument.timestamp.gte).toBeInstanceOf(Date)
      expect(whereArgument.timestamp.lte).toBeUndefined()
    })

    it('should apply KQL query severity:"critical" (quoted value)', async () => {
      prisma.alert.findMany.mockResolvedValue([])
      prisma.alert.count.mockResolvedValue(0)

      await service.search(TENANT_ID, buildDefaultQuery({ query: 'severity:"critical"' }))

      const whereArgument = prisma.alert.findMany.mock.calls[0][0].where
      expect(whereArgument.severity).toBe('critical')
    })

    it('should apply KQL query agent.name:"web-01" (quoted value)', async () => {
      prisma.alert.findMany.mockResolvedValue([])
      prisma.alert.count.mockResolvedValue(0)

      await service.search(TENANT_ID, buildDefaultQuery({ query: 'agent.name:"web-01"' }))

      const whereArgument = prisma.alert.findMany.mock.calls[0][0].where
      expect(whereArgument.agentName).toEqual({ contains: 'web-01', mode: 'insensitive' })
    })

    it('should apply KQL free text search across multiple columns', async () => {
      prisma.alert.findMany.mockResolvedValue([])
      prisma.alert.count.mockResolvedValue(0)

      await service.search(TENANT_ID, buildDefaultQuery({ query: 'suspicious login' }))

      const whereArgument = prisma.alert.findMany.mock.calls[0][0].where
      expect(whereArgument.OR).toBeDefined()
      expect(whereArgument.OR).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: { contains: 'suspicious login', mode: 'insensitive' } }),
          expect.objectContaining({
            description: { contains: 'suspicious login', mode: 'insensitive' },
          }),
          expect.objectContaining({
            agentName: { contains: 'suspicious login', mode: 'insensitive' },
          }),
        ])
      )
    })

    it('should handle empty results', async () => {
      prisma.alert.findMany.mockResolvedValue([])
      prisma.alert.count.mockResolvedValue(0)

      const result = await service.search(TENANT_ID, buildDefaultQuery())

      expect(result.data).toHaveLength(0)
      expect(result.pagination.total).toBe(0)
      expect(result.pagination.totalPages).toBe(0)
    })

    it('should apply correct pagination skip and take', async () => {
      prisma.alert.findMany.mockResolvedValue([])
      prisma.alert.count.mockResolvedValue(100)

      await service.search(TENANT_ID, buildDefaultQuery({ page: 3, limit: 10 }))

      expect(prisma.alert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 })
      )
    })

    it('should not apply KQL parsing when query is wildcard *', async () => {
      prisma.alert.findMany.mockResolvedValue([])
      prisma.alert.count.mockResolvedValue(0)

      await service.search(TENANT_ID, buildDefaultQuery({ query: '*' }))

      const whereArgument = prisma.alert.findMany.mock.calls[0][0].where
      expect(whereArgument.OR).toBeUndefined()
    })

    it('should rethrow errors from prisma', async () => {
      const dbError = new Error('Database connection lost')
      prisma.alert.findMany.mockRejectedValue(dbError)

      try {
        await service.search(TENANT_ID, buildDefaultQuery())
        fail('Expected error to be thrown')
      } catch (error) {
        expect(error).toBe(dbError)
      }
    })
  })

  // ---------------------------------------------------------------------------
  // findById
  // ---------------------------------------------------------------------------
  describe('findById', () => {
    it('should return alert when found', async () => {
      const alert = buildMockAlert()
      prisma.alert.findFirst.mockResolvedValue(alert)

      const result = await service.findById(TENANT_ID, ALERT_ID)

      expect(result).toEqual(alert)
      expect(prisma.alert.findFirst).toHaveBeenCalledWith({
        where: { id: ALERT_ID, tenantId: TENANT_ID },
      })
    })

    it('should throw BusinessException 404 when not found', async () => {
      prisma.alert.findFirst.mockResolvedValue(null)

      try {
        await service.findById(TENANT_ID, 'nonexistent-id')
        fail('Expected BusinessException to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(BusinessException)
        expect((error as BusinessException).getStatus()).toBe(404)
      }
    })
  })

  // ---------------------------------------------------------------------------
  // acknowledge
  // ---------------------------------------------------------------------------
  describe('acknowledge', () => {
    it('should update status to acknowledged with acknowledgedBy and acknowledgedAt', async () => {
      const alert = buildMockAlert({ status: 'new_alert' })
      prisma.alert.findFirst.mockResolvedValue(alert)

      const updatedAlert = buildMockAlert({
        status: 'acknowledged',
        acknowledgedBy: USER_EMAIL,
        acknowledgedAt: new Date(),
      })
      prisma.alert.update.mockResolvedValue(updatedAlert)

      const result = await service.acknowledge(TENANT_ID, ALERT_ID, USER_EMAIL)

      expect(result.status).toBe('acknowledged')
      expect(result.acknowledgedBy).toBe(USER_EMAIL)
      expect(prisma.alert.update).toHaveBeenCalledWith({
        where: { id: ALERT_ID, tenantId: TENANT_ID },
        data: expect.objectContaining({
          status: 'acknowledged',
          acknowledgedBy: USER_EMAIL,
          acknowledgedAt: expect.any(Date),
        }),
      })
    })

    it('should throw BusinessException 400 when alert is already closed', async () => {
      const alert = buildMockAlert({ status: 'closed' })
      prisma.alert.findFirst.mockResolvedValue(alert)

      try {
        await service.acknowledge(TENANT_ID, ALERT_ID, USER_EMAIL)
        fail('Expected BusinessException to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(BusinessException)
        expect((error as BusinessException).getStatus()).toBe(400)
      }
    })

    it('should throw BusinessException 400 when alert is already resolved', async () => {
      const alert = buildMockAlert({ status: 'resolved' })
      prisma.alert.findFirst.mockResolvedValue(alert)

      try {
        await service.acknowledge(TENANT_ID, ALERT_ID, USER_EMAIL)
        fail('Expected BusinessException to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(BusinessException)
        expect((error as BusinessException).getStatus()).toBe(400)
      }
    })

    it('should throw BusinessException 404 when alert does not exist', async () => {
      prisma.alert.findFirst.mockResolvedValue(null)

      try {
        await service.acknowledge(TENANT_ID, 'nonexistent', USER_EMAIL)
        fail('Expected BusinessException to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(BusinessException)
        expect((error as BusinessException).getStatus()).toBe(404)
      }
    })
  })

  // ---------------------------------------------------------------------------
  // investigate
  // ---------------------------------------------------------------------------
  describe('investigate', () => {
    it('should update status to in_progress', async () => {
      const alert = buildMockAlert({ status: 'new_alert' })
      prisma.alert.findFirst.mockResolvedValue(alert)

      const updatedAlert = buildMockAlert({ status: 'in_progress' })
      prisma.alert.update.mockResolvedValue(updatedAlert)

      const result = await service.investigate(TENANT_ID, ALERT_ID)

      expect(result.status).toBe('in_progress')
      expect(prisma.alert.update).toHaveBeenCalledWith({
        where: { id: ALERT_ID, tenantId: TENANT_ID },
        data: { status: 'in_progress' },
      })
    })

    it('should throw BusinessException 400 when alert is closed', async () => {
      const alert = buildMockAlert({ status: 'closed' })
      prisma.alert.findFirst.mockResolvedValue(alert)

      try {
        await service.investigate(TENANT_ID, ALERT_ID)
        fail('Expected BusinessException to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(BusinessException)
        expect((error as BusinessException).getStatus()).toBe(400)
      }
    })

    it('should throw BusinessException 400 when alert is resolved', async () => {
      const alert = buildMockAlert({ status: 'resolved' })
      prisma.alert.findFirst.mockResolvedValue(alert)

      try {
        await service.investigate(TENANT_ID, ALERT_ID)
        fail('Expected BusinessException to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(BusinessException)
        expect((error as BusinessException).getStatus()).toBe(400)
      }
    })

    it('should throw BusinessException 404 when alert does not exist', async () => {
      prisma.alert.findFirst.mockResolvedValue(null)

      try {
        await service.investigate(TENANT_ID, 'nonexistent')
        fail('Expected BusinessException to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(BusinessException)
        expect((error as BusinessException).getStatus()).toBe(404)
      }
    })
  })

  // ---------------------------------------------------------------------------
  // close
  // ---------------------------------------------------------------------------
  describe('close', () => {
    const RESOLUTION = 'False positive — benign activity confirmed'

    it('should update status to closed with resolution, closedAt, closedBy', async () => {
      const alert = buildMockAlert({ status: 'in_progress' })
      prisma.alert.findFirst.mockResolvedValue(alert)

      const updatedAlert = buildMockAlert({
        status: 'closed',
        resolution: RESOLUTION,
        closedBy: USER_EMAIL,
        closedAt: new Date(),
      })
      prisma.alert.update.mockResolvedValue(updatedAlert)

      const result = await service.close(TENANT_ID, ALERT_ID, RESOLUTION, USER_EMAIL)

      expect(result.status).toBe('closed')
      expect(result.resolution).toBe(RESOLUTION)
      expect(result.closedBy).toBe(USER_EMAIL)
      expect(prisma.alert.update).toHaveBeenCalledWith({
        where: { id: ALERT_ID, tenantId: TENANT_ID },
        data: expect.objectContaining({
          status: 'closed',
          resolution: RESOLUTION,
          closedBy: USER_EMAIL,
          closedAt: expect.any(Date),
        }),
      })
    })

    it('should throw BusinessException 400 when alert is already closed', async () => {
      const alert = buildMockAlert({ status: 'closed' })
      prisma.alert.findFirst.mockResolvedValue(alert)

      try {
        await service.close(TENANT_ID, ALERT_ID, RESOLUTION, USER_EMAIL)
        fail('Expected BusinessException to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(BusinessException)
        expect((error as BusinessException).getStatus()).toBe(400)
      }
    })

    it('should throw BusinessException 400 when alert is already resolved', async () => {
      const alert = buildMockAlert({ status: 'resolved' })
      prisma.alert.findFirst.mockResolvedValue(alert)

      try {
        await service.close(TENANT_ID, ALERT_ID, RESOLUTION, USER_EMAIL)
        fail('Expected BusinessException to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(BusinessException)
        expect((error as BusinessException).getStatus()).toBe(400)
      }
    })

    it('should throw BusinessException 404 when alert does not exist', async () => {
      prisma.alert.findFirst.mockResolvedValue(null)

      try {
        await service.close(TENANT_ID, 'nonexistent', RESOLUTION, USER_EMAIL)
        fail('Expected BusinessException to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(BusinessException)
        expect((error as BusinessException).getStatus()).toBe(404)
      }
    })
  })

  // ---------------------------------------------------------------------------
  // ingestFromWazuh
  // ---------------------------------------------------------------------------
  describe('ingestFromWazuh', () => {
    const mockConfig = {
      indexerUrl: 'https://wazuh.local:9200',
      username: 'admin',
      password: 'secret',
    }

    function buildWazuhHit(overrides: Record<string, unknown> = {}) {
      return {
        _id: 'wazuh-ext-001',
        _source: {
          timestamp: '2025-06-01T10:00:00Z',
          rule: {
            id: '5710',
            level: 10,
            description: 'SSH brute force attack',
            mitre: {
              id: ['T1078'],
              tactic: ['Initial Access'],
            },
          },
          agent: {
            name: 'web-server-01',
          },
          data: {
            srcip: '192.168.1.100',
            dstip: '10.0.0.5',
          },
          ...overrides,
        },
      }
    }

    it('should ingest alerts and return count', async () => {
      connectorsService.getDecryptedConfig.mockResolvedValue(mockConfig)
      wazuhService.searchAlerts.mockResolvedValue({
        hits: [buildWazuhHit(), buildWazuhHit({ timestamp: '2025-06-01T11:00:00Z' })],
        total: 2,
      })
      prisma.alert.upsert.mockResolvedValue(buildMockAlert())

      const result = await service.ingestFromWazuh(TENANT_ID)

      expect(result.ingested).toBe(2)
      expect(prisma.alert.upsert).toHaveBeenCalledTimes(2)
      expect(connectorsService.getDecryptedConfig).toHaveBeenCalledWith(TENANT_ID, 'wazuh')
    })

    it('should throw BusinessException 400 when Wazuh connector not configured', async () => {
      connectorsService.getDecryptedConfig.mockResolvedValue(null)

      try {
        await service.ingestFromWazuh(TENANT_ID)
        fail('Expected BusinessException to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(BusinessException)
        expect((error as BusinessException).getStatus()).toBe(400)
      }

      expect(wazuhService.searchAlerts).not.toHaveBeenCalled()
      expect(prisma.alert.upsert).not.toHaveBeenCalled()
    })

    it('should handle partial batch failures (some upserts fail, some succeed)', async () => {
      connectorsService.getDecryptedConfig.mockResolvedValue(mockConfig)
      wazuhService.searchAlerts.mockResolvedValue({
        hits: [
          buildWazuhHit(),
          buildWazuhHit({ timestamp: '2025-06-01T11:00:00Z' }),
          buildWazuhHit({ timestamp: '2025-06-01T12:00:00Z' }),
        ],
        total: 3,
      })

      prisma.alert.upsert
        .mockResolvedValueOnce(buildMockAlert())
        .mockRejectedValueOnce(new Error('Unique constraint violation'))
        .mockResolvedValueOnce(buildMockAlert({ id: 'alert-003' }))

      const result = await service.ingestFromWazuh(TENANT_ID)

      // 2 succeeded, 1 failed
      expect(result.ingested).toBe(2)
      expect(prisma.alert.upsert).toHaveBeenCalledTimes(3)
      expect(mockAppLogger.warn).toHaveBeenCalled()
    })

    it('should rethrow errors from wazuhService.searchAlerts', async () => {
      connectorsService.getDecryptedConfig.mockResolvedValue(mockConfig)
      const wazuhError = new Error('Connection refused')
      wazuhService.searchAlerts.mockRejectedValue(wazuhError)

      try {
        await service.ingestFromWazuh(TENANT_ID)
        fail('Expected error to be thrown')
      } catch (error) {
        expect(error).toBe(wazuhError)
      }

      expect(prisma.alert.upsert).not.toHaveBeenCalled()
    })

    it('should handle empty hits from Wazuh', async () => {
      connectorsService.getDecryptedConfig.mockResolvedValue(mockConfig)
      wazuhService.searchAlerts.mockResolvedValue({ hits: [], total: 0 })

      const result = await service.ingestFromWazuh(TENANT_ID)

      expect(result.ingested).toBe(0)
      expect(prisma.alert.upsert).not.toHaveBeenCalled()
    })

    it('should map high-level Wazuh rules to critical severity', async () => {
      connectorsService.getDecryptedConfig.mockResolvedValue(mockConfig)
      const criticalHit = {
        _id: 'ext-critical',
        _source: {
          timestamp: '2025-06-01T10:00:00Z',
          rule: { id: '100', level: 14, description: 'Critical alert' },
          agent: { name: 'server-01' },
          data: {},
        },
      }
      wazuhService.searchAlerts.mockResolvedValue({ hits: [criticalHit], total: 1 })
      prisma.alert.upsert.mockResolvedValue(buildMockAlert())

      await service.ingestFromWazuh(TENANT_ID)

      const upsertCall = prisma.alert.upsert.mock.calls[0][0]
      expect(upsertCall.create.severity).toBe('critical')
    })

    it('should map low-level Wazuh rules to low severity', async () => {
      connectorsService.getDecryptedConfig.mockResolvedValue(mockConfig)
      const lowHit = {
        _id: 'ext-low',
        _source: {
          timestamp: '2025-06-01T10:00:00Z',
          rule: { id: '200', level: 3, description: 'Low level alert' },
          agent: { name: 'server-02' },
          data: {},
        },
      }
      wazuhService.searchAlerts.mockResolvedValue({ hits: [lowHit], total: 1 })
      prisma.alert.upsert.mockResolvedValue(buildMockAlert())

      await service.ingestFromWazuh(TENANT_ID)

      const upsertCall = prisma.alert.upsert.mock.calls[0][0]
      expect(upsertCall.create.severity).toBe('low')
    })
  })

  // ---------------------------------------------------------------------------
  // getCountsBySeverity
  // ---------------------------------------------------------------------------
  describe('getCountsBySeverity', () => {
    it('should return counts grouped by severity', async () => {
      prisma.alert.groupBy.mockResolvedValue([
        { severity: 'critical', _count: 5 },
        { severity: 'high', _count: 12 },
        { severity: 'medium', _count: 30 },
        { severity: 'low', _count: 45 },
        { severity: 'info', _count: 100 },
      ])

      const result = await service.getCountsBySeverity(TENANT_ID)

      expect(result).toEqual({
        critical: 5,
        high: 12,
        medium: 30,
        low: 45,
        info: 100,
      })
      expect(prisma.alert.groupBy).toHaveBeenCalledWith({
        by: ['severity'],
        where: { tenantId: TENANT_ID },
        _count: true,
      })
    })

    it('should handle empty results', async () => {
      prisma.alert.groupBy.mockResolvedValue([])

      const result = await service.getCountsBySeverity(TENANT_ID)

      expect(result).toEqual({})
    })

    it('should rethrow errors from prisma', async () => {
      const dbError = new Error('Database error')
      prisma.alert.groupBy.mockRejectedValue(dbError)

      try {
        await service.getCountsBySeverity(TENANT_ID)
        fail('Expected error to be thrown')
      } catch (error) {
        expect(error).toBe(dbError)
      }
    })
  })

  // ---------------------------------------------------------------------------
  // getTrend
  // ---------------------------------------------------------------------------
  describe('getTrend', () => {
    it('should return trend data with date/count from raw query', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { date: '2025-05-30', count: BigInt(10) },
        { date: '2025-05-31', count: BigInt(15) },
        { date: '2025-06-01', count: BigInt(8) },
      ])

      const result = await service.getTrend(TENANT_ID, 30)

      expect(result).toEqual([
        { date: '2025-05-30', count: 10 },
        { date: '2025-05-31', count: 15 },
        { date: '2025-06-01', count: 8 },
      ])
    })

    it('should convert bigint count to number', async () => {
      prisma.$queryRaw.mockResolvedValue([{ date: '2025-06-01', count: BigInt(999999) }])

      const result = await service.getTrend(TENANT_ID, 7)

      expect(result[0].count).toBe(999999)
      expect(typeof result[0].count).toBe('number')
    })

    it('should handle empty results', async () => {
      prisma.$queryRaw.mockResolvedValue([])

      const result = await service.getTrend(TENANT_ID, 30)

      expect(result).toEqual([])
    })

    it('should rethrow errors from prisma', async () => {
      const dbError = new Error('Raw query failed')
      prisma.$queryRaw.mockRejectedValue(dbError)

      try {
        await service.getTrend(TENANT_ID, 30)
        fail('Expected error to be thrown')
      } catch (error) {
        expect(error).toBe(dbError)
      }
    })
  })

  // ---------------------------------------------------------------------------
  // getMitreTechniqueCounts
  // ---------------------------------------------------------------------------
  describe('getMitreTechniqueCounts', () => {
    it('should return technique/count pairs from raw query', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { technique: 'T1078', count: BigInt(25) },
        { technique: 'T1110', count: BigInt(18) },
        { technique: 'T1059', count: BigInt(12) },
      ])

      const result = await service.getMitreTechniqueCounts(TENANT_ID)

      expect(result).toEqual([
        { technique: 'T1078', count: 25 },
        { technique: 'T1110', count: 18 },
        { technique: 'T1059', count: 12 },
      ])
    })

    it('should convert bigint counts to numbers', async () => {
      prisma.$queryRaw.mockResolvedValue([{ technique: 'T1078', count: BigInt(42) }])

      const result = await service.getMitreTechniqueCounts(TENANT_ID)

      expect(typeof result[0].count).toBe('number')
      expect(result[0].count).toBe(42)
    })

    it('should handle empty results', async () => {
      prisma.$queryRaw.mockResolvedValue([])

      const result = await service.getMitreTechniqueCounts(TENANT_ID)

      expect(result).toEqual([])
    })

    it('should rethrow errors from prisma', async () => {
      const dbError = new Error('Query failed')
      prisma.$queryRaw.mockRejectedValue(dbError)

      try {
        await service.getMitreTechniqueCounts(TENANT_ID)
        fail('Expected error to be thrown')
      } catch (error) {
        expect(error).toBe(dbError)
      }
    })
  })

  // ---------------------------------------------------------------------------
  // getTopTargetedAssets
  // ---------------------------------------------------------------------------
  describe('getTopTargetedAssets', () => {
    it('should return asset/count pairs', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { asset: 'web-server-01', count: BigInt(50) },
        { asset: 'db-server-02', count: BigInt(30) },
        { asset: 'app-server-03', count: BigInt(15) },
      ])

      const result = await service.getTopTargetedAssets(TENANT_ID, 10)

      expect(result).toEqual([
        { asset: 'web-server-01', count: 50 },
        { asset: 'db-server-02', count: 30 },
        { asset: 'app-server-03', count: 15 },
      ])
    })

    it('should convert bigint counts to numbers', async () => {
      prisma.$queryRaw.mockResolvedValue([{ asset: 'server-01', count: BigInt(1234) }])

      const result = await service.getTopTargetedAssets(TENANT_ID, 5)

      expect(typeof result[0].count).toBe('number')
      expect(result[0].count).toBe(1234)
    })

    it('should handle empty results', async () => {
      prisma.$queryRaw.mockResolvedValue([])

      const result = await service.getTopTargetedAssets(TENANT_ID, 10)

      expect(result).toEqual([])
    })

    it('should rethrow errors from prisma', async () => {
      const dbError = new Error('Query failed')
      prisma.$queryRaw.mockRejectedValue(dbError)

      try {
        await service.getTopTargetedAssets(TENANT_ID, 10)
        fail('Expected error to be thrown')
      } catch (error) {
        expect(error).toBe(dbError)
      }
    })
  })
})
