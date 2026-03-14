jest.mock('@prisma/client', () => ({
  PrismaClient: class PrismaClient {},
}))

import { BusinessException } from '../../src/common/exceptions/business.exception'
import { UserRole } from '../../src/common/interfaces/authenticated-request.interface'
import { AiService } from '../../src/modules/ai/ai.service'
import type { JwtPayload } from '../../src/common/interfaces/authenticated-request.interface'

const mockAppLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

const mockConnectorsService = {
  getDecryptedConfig: jest.fn().mockResolvedValue(null),
}

const mockBedrockService = {
  invoke: jest.fn(),
}

const mockUser: JwtPayload = {
  sub: 'user-1',
  tenantId: 'tenant-1',
  email: 'test@test.com',
  role: UserRole.SOC_ANALYST_L1,
  tenantSlug: 'test-tenant',
}

function createMockPrisma() {
  return {
    connectorConfig: {
      findFirst: jest.fn(),
    },
    alert: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    aiAuditLog: {
      create: jest.fn(),
    },
  }
}

function createService(prisma: ReturnType<typeof createMockPrisma>) {
  return new AiService(
    prisma as never,
    mockAppLogger as never,
    mockConnectorsService as never,
    mockBedrockService as never
  )
}

describe('AiService', () => {
  let prisma: ReturnType<typeof createMockPrisma>
  let service: AiService

  beforeEach(() => {
    jest.clearAllMocks()
    mockConnectorsService.getDecryptedConfig.mockResolvedValue(null)
    prisma = createMockPrisma()
    service = createService(prisma)
  })

  /* ------------------------------------------------------------------ */
  /* aiHunt                                                              */
  /* ------------------------------------------------------------------ */

  describe('aiHunt', () => {
    it('should return response with reasoning array and confidence', async () => {
      prisma.connectorConfig.findFirst.mockResolvedValue({
        id: 'conn-1',
        type: 'bedrock',
        enabled: true,
      })
      prisma.aiAuditLog.create.mockResolvedValue({})

      const result = await service.aiHunt({ query: 'detect lateral movement' }, mockUser)

      expect(result.result).toBeDefined()
      expect(result.result.length).toBeGreaterThan(0)
      expect(Array.isArray(result.reasoning)).toBe(true)
      expect(result.reasoning.length).toBeGreaterThan(0)
      expect(result.confidence).toBe(0.87)
      expect(result.model).toBe('rule-based')
      expect(result.tokensUsed.input).toBe(0)
      expect(result.tokensUsed.output).toBe(0)
    })

    it('should throw 403 when Bedrock connector not enabled', async () => {
      prisma.connectorConfig.findFirst.mockResolvedValue(null)

      await expect(service.aiHunt({ query: 'detect lateral movement' }, mockUser)).rejects.toThrow(
        BusinessException
      )

      try {
        await service.aiHunt({ query: 'detect lateral movement' }, mockUser)
      } catch (error) {
        expect((error as BusinessException).getStatus()).toBe(403)
        expect((error as BusinessException).messageKey).toBe('errors.ai.notEnabled')
      }
    })

    it('should generate hunt-specific response for brute force queries', async () => {
      prisma.connectorConfig.findFirst.mockResolvedValue({
        id: 'conn-1',
        type: 'bedrock',
        enabled: true,
      })
      prisma.aiAuditLog.create.mockResolvedValue({})

      const result = await service.aiHunt({ query: 'brute force attacks on login' }, mockUser)

      expect(result.result).toContain('Brute Force')
      expect(result.result).toContain('4625')
    })

    it('should generate hunt-specific response for C2 queries', async () => {
      prisma.connectorConfig.findFirst.mockResolvedValue({
        id: 'conn-1',
        type: 'bedrock',
        enabled: true,
      })
      prisma.aiAuditLog.create.mockResolvedValue({})

      const result = await service.aiHunt({ query: 'detect C2 beacon traffic' }, mockUser)

      expect(result.result).toContain('Command & Control')
      expect(result.result).toContain('T1071')
    })

    it('should generate generic response for unrecognized queries', async () => {
      prisma.connectorConfig.findFirst.mockResolvedValue({
        id: 'conn-1',
        type: 'bedrock',
        enabled: true,
      })
      prisma.aiAuditLog.create.mockResolvedValue({})

      const result = await service.aiHunt({ query: 'unusual network patterns' }, mockUser)

      expect(result.result).toContain('Threat Hunt Analysis')
      expect(result.result).toContain('unusual network patterns')
    })

    it('should log audit record after successful hunt', async () => {
      prisma.connectorConfig.findFirst.mockResolvedValue({
        id: 'conn-1',
        type: 'bedrock',
        enabled: true,
      })
      prisma.aiAuditLog.create.mockResolvedValue({})

      await service.aiHunt({ query: 'test query' }, mockUser)

      expect(prisma.aiAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 'tenant-1',
            actor: 'user-1',
            action: 'ai_hunt',
            model: 'rule-based',
            inputTokens: 0,
            outputTokens: 0,
          }),
        })
      )
    })

    it('should handle audit log failure gracefully without throwing', async () => {
      prisma.connectorConfig.findFirst.mockResolvedValue({
        id: 'conn-1',
        type: 'bedrock',
        enabled: true,
      })
      prisma.aiAuditLog.create.mockRejectedValue(new Error('Table not found'))

      // Should not throw even if audit logging fails
      const result = await service.aiHunt({ query: 'test query' }, mockUser)

      expect(result.result).toBeDefined()
      expect(result.confidence).toBe(0.87)
    })
  })

  /* ------------------------------------------------------------------ */
  /* aiInvestigate                                                       */
  /* ------------------------------------------------------------------ */

  describe('aiInvestigate', () => {
    const dto = { alertId: 'alert-1' }

    const mockAlert = {
      id: 'alert-1',
      tenantId: 'tenant-1',
      title: 'Suspicious Login Attempt',
      severity: 'medium',
      ruleId: 'rule-1',
      ruleName: 'Failed Login',
      sourceIp: '192.168.1.100',
      destinationIp: '10.0.0.1',
      agentName: 'agent-01',
      mitreTactics: ['Initial Access'],
      mitreTechniques: ['T1078'],
      description: 'Multiple failed login attempts detected',
      rawEvent: null,
      timestamp: new Date(),
    }

    it('should return investigation response', async () => {
      prisma.connectorConfig.findFirst.mockResolvedValue({
        id: 'conn-1',
        type: 'bedrock',
        enabled: true,
      })
      prisma.alert.findFirst.mockResolvedValue(mockAlert)
      prisma.aiAuditLog.create.mockResolvedValue({})

      const result = await service.aiInvestigate(dto, mockUser)

      expect(result.result).toContain('AI Investigation Report')
      expect(result.result).toContain('Suspicious Login Attempt')
      expect(result.confidence).toBeGreaterThan(0.5)
      expect(result.confidence).toBeLessThanOrEqual(0.99)
      expect(result.model).toBe('rule-based')
      expect(Array.isArray(result.reasoning)).toBe(true)
      expect(result.reasoning.length).toBeGreaterThan(0)
      expect(result.tokensUsed.input).toBe(0)
      expect(result.tokensUsed.output).toBe(0)
    })

    it('should throw 403 when AI not enabled', async () => {
      prisma.connectorConfig.findFirst.mockResolvedValue(null)

      await expect(service.aiInvestigate(dto, mockUser)).rejects.toThrow(BusinessException)

      try {
        await service.aiInvestigate(dto, mockUser)
      } catch (error) {
        expect((error as BusinessException).getStatus()).toBe(403)
        expect((error as BusinessException).messageKey).toBe('errors.ai.notEnabled')
      }
    })

    it('should throw 404 when alert not found', async () => {
      prisma.connectorConfig.findFirst.mockResolvedValue({
        id: 'conn-1',
        type: 'bedrock',
        enabled: true,
      })
      prisma.alert.findFirst.mockResolvedValue(null)

      await expect(service.aiInvestigate(dto, mockUser)).rejects.toThrow(BusinessException)

      try {
        await service.aiInvestigate(dto, mockUser)
      } catch (error) {
        expect((error as BusinessException).getStatus()).toBe(404)
        expect((error as BusinessException).messageKey).toBe('errors.alerts.notFound')
      }
    })

    it('should validate alert belongs to the caller tenant', async () => {
      prisma.connectorConfig.findFirst.mockResolvedValue({
        id: 'conn-1',
        type: 'bedrock',
        enabled: true,
      })
      prisma.alert.findFirst.mockResolvedValue(mockAlert)
      prisma.aiAuditLog.create.mockResolvedValue({})

      await service.aiInvestigate(dto, mockUser)

      expect(prisma.alert.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'alert-1', tenantId: 'tenant-1' },
        })
      )
    })

    it('should log audit record after investigation', async () => {
      prisma.connectorConfig.findFirst.mockResolvedValue({
        id: 'conn-1',
        type: 'bedrock',
        enabled: true,
      })
      prisma.alert.findFirst.mockResolvedValue(mockAlert)
      prisma.aiAuditLog.create.mockResolvedValue({})

      await service.aiInvestigate(dto, mockUser)

      expect(prisma.aiAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 'tenant-1',
            actor: 'user-1',
            action: 'ai_investigate',
            model: 'rule-based',
          }),
        })
      )
    })
  })

  /* ------------------------------------------------------------------ */
  /* aiExplain                                                           */
  /* ------------------------------------------------------------------ */

  describe('aiExplain', () => {
    const body = { prompt: 'Explain MITRE T1059 technique' }

    it('should return explanation response with confidence 0.95', async () => {
      prisma.connectorConfig.findFirst.mockResolvedValue({
        id: 'conn-1',
        type: 'bedrock',
        enabled: true,
      })
      prisma.aiAuditLog.create.mockResolvedValue({})

      const result = await service.aiExplain(body, mockUser)

      expect(result.result).toContain('Explainable AI Analysis')
      expect(result.result).toContain('Explain MITRE T1059 technique')
      expect(result.confidence).toBe(0.95)
      expect(result.model).toBe('anthropic.claude-3-sonnet')
      expect(Array.isArray(result.reasoning)).toBe(true)
      expect(result.reasoning.length).toBeGreaterThan(0)
      expect(result.tokensUsed.input).toBe(892)
      expect(result.tokensUsed.output).toBe(1654)
    })

    it('should throw 403 when AI not enabled', async () => {
      prisma.connectorConfig.findFirst.mockResolvedValue(null)

      await expect(service.aiExplain(body, mockUser)).rejects.toThrow(BusinessException)

      try {
        await service.aiExplain(body, mockUser)
      } catch (error) {
        expect((error as BusinessException).getStatus()).toBe(403)
        expect((error as BusinessException).messageKey).toBe('errors.ai.notEnabled')
      }
    })

    it('should log audit record after explanation', async () => {
      prisma.connectorConfig.findFirst.mockResolvedValue({
        id: 'conn-1',
        type: 'bedrock',
        enabled: true,
      })
      prisma.aiAuditLog.create.mockResolvedValue({})

      await service.aiExplain(body, mockUser)

      expect(prisma.aiAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 'tenant-1',
            actor: 'user-1',
            action: 'ai_explain',
            model: 'anthropic.claude-3-sonnet',
            inputTokens: 892,
            outputTokens: 1654,
          }),
        })
      )
    })

    it('should include reasoning steps in the response', async () => {
      prisma.connectorConfig.findFirst.mockResolvedValue({
        id: 'conn-1',
        type: 'bedrock',
        enabled: true,
      })
      prisma.aiAuditLog.create.mockResolvedValue({})

      const result = await service.aiExplain(body, mockUser)

      expect(result.reasoning).toContain('Parsing the security concept or finding to explain')
      expect(result.reasoning).toContain('Including remediation guidance and best practices')
    })

    it('should throw 503 when ensureAiEnabled encounters an unexpected error', async () => {
      prisma.connectorConfig.findFirst.mockRejectedValue(new Error('Database connection lost'))

      try {
        await service.aiExplain(body, mockUser)
        // Should not reach here
        expect(true).toBe(false)
      } catch (error) {
        expect(error).toBeInstanceOf(BusinessException)
        expect((error as BusinessException).getStatus()).toBe(503)
        expect((error as BusinessException).messageKey).toBe('errors.ai.serviceUnavailable')
      }
    })
  })
})
