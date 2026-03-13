import { BusinessException } from '../../src/common/exceptions/business.exception'
import { CaseCyclesService } from '../../src/modules/case-cycles/case-cycles.service'

function createMockPrisma() {
  return {
    caseCycle: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
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

function createMockAppLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }
}

describe('CaseCyclesService', () => {
  let service: CaseCyclesService
  let prisma: ReturnType<typeof createMockPrisma>

  beforeEach(() => {
    prisma = createMockPrisma()
    const appLogger = createMockAppLogger()
    service = new CaseCyclesService(prisma as never, appLogger as never)
  })

  /* ------------------------------------------------------------------ */
  /* listCycles                                                          */
  /* ------------------------------------------------------------------ */

  describe('listCycles', () => {
    it('should return paginated cycles with case counts', async () => {
      const rawCycles = [
        {
          id: 'cycle-1',
          tenantId: TENANT_ID,
          name: 'Q1 2026',
          description: null,
          status: 'active',
          startDate: new Date('2026-01-01'),
          endDate: null,
          createdBy: 'admin@test.com',
          closedBy: null,
          closedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: { cases: 3 },
          cases: [{ status: 'open' }, { status: 'in_progress' }, { status: 'closed' }],
        },
      ]

      prisma.caseCycle.findMany.mockResolvedValue(rawCycles)
      prisma.caseCycle.count.mockResolvedValue(1)

      const result = await service.listCycles(TENANT_ID, 1, 20)

      expect(result.data).toHaveLength(1)
      const first = result.data[0]
      expect(first).toBeDefined()
      expect(first?.caseCount).toBe(3)
      expect(first?.openCount).toBe(2)
      expect(first?.closedCount).toBe(1)
      expect(result.pagination.total).toBe(1)
      expect(result.pagination.page).toBe(1)
      expect(prisma.caseCycle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT_ID },
          skip: 0,
          take: 20,
        })
      )
    })
  })

  /* ------------------------------------------------------------------ */
  /* getActiveCycle                                                       */
  /* ------------------------------------------------------------------ */

  describe('getActiveCycle', () => {
    it('should return active cycle when one exists', async () => {
      const rawCycle = {
        id: 'cycle-1',
        tenantId: TENANT_ID,
        name: 'Q1 2026',
        description: null,
        status: 'active',
        startDate: new Date('2026-01-01'),
        endDate: null,
        createdBy: 'admin@test.com',
        closedBy: null,
        closedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { cases: 2 },
        cases: [{ status: 'open' }, { status: 'closed' }],
      }

      prisma.caseCycle.findFirst.mockResolvedValue(rawCycle)

      const result = await service.getActiveCycle(TENANT_ID)

      expect(result).not.toBeNull()
      expect(result?.name).toBe('Q1 2026')
      expect(result?.caseCount).toBe(2)
      expect(result?.openCount).toBe(1)
      expect(result?.closedCount).toBe(1)
      expect(prisma.caseCycle.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT_ID, status: 'active' },
        })
      )
    })

    it('should return null when no active cycle', async () => {
      prisma.caseCycle.findFirst.mockResolvedValue(null)

      const result = await service.getActiveCycle(TENANT_ID)

      expect(result).toBeNull()
    })
  })

  /* ------------------------------------------------------------------ */
  /* getCycleById                                                        */
  /* ------------------------------------------------------------------ */

  describe('getCycleById', () => {
    it('should return cycle detail with resolved owners', async () => {
      const rawCycle = {
        id: 'cycle-1',
        tenantId: TENANT_ID,
        name: 'Q1 2026',
        description: 'First quarter',
        status: 'active',
        startDate: new Date('2026-01-01'),
        endDate: null,
        createdBy: 'admin@test.com',
        closedBy: null,
        closedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { cases: 2 },
        cases: [
          {
            id: 'case-1',
            ownerUserId: 'user-001',
            status: 'open',
            tenant: { name: 'AuraSpear' },
            createdAt: new Date(),
          },
          {
            id: 'case-2',
            ownerUserId: 'user-002',
            status: 'closed',
            tenant: { name: 'AuraSpear' },
            createdAt: new Date(),
          },
        ],
      }

      prisma.caseCycle.findFirst.mockResolvedValue(rawCycle)
      prisma.user.findMany.mockResolvedValue([
        { id: 'user-001', name: 'Alice', email: 'alice@test.com' },
        { id: 'user-002', name: 'Bob', email: 'bob@test.com' },
      ])

      const result = await service.getCycleById('cycle-1', TENANT_ID)

      expect(result.caseCount).toBe(2)
      expect(result.openCount).toBe(1)
      expect(result.closedCount).toBe(1)
      expect(result.cases).toHaveLength(2)
      const firstCase = result.cases[0]
      const secondCase = result.cases[1]
      expect(firstCase).toBeDefined()
      expect(secondCase).toBeDefined()
      expect(firstCase?.ownerName).toBe('Alice')
      expect(secondCase?.ownerEmail).toBe('bob@test.com')
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['user-001', 'user-002'] } },
        })
      )
    })

    it('should throw BusinessException when cycle not found', async () => {
      prisma.caseCycle.findFirst.mockResolvedValue(null)

      await expect(service.getCycleById('nonexistent', TENANT_ID)).rejects.toThrow(
        BusinessException
      )
    })
  })

  /* ------------------------------------------------------------------ */
  /* createCycle                                                          */
  /* ------------------------------------------------------------------ */

  describe('createCycle', () => {
    it('should create a new cycle when no active exists', async () => {
      prisma.caseCycle.findFirst.mockResolvedValue(null)

      const createdCycle = {
        id: 'cycle-new',
        tenantId: TENANT_ID,
        name: 'Q2 2026',
        description: 'Second quarter',
        status: 'active',
        startDate: new Date('2026-04-01'),
        endDate: null,
        createdBy: mockUser.email,
        closedBy: null,
        closedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      prisma.caseCycle.create.mockResolvedValue(createdCycle)

      const dto = {
        name: 'Q2 2026',
        description: 'Second quarter',
        startDate: new Date('2026-04-01'),
      }

      const result = await service.createCycle(dto, mockUser as never)

      expect(result.name).toBe('Q2 2026')
      expect(result.caseCount).toBe(0)
      expect(result.openCount).toBe(0)
      expect(result.closedCount).toBe(0)
      expect(prisma.caseCycle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT_ID,
            name: 'Q2 2026',
            status: 'active',
          }),
        })
      )
    })

    it('should throw 409 when active cycle already exists', async () => {
      prisma.caseCycle.findFirst.mockResolvedValue({
        id: 'cycle-existing',
        name: 'Q1 2026',
      })

      const dto = {
        name: 'Q2 2026',
        startDate: new Date('2026-04-01'),
      }

      await expect(service.createCycle(dto, mockUser as never)).rejects.toThrow(BusinessException)

      try {
        await service.createCycle(dto, mockUser as never)
      } catch (error) {
        expect((error as BusinessException).getStatus()).toBe(409)
      }
    })
  })

  /* ------------------------------------------------------------------ */
  /* closeCycle                                                           */
  /* ------------------------------------------------------------------ */

  describe('closeCycle', () => {
    it('should close an active cycle', async () => {
      const existingCycle = {
        id: 'cycle-1',
        tenantId: TENANT_ID,
        name: 'Q1 2026',
        status: 'active',
        _count: { cases: 2 },
        cases: [{ status: 'open' }, { status: 'closed' }],
      }

      prisma.caseCycle.findFirst.mockResolvedValue(existingCycle)

      const updatedCycle = {
        id: 'cycle-1',
        tenantId: TENANT_ID,
        name: 'Q1 2026',
        description: null,
        status: 'closed',
        startDate: new Date('2026-01-01'),
        endDate: new Date(),
        createdBy: 'admin@test.com',
        closedBy: mockUser.email,
        closedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      prisma.caseCycle.update.mockResolvedValue(updatedCycle)

      const dto = { endDate: new Date() }
      const result = await service.closeCycle('cycle-1', dto, mockUser as never)

      expect(result.caseCount).toBe(2)
      expect(result.openCount).toBe(1)
      expect(result.closedCount).toBe(1)
      expect(prisma.caseCycle.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cycle-1' },
          data: expect.objectContaining({ status: 'closed' }),
        })
      )
    })

    it('should throw when cycle not found', async () => {
      prisma.caseCycle.findFirst.mockResolvedValue(null)

      const dto = { endDate: new Date() }

      await expect(service.closeCycle('nonexistent', dto, mockUser as never)).rejects.toThrow(
        BusinessException
      )
    })

    it('should throw when cycle already closed', async () => {
      prisma.caseCycle.findFirst.mockResolvedValue({
        id: 'cycle-1',
        tenantId: TENANT_ID,
        name: 'Q1 2026',
        status: 'closed',
        _count: { cases: 0 },
        cases: [],
      })

      const dto = { endDate: new Date() }

      await expect(service.closeCycle('cycle-1', dto, mockUser as never)).rejects.toThrow(
        BusinessException
      )

      try {
        await service.closeCycle('cycle-1', dto, mockUser as never)
      } catch (error) {
        expect((error as BusinessException).getStatus()).toBe(400)
      }
    })
  })
})
