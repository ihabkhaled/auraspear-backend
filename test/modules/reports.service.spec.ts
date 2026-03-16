import { ReportStatus } from '../../src/common/enums'
import { BusinessException } from '../../src/common/exceptions/business.exception'
import { ReportsService } from '../../src/modules/reports/reports.service'

const mockAppLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

const TENANT_ID = 'tenant-001'
const REPORT_ID = 'report-001'
const USER_EMAIL = 'analyst@auraspear.com'

function buildMockUser() {
  return {
    sub: 'user-001',
    email: USER_EMAIL,
    tenantId: TENANT_ID,
    role: 'SOC_ANALYST',
  }
}

function buildMockReport(overrides: Record<string, unknown> = {}) {
  return {
    id: REPORT_ID,
    tenantId: TENANT_ID,
    name: 'Weekly Incident Report',
    description: 'Summary of weekly incidents',
    type: 'incident_summary',
    format: 'pdf',
    status: ReportStatus.COMPLETED,
    parameters: { dateRange: '7d' },
    fileUrl: 'https://storage.example.com/reports/report-001.pdf',
    fileSize: BigInt(102400),
    generatedAt: new Date('2025-06-01T12:00:00Z'),
    generatedBy: USER_EMAIL,
    tenant: { name: 'Test Tenant' },
    createdAt: new Date('2025-06-01T12:00:00Z'),
    ...overrides,
  }
}

function createMockRepository() {
  return {
    findManyReports: jest.fn(),
    countReports: jest.fn(),
    findFirstReport: jest.fn(),
    createReport: jest.fn(),
    deleteManyReports: jest.fn(),
    findUserByEmail: jest.fn(),
    findUsersByEmails: jest.fn(),
  }
}

describe('ReportsService', () => {
  let service: ReportsService
  let repository: ReturnType<typeof createMockRepository>

  beforeEach(() => {
    repository = createMockRepository()
    jest.clearAllMocks()

    service = new ReportsService(repository as never, mockAppLogger as never)
  })

  // ---------------------------------------------------------------------------
  // listReports
  // ---------------------------------------------------------------------------
  describe('listReports', () => {
    it('should return paginated reports', async () => {
      const reports = [buildMockReport(), buildMockReport({ id: 'report-002' })]
      repository.findManyReports.mockResolvedValue(reports)
      repository.countReports.mockResolvedValue(2)
      repository.findUsersByEmails.mockResolvedValue([{ email: USER_EMAIL, name: 'Analyst User' }])

      const result = await service.listReports(TENANT_ID)

      expect(result.data).toHaveLength(2)
      expect(result.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      })
    })

    it('should filter by type', async () => {
      repository.findManyReports.mockResolvedValue([])
      repository.countReports.mockResolvedValue(0)
      repository.findUsersByEmails.mockResolvedValue([])

      await service.listReports(TENANT_ID, 1, 20, undefined, undefined, 'incident_summary')

      const whereArgument = repository.findManyReports.mock.calls[0][0].where
      expect(whereArgument.type).toBe('incident_summary')
    })

    it('should filter by status', async () => {
      repository.findManyReports.mockResolvedValue([])
      repository.countReports.mockResolvedValue(0)
      repository.findUsersByEmails.mockResolvedValue([])

      await service.listReports(TENANT_ID, 1, 20, undefined, undefined, undefined, 'completed')

      const whereArgument = repository.findManyReports.mock.calls[0][0].where
      expect(whereArgument.status).toBe('completed')
    })

    it('should filter by query', async () => {
      repository.findManyReports.mockResolvedValue([])
      repository.countReports.mockResolvedValue(0)
      repository.findUsersByEmails.mockResolvedValue([])

      await service.listReports(
        TENANT_ID,
        1,
        20,
        undefined,
        undefined,
        undefined,
        undefined,
        'weekly'
      )

      const whereArgument = repository.findManyReports.mock.calls[0][0].where
      expect(whereArgument.OR).toEqual([
        { name: { contains: 'weekly', mode: 'insensitive' } },
        { description: { contains: 'weekly', mode: 'insensitive' } },
      ])
    })

    it('should handle empty results', async () => {
      repository.findManyReports.mockResolvedValue([])
      repository.countReports.mockResolvedValue(0)
      repository.findUsersByEmails.mockResolvedValue([])

      const result = await service.listReports(TENANT_ID)

      expect(result.data).toHaveLength(0)
      expect(result.pagination.total).toBe(0)
    })

    it('should apply correct pagination skip and take', async () => {
      repository.findManyReports.mockResolvedValue([])
      repository.countReports.mockResolvedValue(100)
      repository.findUsersByEmails.mockResolvedValue([])

      await service.listReports(TENANT_ID, 3, 10)

      expect(repository.findManyReports).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 })
      )
    })

    it('should convert BigInt fileSize to number', async () => {
      repository.findManyReports.mockResolvedValue([buildMockReport()])
      repository.countReports.mockResolvedValue(1)
      repository.findUsersByEmails.mockResolvedValue([])

      const result = await service.listReports(TENANT_ID)

      expect(result.data[0]?.fileSize).toBe('102400')
    })

    it('should handle null fileSize', async () => {
      repository.findManyReports.mockResolvedValue([buildMockReport({ fileSize: null })])
      repository.countReports.mockResolvedValue(1)
      repository.findUsersByEmails.mockResolvedValue([])

      const result = await service.listReports(TENANT_ID)

      expect(result.data[0]?.fileSize).toBeNull()
    })

    it('should enforce tenant isolation', async () => {
      repository.findManyReports.mockResolvedValue([])
      repository.countReports.mockResolvedValue(0)
      repository.findUsersByEmails.mockResolvedValue([])

      await service.listReports('other-tenant')

      const whereArgument = repository.findManyReports.mock.calls[0][0].where
      expect(whereArgument.tenantId).toBe('other-tenant')
    })
  })

  // ---------------------------------------------------------------------------
  // getReportById
  // ---------------------------------------------------------------------------
  describe('getReportById', () => {
    it('should return report when found', async () => {
      repository.findFirstReport.mockResolvedValue(buildMockReport())
      repository.findUserByEmail.mockResolvedValue({ name: 'Analyst User' })

      const result = await service.getReportById(REPORT_ID, TENANT_ID)

      expect(result.id).toBe(REPORT_ID)
      expect(result.generatedByName).toBe('Analyst User')
      expect(result.tenantName).toBe('Test Tenant')
    })

    it('should throw BusinessException 404 when not found', async () => {
      repository.findFirstReport.mockResolvedValue(null)

      try {
        await service.getReportById('nonexistent', TENANT_ID)
        fail('Expected BusinessException to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(BusinessException)
        expect((error as BusinessException).getStatus()).toBe(404)
      }
    })

    it('should enforce tenant isolation', async () => {
      repository.findFirstReport.mockResolvedValue(null)

      try {
        await service.getReportById(REPORT_ID, 'other-tenant')
        fail('Expected BusinessException to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(BusinessException)
      }

      expect(repository.findFirstReport).toHaveBeenCalledWith({
        where: { id: REPORT_ID, tenantId: 'other-tenant' },
        include: { tenant: { select: { name: true } } },
      })
    })
  })

  // ---------------------------------------------------------------------------
  // createReport
  // ---------------------------------------------------------------------------
  describe('createReport', () => {
    it('should create a report with GENERATING status', async () => {
      const created = buildMockReport({ status: ReportStatus.GENERATING })
      repository.createReport.mockResolvedValue(created)
      repository.findUserByEmail.mockResolvedValue({ name: 'Analyst User' })

      const dto = {
        name: 'Weekly Incident Report',
        type: 'incident_summary',
        format: 'pdf',
      }

      const result = await service.createReport(dto as never, buildMockUser() as never)

      expect(result.status).toBe(ReportStatus.GENERATING)
      expect(mockAppLogger.info).toHaveBeenCalled()
    })

    it('should use user tenantId and email', async () => {
      repository.createReport.mockResolvedValue(buildMockReport())
      repository.findUserByEmail.mockResolvedValue({ name: 'Analyst User' })

      const dto = { name: 'Test', type: 'summary', format: 'pdf' }
      await service.createReport(dto as never, buildMockUser() as never)

      const createArgument = repository.createReport.mock.calls[0][0].data
      expect(createArgument.tenantId).toBe(TENANT_ID)
      expect(createArgument.generatedBy).toBe(USER_EMAIL)
    })
  })

  // ---------------------------------------------------------------------------
  // deleteReport
  // ---------------------------------------------------------------------------
  describe('deleteReport', () => {
    it('should delete a report and return deleted: true', async () => {
      repository.findFirstReport.mockResolvedValue(buildMockReport())
      repository.findUserByEmail.mockResolvedValue({ name: 'Analyst User' })
      repository.deleteManyReports.mockResolvedValue({ count: 1 })

      const result = await service.deleteReport(REPORT_ID, TENANT_ID, USER_EMAIL)

      expect(result).toEqual({ deleted: true })
      expect(repository.deleteManyReports).toHaveBeenCalledWith({
        where: { id: REPORT_ID, tenantId: TENANT_ID },
      })
      expect(mockAppLogger.info).toHaveBeenCalled()
    })

    it('should throw BusinessException 404 when report does not exist', async () => {
      repository.findFirstReport.mockResolvedValue(null)

      try {
        await service.deleteReport('nonexistent', TENANT_ID, USER_EMAIL)
        fail('Expected BusinessException to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(BusinessException)
        expect((error as BusinessException).getStatus()).toBe(404)
      }
    })
  })

  // ---------------------------------------------------------------------------
  // getReportStats
  // ---------------------------------------------------------------------------
  describe('getReportStats', () => {
    it('should return aggregated report stats', async () => {
      repository.countReports
        .mockResolvedValueOnce(20) // totalReports
        .mockResolvedValueOnce(15) // completedReports
        .mockResolvedValueOnce(3) // failedReports
        .mockResolvedValueOnce(2) // generatingReports

      const result = await service.getReportStats(TENANT_ID)

      expect(result.totalReports).toBe(20)
      expect(result.completedReports).toBe(15)
      expect(result.failedReports).toBe(3)
      expect(result.generatingReports).toBe(2)
    })

    it('should handle zero counts', async () => {
      repository.countReports.mockResolvedValue(0)

      const result = await service.getReportStats(TENANT_ID)

      expect(result.totalReports).toBe(0)
      expect(result.completedReports).toBe(0)
    })

    it('should enforce tenant isolation', async () => {
      repository.countReports.mockResolvedValue(0)

      await service.getReportStats('other-tenant')

      expect(repository.countReports).toHaveBeenCalledWith({ tenantId: 'other-tenant' })
    })

    it('should rethrow errors from repository', async () => {
      const dbError = new Error('Database error')
      repository.countReports.mockRejectedValue(dbError)

      try {
        await service.getReportStats(TENANT_ID)
        fail('Expected error to be thrown')
      } catch (error) {
        expect(error).toBe(dbError)
      }
    })
  })
})
