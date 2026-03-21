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

const mockLlmApisService = {
  invoke: jest.fn(),
}

const mockOpenClawGatewayService = {
  invoke: jest.fn(),
}

const mockLlmConnectorsService = {
  hasEnabledConnectors: jest.fn().mockResolvedValue(false),
  getEnabledConfigs: jest.fn().mockResolvedValue([]),
}

const mockUser: JwtPayload = {
  sub: 'user-1',
  tenantId: 'tenant-1',
  email: 'test@test.com',
  role: UserRole.SOC_ANALYST_L1,
  tenantSlug: 'test-tenant',
}

const ENABLED_CONNECTOR = {
  id: 'conn-1',
  type: 'bedrock',
  enabled: true,
}

function createMockRepository() {
  return {
    findEnabledConnectorByTypes: jest.fn().mockResolvedValue([]),
    createAuditLog: jest.fn(),
    findAlertByIdAndTenant: jest.fn(),
    findRelatedAlerts: jest.fn().mockResolvedValue([]),
  }
}

function createService(repository: ReturnType<typeof createMockRepository>) {
  return new AiService(
    repository as never,
    mockAppLogger as never,
    mockConnectorsService as never,
    mockLlmConnectorsService as never,
    mockBedrockService as never,
    mockLlmApisService as never,
    mockOpenClawGatewayService as never
  )
}

describe('AiService', () => {
  let repository: ReturnType<typeof createMockRepository>
  let service: AiService

  beforeEach(() => {
    jest.clearAllMocks()
    mockConnectorsService.getDecryptedConfig.mockResolvedValue(null)
    mockLlmApisService.invoke.mockReset()
    mockOpenClawGatewayService.invoke.mockReset()
    repository = createMockRepository()
    service = createService(repository)
  })

  /* ------------------------------------------------------------------ */
  /* aiHunt                                                              */
  /* ------------------------------------------------------------------ */

  describe('aiHunt', () => {
    it('should return response with reasoning array and confidence', async () => {
      repository.findEnabledConnectorByTypes.mockResolvedValue([ENABLED_CONNECTOR])
      repository.createAuditLog.mockResolvedValue(undefined)

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
      repository.findEnabledConnectorByTypes.mockResolvedValue([])

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
      repository.findEnabledConnectorByTypes.mockResolvedValue([ENABLED_CONNECTOR])
      repository.createAuditLog.mockResolvedValue(undefined)

      const result = await service.aiHunt({ query: 'brute force attacks on login' }, mockUser)

      expect(result.result).toContain('Brute Force')
      expect(result.result).toContain('4625')
    })

    it('should generate hunt-specific response for C2 queries', async () => {
      repository.findEnabledConnectorByTypes.mockResolvedValue([ENABLED_CONNECTOR])
      repository.createAuditLog.mockResolvedValue(undefined)

      const result = await service.aiHunt({ query: 'detect C2 beacon traffic' }, mockUser)

      expect(result.result).toContain('Command & Control')
      expect(result.result).toContain('T1071')
    })

    it('should generate generic response for unrecognized queries', async () => {
      repository.findEnabledConnectorByTypes.mockResolvedValue([ENABLED_CONNECTOR])
      repository.createAuditLog.mockResolvedValue(undefined)

      const result = await service.aiHunt({ query: 'unusual network patterns' }, mockUser)

      expect(result.result).toContain('Threat Hunt Analysis')
      expect(result.result).toContain('unusual network patterns')
    })

    it('should log audit record after successful hunt', async () => {
      repository.findEnabledConnectorByTypes.mockResolvedValue([ENABLED_CONNECTOR])
      repository.createAuditLog.mockResolvedValue(undefined)

      await service.aiHunt({ query: 'test query' }, mockUser)

      expect(repository.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          actor: 'user-1',
          action: 'ai_hunt',
          model: 'rule-based',
          inputTokens: 0,
          outputTokens: 0,
        })
      )
    })

    it('should handle audit log failure gracefully without throwing', async () => {
      repository.findEnabledConnectorByTypes.mockResolvedValue([ENABLED_CONNECTOR])
      repository.createAuditLog.mockRejectedValue(new Error('Table not found'))

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
      repository.findEnabledConnectorByTypes.mockResolvedValue([ENABLED_CONNECTOR])
      repository.findAlertByIdAndTenant.mockResolvedValue(mockAlert)
      repository.createAuditLog.mockResolvedValue(undefined)

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
      repository.findEnabledConnectorByTypes.mockResolvedValue([])

      await expect(service.aiInvestigate(dto, mockUser)).rejects.toThrow(BusinessException)

      try {
        await service.aiInvestigate(dto, mockUser)
      } catch (error) {
        expect((error as BusinessException).getStatus()).toBe(403)
        expect((error as BusinessException).messageKey).toBe('errors.ai.notEnabled')
      }
    })

    it('should throw 404 when alert not found', async () => {
      repository.findEnabledConnectorByTypes.mockResolvedValue([ENABLED_CONNECTOR])
      repository.findAlertByIdAndTenant.mockResolvedValue(null)

      await expect(service.aiInvestigate(dto, mockUser)).rejects.toThrow(BusinessException)

      try {
        await service.aiInvestigate(dto, mockUser)
      } catch (error) {
        expect((error as BusinessException).getStatus()).toBe(404)
        expect((error as BusinessException).messageKey).toBe('errors.alerts.notFound')
      }
    })

    it('should validate alert belongs to the caller tenant', async () => {
      repository.findEnabledConnectorByTypes.mockResolvedValue([ENABLED_CONNECTOR])
      repository.findAlertByIdAndTenant.mockResolvedValue(mockAlert)
      repository.createAuditLog.mockResolvedValue(undefined)

      await service.aiInvestigate(dto, mockUser)

      expect(repository.findAlertByIdAndTenant).toHaveBeenCalledWith('alert-1', 'tenant-1')
    })

    it('should log audit record after investigation', async () => {
      repository.findEnabledConnectorByTypes.mockResolvedValue([ENABLED_CONNECTOR])
      repository.findAlertByIdAndTenant.mockResolvedValue(mockAlert)
      repository.createAuditLog.mockResolvedValue(undefined)

      await service.aiInvestigate(dto, mockUser)

      expect(repository.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          actor: 'user-1',
          action: 'ai_investigate',
          model: 'rule-based',
        })
      )
    })
  })

  /* ------------------------------------------------------------------ */
  /* aiExplain                                                           */
  /* ------------------------------------------------------------------ */

  describe('aiExplain', () => {
    const body = { prompt: 'Explain MITRE T1059 technique' }

    it('should return explanation response with fallback confidence', async () => {
      repository.findEnabledConnectorByTypes.mockResolvedValue([ENABLED_CONNECTOR])
      repository.createAuditLog.mockResolvedValue(undefined)

      const result = await service.aiExplain(body, mockUser)

      expect(result.result).toContain('Explainable AI Analysis')
      expect(result.result).toContain('Explain MITRE T1059 technique')
      expect(result.confidence).toBe(0.85)
      expect(result.model).toBe('rule-based')
      expect(Array.isArray(result.reasoning)).toBe(true)
      expect(result.reasoning.length).toBeGreaterThan(0)
      expect(result.tokensUsed.input).toBe(0)
      expect(result.tokensUsed.output).toBe(0)
    })

    it('should throw 403 when AI not enabled', async () => {
      repository.findEnabledConnectorByTypes.mockResolvedValue([])

      await expect(service.aiExplain(body, mockUser)).rejects.toThrow(BusinessException)

      try {
        await service.aiExplain(body, mockUser)
      } catch (error) {
        expect((error as BusinessException).getStatus()).toBe(403)
        expect((error as BusinessException).messageKey).toBe('errors.ai.notEnabled')
      }
    })

    it('should log audit record after explanation', async () => {
      repository.findEnabledConnectorByTypes.mockResolvedValue([ENABLED_CONNECTOR])
      repository.createAuditLog.mockResolvedValue(undefined)

      await service.aiExplain(body, mockUser)

      expect(repository.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          actor: 'user-1',
          action: 'ai_explain',
          model: 'rule-based',
          inputTokens: 0,
          outputTokens: 0,
        })
      )
    })

    it('should include reasoning steps in the response', async () => {
      repository.findEnabledConnectorByTypes.mockResolvedValue([ENABLED_CONNECTOR])
      repository.createAuditLog.mockResolvedValue(undefined)

      const result = await service.aiExplain(body, mockUser)

      expect(result.reasoning).toContain('Parsing the security concept or finding to explain')
      expect(result.reasoning).toContain('Including remediation guidance and best practices')
    })

    it('should throw 503 when ensureAiEnabled encounters an unexpected error', async () => {
      repository.findEnabledConnectorByTypes.mockRejectedValue(
        new Error('Database connection lost')
      )

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
