import { AgentActionType, AiAgentId, AiTriggerMode } from '../../src/common/enums'
import { AgentSchedulerService } from '../../src/modules/ai/orchestrator/agent-scheduler.service'

/* ------------------------------------------------------------------ */
/* Mock factories                                                      */
/* ------------------------------------------------------------------ */

function createMockOrchestratorService() {
  return {
    dispatchAgentTask: jest.fn().mockResolvedValue({
      dispatched: true,
      jobId: 'job-001',
      automationMode: 'scheduled',
      requiresApproval: false,
    }),
  }
}

function createMockAgentConfigService() {
  return {
    getAgentConfig: jest.fn(),
  }
}

function createMockPrismaService() {
  return {
    tenantAgentConfig: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    tenant: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  }
}

function createMockAppLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('AgentSchedulerService', () => {
  let orchestratorService: ReturnType<typeof createMockOrchestratorService>
  let agentConfigService: ReturnType<typeof createMockAgentConfigService>
  let prisma: ReturnType<typeof createMockPrismaService>
  let appLogger: ReturnType<typeof createMockAppLogger>
  let service: AgentSchedulerService

  beforeEach(() => {
    jest.clearAllMocks()
    orchestratorService = createMockOrchestratorService()
    agentConfigService = createMockAgentConfigService()
    prisma = createMockPrismaService()
    appLogger = createMockAppLogger()
    service = new AgentSchedulerService(
      orchestratorService as never,
      agentConfigService as never,
      prisma as never,
      appLogger as never
    )
  })

  /* ---------------------------------------------------------------- */
  /* processScheduledAgents                                             */
  /* ---------------------------------------------------------------- */

  describe('processScheduledAgents', () => {
    it('should dispatch tasks for enabled scheduled agents', async () => {
      prisma.tenantAgentConfig.findMany.mockResolvedValue([
        { tenantId: 'tenant-001', agentId: 'rules-hygiene' },
        { tenantId: 'tenant-002', agentId: 'norm-verification' },
      ])

      const dispatched = await service.processScheduledAgents()

      expect(dispatched).toBe(2)
      expect(orchestratorService.dispatchAgentTask).toHaveBeenCalledTimes(2)
      expect(orchestratorService.dispatchAgentTask).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-001',
          agentId: 'rules-hygiene',
          actionType: AgentActionType.REVIEW,
          payload: { source: 'scheduler' },
          triggeredBy: 'system:scheduler',
        })
      )
      expect(orchestratorService.dispatchAgentTask).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-002',
          agentId: 'norm-verification',
        })
      )
    })

    it('should skip disabled agents (none returned from query)', async () => {
      prisma.tenantAgentConfig.findMany.mockResolvedValue([])

      const dispatched = await service.processScheduledAgents()

      expect(dispatched).toBe(0)
      expect(orchestratorService.dispatchAgentTask).not.toHaveBeenCalled()
    })

    it('should continue processing when one agent dispatch fails', async () => {
      prisma.tenantAgentConfig.findMany.mockResolvedValue([
        { tenantId: 'tenant-001', agentId: 'rules-hygiene' },
        { tenantId: 'tenant-002', agentId: 'norm-verification' },
      ])
      orchestratorService.dispatchAgentTask
        .mockRejectedValueOnce(new Error('Quota exceeded'))
        .mockResolvedValueOnce({ dispatched: true, jobId: 'job-002' })

      const dispatched = await service.processScheduledAgents()

      expect(dispatched).toBe(1)
      expect(orchestratorService.dispatchAgentTask).toHaveBeenCalledTimes(2)
      expect(appLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Quota exceeded'),
        expect.objectContaining({ tenantId: 'tenant-001' })
      )
    })

    it('should query only enabled configs with scheduled trigger mode', async () => {
      prisma.tenantAgentConfig.findMany.mockResolvedValue([])

      await service.processScheduledAgents()

      expect(prisma.tenantAgentConfig.findMany).toHaveBeenCalledWith({
        where: { isEnabled: true, triggerMode: AiTriggerMode.SCHEDULED },
        select: { tenantId: true, agentId: true },
      })
    })
  })

  /* ---------------------------------------------------------------- */
  /* runDailyDigests                                                    */
  /* ---------------------------------------------------------------- */

  describe('runDailyDigests', () => {
    it('should dispatch digest agents per tenant', async () => {
      prisma.tenant.findMany.mockResolvedValue([
        { id: 'tenant-001' },
        { id: 'tenant-002' },
        { id: 'tenant-003' },
      ])

      const dispatched = await service.runDailyDigests()

      expect(dispatched).toBe(3)
      expect(orchestratorService.dispatchAgentTask).toHaveBeenCalledTimes(3)
      expect(orchestratorService.dispatchAgentTask).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-001',
          agentId: AiAgentId.REPORTING,
          actionType: AgentActionType.REPORT,
          payload: { type: 'daily_digest' },
          triggeredBy: 'system:scheduler',
        })
      )
    })

    it('should return 0 when no active tenants exist', async () => {
      prisma.tenant.findMany.mockResolvedValue([])

      const dispatched = await service.runDailyDigests()

      expect(dispatched).toBe(0)
      expect(orchestratorService.dispatchAgentTask).not.toHaveBeenCalled()
    })

    it('should continue when one tenant digest fails', async () => {
      prisma.tenant.findMany.mockResolvedValue([{ id: 'tenant-001' }, { id: 'tenant-002' }])
      orchestratorService.dispatchAgentTask
        .mockRejectedValueOnce(new Error('Agent disabled'))
        .mockResolvedValueOnce({ dispatched: true, jobId: 'job-002' })

      const dispatched = await service.runDailyDigests()

      expect(dispatched).toBe(1)
      expect(appLogger.warn).toHaveBeenCalledTimes(1)
      expect(appLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('tenant-001'),
        expect.objectContaining({ tenantId: 'tenant-001' })
      )
    })

    it('should query all tenants', async () => {
      prisma.tenant.findMany.mockResolvedValue([])

      await service.runDailyDigests()

      expect(prisma.tenant.findMany).toHaveBeenCalledWith({
        select: { id: true },
      })
    })
  })
})
