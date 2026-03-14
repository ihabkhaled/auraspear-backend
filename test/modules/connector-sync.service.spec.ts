import { ConnectorSyncService } from '../../src/modules/connector-sync/connector-sync.service'

const TENANT_ID = 'tenant-001'

const mockAppLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

function createMockPrisma() {
  return {
    connectorConfig: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    alert: {
      upsert: jest.fn(),
    },
  }
}

const mockConnectorsService = {
  getDecryptedConfig: jest.fn(),
}

const mockAlertsService = {
  ingestFromWazuh: jest.fn(),
}

const mockIntelService = {
  syncFromMisp: jest.fn(),
}

const mockGraylogService = {
  searchEvents: jest.fn(),
}

describe('ConnectorSyncService', () => {
  let service: ConnectorSyncService
  let prisma: ReturnType<typeof createMockPrisma>

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = createMockPrisma()
    service = new ConnectorSyncService(
      prisma as never,
      mockConnectorsService as never,
      mockAlertsService as never,
      mockIntelService as never,
      mockGraylogService as never,
      mockAppLogger as never
    )
  })

  describe('syncConnector', () => {
    it('should reject unsupported connector type', async () => {
      const result = await service.syncConnector(TENANT_ID, 'grafana')

      expect(result).toEqual({
        success: false,
        message: "Connector type 'grafana' does not support data sync",
      })
    })

    it('should sync wazuh successfully', async () => {
      mockAlertsService.ingestFromWazuh.mockResolvedValue({ ingested: 10 })
      prisma.connectorConfig.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.syncConnector(TENANT_ID, 'wazuh')

      expect(result).toEqual({
        success: true,
        message: 'Synced 10 records from wazuh',
        ingested: 10,
      })
      expect(mockAlertsService.ingestFromWazuh).toHaveBeenCalledWith(TENANT_ID)
    })

    it('should sync graylog successfully', async () => {
      mockConnectorsService.getDecryptedConfig.mockResolvedValue({ url: 'http://graylog' })
      mockGraylogService.searchEvents.mockResolvedValue({
        events: [
          {
            event: {
              id: 'ev-1',
              message: 'Test event',
              priority: 3,
              timestamp: '2026-01-01T00:00:00Z',
              source: 'src1',
            },
          },
        ],
      })
      prisma.alert.upsert.mockResolvedValue({})
      prisma.connectorConfig.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.syncConnector(TENANT_ID, 'graylog')

      expect(result.success).toBe(true)
      expect(result.ingested).toBe(1)
      expect(prisma.alert.upsert).toHaveBeenCalled()
    })

    it('should return 0 when graylog has no config', async () => {
      mockConnectorsService.getDecryptedConfig.mockResolvedValue(null)
      prisma.connectorConfig.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.syncConnector(TENANT_ID, 'graylog')

      expect(result.success).toBe(true)
      expect(result.ingested).toBe(0)
    })

    it('should return 0 when graylog returns no events', async () => {
      mockConnectorsService.getDecryptedConfig.mockResolvedValue({ url: 'http://graylog' })
      mockGraylogService.searchEvents.mockResolvedValue({ events: [] })
      prisma.connectorConfig.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.syncConnector(TENANT_ID, 'graylog')

      expect(result.success).toBe(true)
      expect(result.ingested).toBe(0)
    })

    it('should sync misp successfully', async () => {
      mockIntelService.syncFromMisp.mockResolvedValue({
        eventsUpserted: 5,
        iocsUpserted: 20,
      })
      prisma.connectorConfig.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.syncConnector(TENANT_ID, 'misp')

      expect(result.success).toBe(true)
      expect(result.ingested).toBe(25)
      expect(mockIntelService.syncFromMisp).toHaveBeenCalledWith(TENANT_ID)
    })

    it('should handle sync errors gracefully', async () => {
      mockAlertsService.ingestFromWazuh.mockRejectedValue(new Error('Connection refused'))

      const result = await service.syncConnector(TENANT_ID, 'wazuh')

      expect(result).toEqual({
        success: false,
        message: 'Connection refused',
      })
    })
  })

  describe('handleSync', () => {
    it('should skip when sync is already running', async () => {
      // Set running flag
      ;(service as unknown as { running: boolean }).running = true

      await service.handleSync()

      expect(prisma.connectorConfig.findMany).not.toHaveBeenCalled()
    })

    it('should sync all eligible connectors', async () => {
      prisma.connectorConfig.findMany.mockResolvedValue([
        { tenantId: TENANT_ID, type: 'wazuh', lastSyncAt: null },
      ])
      mockAlertsService.ingestFromWazuh.mockResolvedValue({ ingested: 5 })
      prisma.connectorConfig.updateMany.mockResolvedValue({ count: 1 })

      await service.handleSync()

      expect(prisma.connectorConfig.findMany).toHaveBeenCalled()
      expect(mockAlertsService.ingestFromWazuh).toHaveBeenCalledWith(TENANT_ID)
    })

    it('should skip connectors synced too recently', async () => {
      const recentSync = new Date(Date.now() - 30_000) // 30 seconds ago (< 90s gap)
      prisma.connectorConfig.findMany.mockResolvedValue([
        { tenantId: TENANT_ID, type: 'wazuh', lastSyncAt: recentSync },
      ])

      await service.handleSync()

      expect(mockAlertsService.ingestFromWazuh).not.toHaveBeenCalled()
    })

    it('should sync connectors that are past the gap threshold', async () => {
      const oldSync = new Date(Date.now() - 120_000) // 2 minutes ago (> 90s gap)
      prisma.connectorConfig.findMany.mockResolvedValue([
        { tenantId: TENANT_ID, type: 'wazuh', lastSyncAt: oldSync },
      ])
      mockAlertsService.ingestFromWazuh.mockResolvedValue({ ingested: 3 })
      prisma.connectorConfig.updateMany.mockResolvedValue({ count: 1 })

      await service.handleSync()

      expect(mockAlertsService.ingestFromWazuh).toHaveBeenCalledWith(TENANT_ID)
    })

    it('should not fail when no connectors are eligible', async () => {
      prisma.connectorConfig.findMany.mockResolvedValue([])

      await service.handleSync()

      // Should complete without error
      expect(prisma.connectorConfig.findMany).toHaveBeenCalled()
    })

    it('should handle errors in syncAllTenants gracefully', async () => {
      prisma.connectorConfig.findMany.mockRejectedValue(new Error('DB connection lost'))

      // Should not throw
      await service.handleSync()

      // running flag should be reset
      expect((service as unknown as { running: boolean }).running).toBe(false)
    })

    it('should reset running flag after completion', async () => {
      prisma.connectorConfig.findMany.mockResolvedValue([])

      await service.handleSync()

      expect((service as unknown as { running: boolean }).running).toBe(false)
    })
  })

  describe('graylog priority mapping', () => {
    it('should process graylog events with various priorities', async () => {
      mockConnectorsService.getDecryptedConfig.mockResolvedValue({ url: 'http://graylog' })
      mockGraylogService.searchEvents.mockResolvedValue({
        events: [
          {
            event: {
              id: 'ev-1',
              message: 'Critical',
              priority: 4,
              timestamp: '2026-01-01T00:00:00Z',
            },
          },
          {
            event: { id: 'ev-2', message: 'High', priority: 3, timestamp: '2026-01-01T00:00:00Z' },
          },
          {
            event: {
              id: 'ev-3',
              message: 'Medium',
              priority: 2,
              timestamp: '2026-01-01T00:00:00Z',
            },
          },
          { event: { id: 'ev-4', message: 'Low', priority: 1, timestamp: '2026-01-01T00:00:00Z' } },
          {
            event: { id: 'ev-5', message: 'Info', priority: 0, timestamp: '2026-01-01T00:00:00Z' },
          },
        ],
      })
      prisma.alert.upsert.mockResolvedValue({})
      prisma.connectorConfig.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.syncConnector(TENANT_ID, 'graylog')

      expect(result.ingested).toBe(5)
      expect(prisma.alert.upsert).toHaveBeenCalledTimes(5)

      // Verify severity mapping in upsert calls
      const { calls } = prisma.alert.upsert.mock
      expect(calls[0][0].create.severity).toBe('critical')
      expect(calls[1][0].create.severity).toBe('high')
      expect(calls[2][0].create.severity).toBe('medium')
      expect(calls[3][0].create.severity).toBe('low')
      expect(calls[4][0].create.severity).toBe('info')
    })

    it('should handle graylog events without event wrapper', async () => {
      mockConnectorsService.getDecryptedConfig.mockResolvedValue({ url: 'http://graylog' })
      mockGraylogService.searchEvents.mockResolvedValue({
        events: [
          {
            id: 'ev-plain',
            message: 'Plain event',
            priority: 2,
            timestamp: '2026-01-01T00:00:00Z',
          },
        ],
      })
      prisma.alert.upsert.mockResolvedValue({})
      prisma.connectorConfig.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.syncConnector(TENANT_ID, 'graylog')

      expect(result.ingested).toBe(1)
    })
  })
})
