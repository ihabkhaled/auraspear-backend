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
      findUnique: jest.fn(),
    },
    caseTimeline: {
      create: jest.fn(),
    },
    caseNote: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
    caseTask: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    caseArtifact: {
      findFirst: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
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
        tasks: [],
        artifacts: [],
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
        tasks: [],
        artifacts: [],
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
        tasks: [],
        artifacts: [],
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
        tasks: [],
        artifacts: [],
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
        tasks: [],
        artifacts: [],
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

    it('should reject updating a closed case (non-reopen, non-assignee change)', async () => {
      const closedCase = {
        id: 'case-1',
        tenantId: TENANT_ID,
        caseNumber: 'SOC-2026-001',
        title: 'Closed case',
        description: 'Test',
        severity: 'high',
        status: 'closed',
        ownerUserId: null,
        createdBy: mockUser.email,
        cycleId: null,
        linkedAlerts: [],
        closedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
        timeline: [],
        tasks: [],
        artifacts: [],
        tenant: { name: 'AuraSpear' },
      }

      prisma.case.findFirst.mockResolvedValue(closedCase)
      prisma.user.findUnique.mockResolvedValue({ name: 'Alice' })

      // Attempt to update title on a closed case (not a reopen or assignee change)
      const dto = { title: 'Updated title' }

      await expect(service.updateCase('case-1', dto as never, mockUser as never)).rejects.toThrow(
        BusinessException
      )

      try {
        await service.updateCase('case-1', dto as never, mockUser as never)
      } catch (error) {
        expect((error as BusinessException).getStatus()).toBe(400)
        expect((error as BusinessException).message).toBe('Cannot update a closed case')
      }

      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('should allow re-opening a closed case', async () => {
      const closedCase = {
        id: 'case-1',
        tenantId: TENANT_ID,
        caseNumber: 'SOC-2026-001',
        title: 'Closed case',
        description: 'Test',
        severity: 'high',
        status: 'closed',
        ownerUserId: null,
        createdBy: mockUser.email,
        cycleId: null,
        linkedAlerts: [],
        closedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
        timeline: [],
        tasks: [],
        artifacts: [],
        tenant: { name: 'AuraSpear' },
      }

      prisma.case.findFirst.mockResolvedValue(closedCase)
      prisma.user.findUnique.mockResolvedValue({ name: 'Alice' })

      const reopenedCase = {
        ...closedCase,
        status: 'open',
        closedAt: null,
        notes: [],
        timeline: [],
        tasks: [],
        artifacts: [],
        tenant: { name: 'AuraSpear' },
      }

      prisma.$transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            case: {
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              findUniqueOrThrow: jest.fn().mockResolvedValue(reopenedCase),
            },
            caseTimeline: {
              create: jest.fn().mockResolvedValue({}),
            },
          }
          return callback(tx)
        }
      )

      const dto = { status: 'open' }

      // Should NOT throw — re-opening is allowed
      const result = await service.updateCase('case-1', dto as never, mockUser as never)
      expect(result.tenantName).toBe('AuraSpear')
      expect(prisma.$transaction).toHaveBeenCalled()
    })

    it('should allow assignee change on a closed case', async () => {
      const closedCase = {
        id: 'case-1',
        tenantId: TENANT_ID,
        caseNumber: 'SOC-2026-001',
        title: 'Closed case',
        description: 'Test',
        severity: 'high',
        status: 'closed',
        ownerUserId: null,
        createdBy: mockUser.email,
        cycleId: null,
        linkedAlerts: [],
        closedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
        timeline: [],
        tasks: [],
        artifacts: [],
        tenant: { name: 'AuraSpear' },
      }

      prisma.case.findFirst.mockResolvedValue(closedCase)
      prisma.user.findUnique.mockResolvedValue({ name: 'Alice' })
      prisma.tenantMembership.findUnique.mockResolvedValue({
        userId: 'user-002',
        tenantId: TENANT_ID,
        status: 'active',
      })

      const updatedCase = {
        ...closedCase,
        ownerUserId: 'user-002',
        notes: [],
        timeline: [],
        tasks: [],
        artifacts: [],
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

      const dto = { ownerUserId: 'user-002' }

      // Should NOT throw — assignee change is allowed on closed cases
      const result = await service.updateCase('case-1', dto as never, mockUser as never)
      expect(result.tenantName).toBe('AuraSpear')
      expect(prisma.$transaction).toHaveBeenCalled()
    })
  })

  /* ------------------------------------------------------------------ */
  /* linkAlert (closed-case guard)                                        */
  /* ------------------------------------------------------------------ */

  describe('linkAlert', () => {
    it('should reject linking alert to a closed case', async () => {
      const closedCase = {
        id: 'case-1',
        tenantId: TENANT_ID,
        caseNumber: 'SOC-2026-001',
        title: 'Closed case',
        description: 'Test',
        severity: 'medium',
        status: 'closed',
        ownerUserId: null,
        createdBy: mockUser.email,
        cycleId: null,
        linkedAlerts: [],
        closedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
        timeline: [],
        tasks: [],
        artifacts: [],
        tenant: { name: 'AuraSpear' },
      }

      prisma.case.findFirst.mockResolvedValue(closedCase)
      prisma.user.findUnique.mockResolvedValue({ name: 'Alice' })

      const dto = { alertId: 'alert-1' }

      await expect(service.linkAlert('case-1', dto as never, mockUser as never)).rejects.toThrow(
        BusinessException
      )

      try {
        await service.linkAlert('case-1', dto as never, mockUser as never)
      } catch (error) {
        expect((error as BusinessException).getStatus()).toBe(400)
        expect((error as BusinessException).message).toBe('Cannot link alerts to a closed case')
      }

      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('should link alert to an open case', async () => {
      const openCase = {
        id: 'case-1',
        tenantId: TENANT_ID,
        caseNumber: 'SOC-2026-001',
        title: 'Open case',
        description: 'Test',
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
        tasks: [],
        artifacts: [],
        tenant: { name: 'AuraSpear' },
      }

      prisma.case.findFirst.mockResolvedValue(openCase)
      prisma.user.findUnique.mockResolvedValue({ name: 'Alice' })
      prisma.alert.count.mockResolvedValue(1)

      const updatedCase = {
        ...openCase,
        linkedAlerts: ['alert-1'],
        notes: [],
        timeline: [],
        tasks: [],
        artifacts: [],
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

      const dto = { alertId: 'alert-1' }

      const result = await service.linkAlert('case-1', dto as never, mockUser as never)
      expect(result.tenantName).toBe('AuraSpear')
      expect(prisma.$transaction).toHaveBeenCalled()
    })

    it('should reject duplicate alert link', async () => {
      const caseWithAlert = {
        id: 'case-1',
        tenantId: TENANT_ID,
        caseNumber: 'SOC-2026-001',
        title: 'Case with alert',
        description: 'Test',
        severity: 'medium',
        status: 'open',
        ownerUserId: null,
        createdBy: mockUser.email,
        cycleId: null,
        linkedAlerts: ['alert-1'],
        closedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
        timeline: [],
        tasks: [],
        artifacts: [],
        tenant: { name: 'AuraSpear' },
      }

      prisma.case.findFirst.mockResolvedValue(caseWithAlert)
      prisma.user.findUnique.mockResolvedValue({ name: 'Alice' })
      prisma.alert.count.mockResolvedValue(1)

      const dto = { alertId: 'alert-1' }

      await expect(service.linkAlert('case-1', dto as never, mockUser as never)).rejects.toThrow(
        BusinessException
      )

      try {
        await service.linkAlert('case-1', dto as never, mockUser as never)
      } catch (error) {
        expect((error as BusinessException).getStatus()).toBe(409)
      }
    })

    it('should reject linking alert that does not belong to tenant', async () => {
      const openCase = {
        id: 'case-1',
        tenantId: TENANT_ID,
        caseNumber: 'SOC-2026-001',
        title: 'Open case',
        description: 'Test',
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
        tasks: [],
        artifacts: [],
        tenant: { name: 'AuraSpear' },
      }

      prisma.case.findFirst.mockResolvedValue(openCase)
      prisma.user.findUnique.mockResolvedValue({ name: 'Alice' })
      // Alert does not belong to tenant
      prisma.alert.count.mockResolvedValue(0)

      const dto = { alertId: 'alert-foreign' }

      await expect(service.linkAlert('case-1', dto as never, mockUser as never)).rejects.toThrow(
        BusinessException
      )

      try {
        await service.linkAlert('case-1', dto as never, mockUser as never)
      } catch (error) {
        expect((error as BusinessException).getStatus()).toBe(400)
      }
    })
  })

  /* ------------------------------------------------------------------ */
  /* addCaseNote (closed-case guard)                                      */
  /* ------------------------------------------------------------------ */

  describe('addCaseNote', () => {
    it('should reject adding note to a closed case', async () => {
      const closedCase = {
        id: 'case-1',
        tenantId: TENANT_ID,
        caseNumber: 'SOC-2026-001',
        title: 'Closed case',
        description: 'Test',
        severity: 'medium',
        status: 'closed',
        ownerUserId: null,
        createdBy: mockUser.email,
        cycleId: null,
        linkedAlerts: [],
        closedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
        timeline: [],
        tasks: [],
        artifacts: [],
        tenant: { name: 'AuraSpear' },
      }

      prisma.case.findFirst.mockResolvedValue(closedCase)
      prisma.user.findUnique.mockResolvedValue({ name: 'Alice' })

      const dto = { body: 'This is a note' }

      await expect(service.addCaseNote('case-1', dto as never, mockUser as never)).rejects.toThrow(
        BusinessException
      )

      try {
        await service.addCaseNote('case-1', dto as never, mockUser as never)
      } catch (error) {
        expect((error as BusinessException).getStatus()).toBe(400)
        expect((error as BusinessException).message).toBe('Cannot add notes to a closed case')
      }

      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('should add note to an open case', async () => {
      const openCase = {
        id: 'case-1',
        tenantId: TENANT_ID,
        caseNumber: 'SOC-2026-001',
        title: 'Open case',
        description: 'Test',
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
        tasks: [],
        artifacts: [],
        tenant: { name: 'AuraSpear' },
      }

      prisma.case.findFirst.mockResolvedValue(openCase)
      prisma.user.findUnique.mockResolvedValue({ name: 'Alice' })

      const createdNote = {
        id: 'note-1',
        caseId: 'case-1',
        author: mockUser.email,
        body: 'Investigation note',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      prisma.$transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            caseNote: {
              create: jest.fn().mockResolvedValue(createdNote),
            },
            caseTimeline: {
              create: jest.fn().mockResolvedValue({}),
            },
          }
          return callback(tx)
        }
      )

      const dto = { body: 'Investigation note' }

      const result = await service.addCaseNote('case-1', dto as never, mockUser as never)
      expect(result.body).toBe('Investigation note')
      expect(result.author).toBe(mockUser.email)
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
        tasks: [],
        artifacts: [],
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

  /* ------------------------------------------------------------------ */
  /* createTask                                                           */
  /* ------------------------------------------------------------------ */

  describe('createTask', () => {
    it('should create task with timeline entry', async () => {
      // Mock getCaseById (called internally)
      const existingCase = {
        id: 'case-1',
        tenantId: TENANT_ID,
        caseNumber: 'SOC-2026-001',
        title: 'Test case',
        description: 'Test',
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
        tasks: [],
        artifacts: [],
        tenant: { name: 'AuraSpear' },
      }

      prisma.case.findFirst.mockResolvedValue(existingCase)
      prisma.user.findUnique.mockResolvedValue({ name: 'Alice' })

      const createdTask = {
        id: 'task-1',
        caseId: 'case-1',
        title: 'Review logs',
        status: 'pending',
        assignee: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      prisma.caseTask.create.mockResolvedValue(createdTask)
      prisma.caseTimeline.create.mockResolvedValue({})

      const dto = { title: 'Review logs' }

      const result = await service.createTask('case-1', dto as never, mockUser as never)

      expect(result.title).toBe('Review logs')
      expect(result.status).toBe('pending')
      expect(prisma.caseTask.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            caseId: 'case-1',
            title: 'Review logs',
            status: 'pending',
          }),
        })
      )
      expect(prisma.caseTimeline.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            caseId: 'case-1',
            actor: mockUser.email,
          }),
        })
      )
    })

    it('should create task with custom status and assignee', async () => {
      const existingCase = {
        id: 'case-1',
        tenantId: TENANT_ID,
        caseNumber: 'SOC-2026-001',
        title: 'Test case',
        description: 'Test',
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
        tasks: [],
        artifacts: [],
        tenant: { name: 'AuraSpear' },
      }

      prisma.case.findFirst.mockResolvedValue(existingCase)
      prisma.user.findUnique.mockResolvedValue({ name: 'Alice' })

      const createdTask = {
        id: 'task-1',
        caseId: 'case-1',
        title: 'Analyze malware',
        status: 'in_progress',
        assignee: 'bob@test.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      prisma.caseTask.create.mockResolvedValue(createdTask)
      prisma.caseTimeline.create.mockResolvedValue({})

      const dto = {
        title: 'Analyze malware',
        status: 'in_progress',
        assignee: 'bob@test.com',
      }

      const result = await service.createTask('case-1', dto as never, mockUser as never)

      expect(result.title).toBe('Analyze malware')
      expect(result.status).toBe('in_progress')
      expect(result.assignee).toBe('bob@test.com')
    })

    it('should reject creating task on a closed case', async () => {
      const closedCase = {
        id: 'case-1',
        tenantId: TENANT_ID,
        caseNumber: 'SOC-2026-001',
        title: 'Closed case',
        description: 'Test',
        severity: 'medium',
        status: 'closed',
        ownerUserId: null,
        createdBy: mockUser.email,
        cycleId: null,
        linkedAlerts: [],
        closedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
        timeline: [],
        tasks: [],
        artifacts: [],
        tenant: { name: 'AuraSpear' },
      }

      prisma.case.findFirst.mockResolvedValue(closedCase)
      prisma.user.findUnique.mockResolvedValue({ name: 'Alice' })

      const dto = { title: 'New task' }

      await expect(service.createTask('case-1', dto as never, mockUser as never)).rejects.toThrow(
        BusinessException
      )

      try {
        await service.createTask('case-1', dto as never, mockUser as never)
      } catch (error) {
        expect((error as BusinessException).getStatus()).toBe(400)
        expect((error as BusinessException).message).toBe('Cannot add tasks to a closed case')
      }

      // Ensure no task was created
      expect(prisma.caseTask.create).not.toHaveBeenCalled()
    })
  })

  /* ------------------------------------------------------------------ */
  /* updateTask                                                           */
  /* ------------------------------------------------------------------ */

  describe('updateTask', () => {
    it('should update task status and add timeline entry', async () => {
      // Mock getCaseById
      const existingCase = {
        id: 'case-1',
        tenantId: TENANT_ID,
        caseNumber: 'SOC-2026-001',
        title: 'Test case',
        description: 'Test',
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
        tasks: [],
        artifacts: [],
        tenant: { name: 'AuraSpear' },
      }

      prisma.case.findFirst.mockResolvedValue(existingCase)

      const existingTask = {
        id: 'task-1',
        caseId: 'case-1',
        title: 'Review logs',
        status: 'pending',
        assignee: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      prisma.caseTask.findFirst.mockResolvedValue(existingTask)

      const updatedTask = {
        ...existingTask,
        status: 'completed',
      }
      prisma.caseTask.update.mockResolvedValue(updatedTask)
      prisma.user.findUnique.mockResolvedValue({ name: 'Alice' })
      prisma.caseTimeline.create.mockResolvedValue({})

      const dto = { status: 'completed' }

      const result = await service.updateTask('case-1', 'task-1', dto as never, mockUser as never)

      expect(result.status).toBe('completed')
      expect(prisma.caseTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'task-1' },
          data: expect.objectContaining({ status: 'completed' }),
        })
      )
      // Timeline should be created because status changed
      expect(prisma.caseTimeline.create).toHaveBeenCalled()
    })

    it('should update task title without timeline when status unchanged', async () => {
      const existingCase = {
        id: 'case-1',
        tenantId: TENANT_ID,
        caseNumber: 'SOC-2026-001',
        title: 'Test case',
        description: 'Test',
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
        tasks: [],
        artifacts: [],
        tenant: { name: 'AuraSpear' },
      }

      prisma.case.findFirst.mockResolvedValue(existingCase)

      const existingTask = {
        id: 'task-1',
        caseId: 'case-1',
        title: 'Review logs',
        status: 'pending',
        assignee: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      prisma.caseTask.findFirst.mockResolvedValue(existingTask)

      const updatedTask = {
        ...existingTask,
        title: 'Review all logs',
      }
      prisma.caseTask.update.mockResolvedValue(updatedTask)
      prisma.user.findUnique.mockResolvedValue({ name: 'Alice' })

      const dto = { title: 'Review all logs' }

      const result = await service.updateTask('case-1', 'task-1', dto as never, mockUser as never)

      expect(result.title).toBe('Review all logs')
      // Timeline should NOT be created when only title changed (no status change)
      expect(prisma.caseTimeline.create).not.toHaveBeenCalled()
    })

    it('should throw when task not found', async () => {
      const existingCase = {
        id: 'case-1',
        tenantId: TENANT_ID,
        caseNumber: 'SOC-2026-001',
        title: 'Test case',
        description: 'Test',
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
        tasks: [],
        artifacts: [],
        tenant: { name: 'AuraSpear' },
      }

      prisma.case.findFirst.mockResolvedValue(existingCase)
      prisma.user.findUnique.mockResolvedValue(null)
      prisma.caseTask.findFirst.mockResolvedValue(null)

      await expect(
        service.updateTask('case-1', 'nonexistent', { title: 'x' } as never, mockUser as never)
      ).rejects.toThrow(BusinessException)
    })
  })

  /* ------------------------------------------------------------------ */
  /* deleteTask                                                           */
  /* ------------------------------------------------------------------ */

  describe('deleteTask', () => {
    it('should delete task and add timeline entry', async () => {
      const existingCase = {
        id: 'case-1',
        tenantId: TENANT_ID,
        caseNumber: 'SOC-2026-001',
        title: 'Test case',
        description: 'Test',
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
        tasks: [],
        artifacts: [],
        tenant: { name: 'AuraSpear' },
      }

      prisma.case.findFirst.mockResolvedValue(existingCase)

      const existingTask = {
        id: 'task-1',
        caseId: 'case-1',
        title: 'Review logs',
        status: 'pending',
        assignee: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      prisma.caseTask.findFirst.mockResolvedValue(existingTask)
      prisma.caseTask.delete.mockResolvedValue(existingTask)
      prisma.user.findUnique.mockResolvedValue({ name: 'Alice' })
      prisma.caseTimeline.create.mockResolvedValue({})

      const result = await service.deleteTask('case-1', 'task-1', mockUser as never)

      expect(result.deleted).toBe(true)
      expect(prisma.caseTask.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'task-1' } })
      )
      expect(prisma.caseTimeline.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            caseId: 'case-1',
            actor: mockUser.email,
          }),
        })
      )
    })

    it('should throw when task not found', async () => {
      const existingCase = {
        id: 'case-1',
        tenantId: TENANT_ID,
        caseNumber: 'SOC-2026-001',
        title: 'Test case',
        description: 'Test',
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
        tasks: [],
        artifacts: [],
        tenant: { name: 'AuraSpear' },
      }

      prisma.case.findFirst.mockResolvedValue(existingCase)
      prisma.user.findUnique.mockResolvedValue(null)
      prisma.caseTask.findFirst.mockResolvedValue(null)

      await expect(service.deleteTask('case-1', 'nonexistent', mockUser as never)).rejects.toThrow(
        BusinessException
      )
    })
  })

  /* ------------------------------------------------------------------ */
  /* createArtifact                                                       */
  /* ------------------------------------------------------------------ */

  describe('createArtifact', () => {
    it('should create artifact with timeline entry', async () => {
      const existingCase = {
        id: 'case-1',
        tenantId: TENANT_ID,
        caseNumber: 'SOC-2026-001',
        title: 'Test case',
        description: 'Test',
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
        tasks: [],
        artifacts: [],
        tenant: { name: 'AuraSpear' },
      }

      prisma.case.findFirst.mockResolvedValue(existingCase)

      // No duplicate
      prisma.caseArtifact.findFirst.mockResolvedValue(null)

      const createdArtifact = {
        id: 'artifact-1',
        caseId: 'case-1',
        type: 'ip',
        value: '192.168.1.1',
        source: 'manual',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      prisma.caseArtifact.create.mockResolvedValue(createdArtifact)
      prisma.user.findUnique.mockResolvedValue({ name: 'Alice' })
      prisma.caseTimeline.create.mockResolvedValue({})

      const dto = { type: 'ip', value: '192.168.1.1' }

      const result = await service.createArtifact('case-1', dto as never, mockUser as never)

      expect(result.type).toBe('ip')
      expect(result.value).toBe('192.168.1.1')
      expect(result.source).toBe('manual')
      expect(prisma.caseArtifact.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            caseId: 'case-1',
            type: 'ip',
            value: '192.168.1.1',
            source: 'manual',
          }),
        })
      )
      expect(prisma.caseTimeline.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            caseId: 'case-1',
            actor: mockUser.email,
          }),
        })
      )
    })

    it('should reject creating artifact on a closed case', async () => {
      const closedCase = {
        id: 'case-1',
        tenantId: TENANT_ID,
        caseNumber: 'SOC-2026-001',
        title: 'Closed case',
        description: 'Test',
        severity: 'medium',
        status: 'closed',
        ownerUserId: null,
        createdBy: mockUser.email,
        cycleId: null,
        linkedAlerts: [],
        closedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
        timeline: [],
        tasks: [],
        artifacts: [],
        tenant: { name: 'AuraSpear' },
      }

      prisma.case.findFirst.mockResolvedValue(closedCase)

      const dto = { type: 'ip', value: '10.0.0.1' }

      await expect(
        service.createArtifact('case-1', dto as never, mockUser as never)
      ).rejects.toThrow(BusinessException)

      try {
        await service.createArtifact('case-1', dto as never, mockUser as never)
      } catch (error) {
        expect((error as BusinessException).getStatus()).toBe(400)
        expect((error as BusinessException).message).toBe('Cannot add artifacts to a closed case')
      }

      // Ensure no artifact was created
      expect(prisma.caseArtifact.create).not.toHaveBeenCalled()
    })

    it('should reject duplicate artifact (same type + value)', async () => {
      const existingCase = {
        id: 'case-1',
        tenantId: TENANT_ID,
        caseNumber: 'SOC-2026-001',
        title: 'Test case',
        description: 'Test',
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
        tasks: [],
        artifacts: [],
        tenant: { name: 'AuraSpear' },
      }

      prisma.case.findFirst.mockResolvedValue(existingCase)
      prisma.user.findUnique.mockResolvedValue(null)

      // Duplicate exists
      prisma.caseArtifact.findFirst.mockResolvedValue({
        id: 'artifact-existing',
        caseId: 'case-1',
        type: 'ip',
        value: '192.168.1.1',
        source: 'manual',
      })

      const dto = { type: 'ip', value: '192.168.1.1' }

      await expect(
        service.createArtifact('case-1', dto as never, mockUser as never)
      ).rejects.toThrow(BusinessException)

      try {
        await service.createArtifact('case-1', dto as never, mockUser as never)
      } catch (error) {
        expect((error as BusinessException).getStatus()).toBe(409)
      }
    })
  })

  /* ------------------------------------------------------------------ */
  /* deleteArtifact                                                       */
  /* ------------------------------------------------------------------ */

  describe('deleteArtifact', () => {
    it('should delete artifact and add timeline entry', async () => {
      const existingCase = {
        id: 'case-1',
        tenantId: TENANT_ID,
        caseNumber: 'SOC-2026-001',
        title: 'Test case',
        description: 'Test',
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
        tasks: [],
        artifacts: [],
        tenant: { name: 'AuraSpear' },
      }

      prisma.case.findFirst.mockResolvedValue(existingCase)

      const existingArtifact = {
        id: 'artifact-1',
        caseId: 'case-1',
        type: 'hash',
        value: 'abc123def456',
        source: 'manual',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      prisma.caseArtifact.findFirst.mockResolvedValue(existingArtifact)
      prisma.caseArtifact.delete.mockResolvedValue(existingArtifact)
      prisma.user.findUnique.mockResolvedValue({ name: 'Alice' })
      prisma.caseTimeline.create.mockResolvedValue({})

      const result = await service.deleteArtifact('case-1', 'artifact-1', mockUser as never)

      expect(result.deleted).toBe(true)
      expect(prisma.caseArtifact.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'artifact-1' } })
      )
      expect(prisma.caseTimeline.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            caseId: 'case-1',
            actor: mockUser.email,
          }),
        })
      )
    })

    it('should throw when artifact not found', async () => {
      const existingCase = {
        id: 'case-1',
        tenantId: TENANT_ID,
        caseNumber: 'SOC-2026-001',
        title: 'Test case',
        description: 'Test',
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
        tasks: [],
        artifacts: [],
        tenant: { name: 'AuraSpear' },
      }

      prisma.case.findFirst.mockResolvedValue(existingCase)
      prisma.user.findUnique.mockResolvedValue(null)
      prisma.caseArtifact.findFirst.mockResolvedValue(null)

      await expect(
        service.deleteArtifact('case-1', 'nonexistent', mockUser as never)
      ).rejects.toThrow(BusinessException)
    })
  })
})
