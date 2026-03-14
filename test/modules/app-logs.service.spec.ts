import { BusinessException } from '../../src/common/exceptions/business.exception'
import { AppLogsService } from '../../src/modules/app-logs/app-logs.service'

function createMockPrisma() {
  return {
    applicationLog: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
    },
  }
}

const TENANT_ID = 'tenant-001'

describe('AppLogsService', () => {
  let service: AppLogsService
  let prisma: ReturnType<typeof createMockPrisma>

  beforeEach(() => {
    prisma = createMockPrisma()
    service = new AppLogsService(prisma as never)
    jest.clearAllMocks()
  })

  /* ------------------------------------------------------------------ */
  /* search                                                              */
  /* ------------------------------------------------------------------ */

  describe('search', () => {
    const baseDto = { page: 1, limit: 20 }

    it('should return paginated logs', async () => {
      const logs = [
        { id: 'log-1', level: 'info', message: 'Test log', tenantId: TENANT_ID },
        { id: 'log-2', level: 'error', message: 'Error log', tenantId: TENANT_ID },
      ]
      prisma.applicationLog.findMany.mockResolvedValueOnce(logs)
      prisma.applicationLog.count.mockResolvedValueOnce(2)

      const result = await service.search(baseDto)

      expect(result.data).toEqual(logs)
      expect(result.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      })
      expect(prisma.applicationLog.findMany).toHaveBeenCalledTimes(1)
      expect(prisma.applicationLog.count).toHaveBeenCalledTimes(1)
    })

    it('should filter by level (comma-separated: "INFO,ERROR")', async () => {
      prisma.applicationLog.findMany.mockResolvedValueOnce([])
      prisma.applicationLog.count.mockResolvedValueOnce(0)

      await service.search({ ...baseDto, level: 'INFO,ERROR' })

      const whereArgument = prisma.applicationLog.findMany.mock.calls[0][0].where
      expect(whereArgument.level).toEqual({ in: ['INFO', 'ERROR'] })
    })

    it('should filter by single level', async () => {
      prisma.applicationLog.findMany.mockResolvedValueOnce([])
      prisma.applicationLog.count.mockResolvedValueOnce(0)

      await service.search({ ...baseDto, level: 'INFO' })

      const whereArgument = prisma.applicationLog.findMany.mock.calls[0][0].where
      expect(whereArgument.level).toBe('INFO')
    })

    it('should filter by feature', async () => {
      prisma.applicationLog.findMany.mockResolvedValueOnce([])
      prisma.applicationLog.count.mockResolvedValueOnce(0)

      await service.search({ ...baseDto, feature: 'alerts' })

      const whereArgument = prisma.applicationLog.findMany.mock.calls[0][0].where
      expect(whereArgument.feature).toEqual({ contains: 'alerts', mode: 'insensitive' })
    })

    it('should filter by action', async () => {
      prisma.applicationLog.findMany.mockResolvedValueOnce([])
      prisma.applicationLog.count.mockResolvedValueOnce(0)

      await service.search({ ...baseDto, action: 'create' })

      const whereArgument = prisma.applicationLog.findMany.mock.calls[0][0].where
      expect(whereArgument.action).toEqual({ contains: 'create', mode: 'insensitive' })
    })

    it('should filter by query (message contains)', async () => {
      prisma.applicationLog.findMany.mockResolvedValueOnce([])
      prisma.applicationLog.count.mockResolvedValueOnce(0)

      await service.search({ ...baseDto, query: 'failed' })

      const whereArgument = prisma.applicationLog.findMany.mock.calls[0][0].where
      expect(whereArgument.message).toEqual({ contains: 'failed', mode: 'insensitive' })
    })

    it('should filter by date range (from/to)', async () => {
      prisma.applicationLog.findMany.mockResolvedValueOnce([])
      prisma.applicationLog.count.mockResolvedValueOnce(0)

      const from = '2025-01-01T00:00:00.000Z'
      const to = '2025-01-31T23:59:59.000Z'
      await service.search({ ...baseDto, from, to })

      const whereArgument = prisma.applicationLog.findMany.mock.calls[0][0].where
      expect(whereArgument.createdAt).toEqual({
        gte: new Date(from),
        lte: new Date(to),
      })
    })

    it('should scope to tenant when scopedTenantId is provided', async () => {
      prisma.applicationLog.findMany.mockResolvedValueOnce([])
      prisma.applicationLog.count.mockResolvedValueOnce(0)

      await service.search(baseDto, TENANT_ID)

      const whereArgument = prisma.applicationLog.findMany.mock.calls[0][0].where
      expect(whereArgument.tenantId).toBe(TENANT_ID)
    })

    it('should use dto.tenantId when scopedTenantId is not provided', async () => {
      prisma.applicationLog.findMany.mockResolvedValueOnce([])
      prisma.applicationLog.count.mockResolvedValueOnce(0)

      await service.search({ ...baseDto, tenantId: 'dto-tenant' })

      const whereArgument = prisma.applicationLog.findMany.mock.calls[0][0].where
      expect(whereArgument.tenantId).toBe('dto-tenant')
    })

    it('should prioritize scopedTenantId over dto.tenantId', async () => {
      prisma.applicationLog.findMany.mockResolvedValueOnce([])
      prisma.applicationLog.count.mockResolvedValueOnce(0)

      await service.search({ ...baseDto, tenantId: 'dto-tenant' }, TENANT_ID)

      const whereArgument = prisma.applicationLog.findMany.mock.calls[0][0].where
      expect(whereArgument.tenantId).toBe(TENANT_ID)
    })

    it('should handle empty results', async () => {
      prisma.applicationLog.findMany.mockResolvedValueOnce([])
      prisma.applicationLog.count.mockResolvedValueOnce(0)

      const result = await service.search(baseDto)

      expect(result.data).toEqual([])
      expect(result.pagination.total).toBe(0)
      expect(result.pagination.totalPages).toBe(0)
    })
  })

  /* ------------------------------------------------------------------ */
  /* findById                                                            */
  /* ------------------------------------------------------------------ */

  describe('findById', () => {
    it('should return log when found', async () => {
      const log = { id: 'log-1', level: 'info', message: 'Test', tenantId: TENANT_ID }
      prisma.applicationLog.findUnique.mockResolvedValueOnce(log)

      const result = await service.findById('log-1')

      expect(result).toEqual(log)
      expect(prisma.applicationLog.findUnique).toHaveBeenCalledWith({
        where: { id: 'log-1' },
      })
    })

    it('should throw 404 when not found', async () => {
      prisma.applicationLog.findUnique.mockResolvedValueOnce(null)

      await expect(service.findById('nonexistent')).rejects.toThrow(BusinessException)
      await expect(service.findById('nonexistent')).rejects.toMatchObject({
        messageKey: 'errors.appLogs.notFound',
      })
    })

    it('should throw 403 when log belongs to different tenant (scope violation)', async () => {
      const log = { id: 'log-1', level: 'info', message: 'Test', tenantId: 'other-tenant' }
      prisma.applicationLog.findUnique.mockResolvedValue(log)

      await expect(service.findById('log-1', TENANT_ID)).rejects.toThrow(BusinessException)
      await expect(service.findById('log-1', TENANT_ID)).rejects.toMatchObject({
        messageKey: 'errors.forbidden',
      })
    })

    it('should return log when scopedTenantId matches log tenantId', async () => {
      const log = { id: 'log-1', level: 'info', message: 'Test', tenantId: TENANT_ID }
      prisma.applicationLog.findUnique.mockResolvedValueOnce(log)

      const result = await service.findById('log-1', TENANT_ID)

      expect(result).toEqual(log)
    })
  })
})
