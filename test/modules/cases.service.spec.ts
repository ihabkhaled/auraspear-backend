import { BusinessException } from '../../src/common/exceptions/business.exception'
import { CasesService } from '../../src/modules/cases/cases.service'

const mockAppLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

function createMockPrisma() {
  return {
    case: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    caseCycle: {
      findFirst: jest.fn(),
    },
    caseTimeline: {
      create: jest.fn(),
    },
    caseNote: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
    alert: {
      count: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    tenantMembership: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  }
}

const TENANT_ID = 'tenant-001'

const mockUser = {
  sub: 'user-001',
  email: 'analyst@auraspear.com',
  tenantId: TENANT_ID,
  tenantSlug: 'auraspear',
  role: 'TENANT_ADMIN' as const,
}

describe('CasesService', () => {
  let service: CasesService
  let prisma: ReturnType<typeof createMockPrisma>

  beforeEach(() => {
    prisma = createMockPrisma()
    service = new CasesService(prisma as never, mockAppLogger as never)
  })

  /* ------------------------------------------------------------------ */
  /* listCases                                                            */
  /* ------------------------------------------------------------------ */

  describe('listCases', () => {
    it('should return paginated cases with owner names resolved', async () => {
      const rawCases = [
        {
          id: 'case-1',
          tenantId: TENANT_ID,
          caseNumber: 'SOC-2026-001',
          title: 'Suspicious login',
          description: 'Multiple failed logins',
          severity: 'high',
          status: 'open',
          ownerUserId: 'user-001',
          createdBy: 'admin@test.com',
          cycleId: 'cycle-1',
          linkedAlerts: [],
          closedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          tenant: { name: 'AuraSpear' },
        },
        {
          id: 'case-2',
          tenantId: TENANT_ID,
          caseNumber: 'SOC-2026-002',
          title: 'Malware detected',
          description: 'Ransomware payload',
          severity: 'critical',
          status: 'in_progress',
          ownerUserId: null,
          createdBy: 'admin@test.com',
          cycleId: 'cycle-1',
          linkedAlerts: [],
          closedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          tenant: { name: 'AuraSpear' },
        },
      ]

      prisma.case.findMany.mockResolvedValue(rawCases)
      prisma.case.count.mockResolvedValue(2)
      prisma.user.findMany.mockResolvedValue([
        { id: 'user-001', name: 'Alice', email: 'alice@test.com' },
      ])

      const result = await service.listCases(TENANT_ID, 1, 20)

      expect(result.data).toHaveLength(2)
      const first = result.data[0]
      const second = result.data[1]
      expect(first).toBeDefined()
      expect(second).toBeDefined()
      expect(first?.ownerName).toBe('Alice')
      expect(first?.ownerEmail).toBe('alice@test.com')
      expect(first?.tenantName).toBe('AuraSpear')
      expect(second?.ownerName).toBeNull()
      expect(second?.ownerEmail).toBeNull()
      expect(result.pagination.total).toBe(2)
      expect(result.pagination.page).toBe(1)
    })
  })

  /* ------------------------------------------------------------------ */
  /* createCase                                                           */
  /* ------------------------------------------------------------------ */

  describe('createCase', () => {
    it('should create case and auto-assign to active cycle', async () => {
      const createdCase = {
        id: 'case-new',
        tenantId: TENANT_ID,
        caseNumber: 'SOC-2026-001',
        title: 'New incident',
        description: 'Something happened',
        severity: 'medium',
        status: 'open',
        ownerUserId: null,
        createdBy: mockUser.email,
        cycleId: 'cycle-active',
        linkedAlerts: [],
        closedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
        timeline: [],
        tenant: { name: 'AuraSpear' },
      }

      // $transaction receives a callback; we execute it with a mock tx
      prisma.$transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            caseCycle: {
              findFirst: jest.fn().mockResolvedValue({ id: 'cycle-active' }),
            },
            case: {
              findFirst: jest.fn(),
              create: jest.fn().mockResolvedValue({ id: 'case-new' }),
              findUniqueOrThrow: jest.fn().mockResolvedValue(createdCase),
            },
            caseTimeline: {
              create: jest.fn().mockResolvedValue({}),
            },
            $queryRaw: jest.fn().mockResolvedValue(null),
          }
          return callback(tx)
        }
      )

      prisma.user.findUnique.mockResolvedValue(null)

      const dto = {
        title: 'New incident',
        description: 'Something happened',
        severity: 'medium',
      }

      const result = await service.createCase(dto as never, mockUser as never)

      expect(result.caseNumber).toBe('SOC-2026-001')
      expect(result.tenantName).toBe('AuraSpear')
      expect(prisma.$transaction).toHaveBeenCalled()
    })

    it('should create case without cycle when no active cycle', async () => {
      const createdCase = {
        id: 'case-new',
        tenantId: TENANT_ID,
        caseNumber: 'SOC-2026-001',
        title: 'New incident',
        description: 'Something happened',
        severity: 'medium',
        status: 'open',
        ownerUserId: null,
        createdBy: mockUser.email,
        cycleId: null,
        linkedAlerts: [],
        closedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
        timeline: [],
        tenant: { name: 'AuraSpear' },
      }

      prisma.$transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            caseCycle: {
              findFirst: jest.fn().mockResolvedValue(null),
            },
            case: {
              findFirst: jest.fn(),
              create: jest.fn().mockResolvedValue({ id: 'case-new' }),
              findUniqueOrThrow: jest.fn().mockResolvedValue(createdCase),
            },
            caseTimeline: {
              create: jest.fn().mockResolvedValue({}),
            },
            $queryRaw: jest.fn().mockResolvedValue(null),
          }
          return callback(tx)
        }
      )

      prisma.user.findUnique.mockResolvedValue(null)

      const dto = {
        title: 'New incident',
        description: 'Something happened',
        severity: 'medium',
      }

      const result = await service.createCase(dto as never, mockUser as never)

      expect(result.cycleId).toBeNull()
      expect(result.tenantName).toBe('AuraSpear')
    })
  })

  /* ------------------------------------------------------------------ */
  /* getCaseById                                                          */
  /* ------------------------------------------------------------------ */

  describe('getCaseById', () => {
    it('should return case with owner details', async () => {
      const rawCase = {
        id: 'case-1',
        tenantId: TENANT_ID,
        caseNumber: 'SOC-2026-001',
        title: 'Suspicious login',
        description: 'Multiple failed logins',
        severity: 'high',
        status: 'open',
        ownerUserId: 'user-001',
        createdBy: 'admin@test.com',
        cycleId: 'cycle-1',
        linkedAlerts: [],
        closedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
        timeline: [],
        tenant: { name: 'AuraSpear' },
      }

      prisma.case.findFirst.mockResolvedValue(rawCase)
      prisma.user.findUnique.mockResolvedValue({
        name: 'Alice',
        email: 'alice@test.com',
      })

      const result = await service.getCaseById('case-1', TENANT_ID)

      expect(result.ownerName).toBe('Alice')
      expect(result.ownerEmail).toBe('alice@test.com')
      expect(result.tenantName).toBe('AuraSpear')
      expect(prisma.case.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'case-1', tenantId: TENANT_ID },
        })
      )
    })

    it('should throw when case not found', async () => {
      prisma.case.findFirst.mockResolvedValue(null)

      await expect(service.getCaseById('nonexistent', TENANT_ID)).rejects.toThrow(BusinessException)
    })
  })

  /* ------------------------------------------------------------------ */
  /* updateCase                                                           */
  /* ------------------------------------------------------------------ */

  describe('updateCase', () => {
    it('should update case status and create timeline entry', async () => {
      // getCaseById is called internally — mock findFirst for it
      const existingCase = {
        id: 'case-1',
        tenantId: TENANT_ID,
        caseNumber: 'SOC-2026-001',
        title: 'Suspicious login',
        description: 'Multiple failed logins',
        severity: 'high',
        status: 'open',
        ownerUserId: 'user-001',
        createdBy: 'admin@test.com',
        cycleId: 'cycle-1',
        linkedAlerts: [],
        closedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
        timeline: [],
        tenant: { name: 'AuraSpear' },
      }

      prisma.case.findFirst.mockResolvedValue(existingCase)
      prisma.user.findUnique.mockResolvedValue({
        name: 'Alice',
        email: 'alice@test.com',
      })

      const updatedCase = {
        ...existingCase,
        status: 'in_progress',
        notes: [],
        timeline: [
          {
            id: 'tl-1',
            caseId: 'case-1',
            type: 'status_changed',
            actor: mockUser.email,
            description: 'Status changed from open to in_progress',
            timestamp: new Date(),
          },
        ],
        tenant: { name: 'AuraSpear' },
      }

      prisma.$transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            case: {
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              findUniqueOrThrow: jest.fn().mockResolvedValue(updatedCase),
            },
            caseTimeline: {
              create: jest.fn().mockResolvedValue({}),
            },
          }
          return callback(tx)
        }
      )

      const dto = { status: 'in_progress' }

      const result = await service.updateCase('case-1', dto as never, mockUser as never)

      expect(result.tenantName).toBe('AuraSpear')
      expect(prisma.$transaction).toHaveBeenCalled()
    })
  })

  /* ------------------------------------------------------------------ */
  /* deleteCase                                                           */
  /* ------------------------------------------------------------------ */

  describe('deleteCase', () => {
    it('should soft-delete case', async () => {
      const existingCase = {
        id: 'case-1',
        tenantId: TENANT_ID,
        caseNumber: 'SOC-2026-001',
        title: 'Suspicious login',
        description: 'Multiple failed logins',
        severity: 'high',
        status: 'open',
        ownerUserId: null,
        createdBy: 'admin@test.com',
        cycleId: 'cycle-1',
        linkedAlerts: [],
        closedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
        timeline: [],
        tenant: { name: 'AuraSpear' },
      }

      prisma.case.findFirst.mockResolvedValue(existingCase)
      prisma.user.findUnique.mockResolvedValue(null)

      prisma.$transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            case: {
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            caseTimeline: {
              create: jest.fn().mockResolvedValue({}),
            },
          }
          return callback(tx)
        }
      )

      const result = await service.deleteCase('case-1', TENANT_ID, mockUser.email)

      expect(result.deleted).toBe(true)
      expect(prisma.$transaction).toHaveBeenCalled()
    })
  })
})
