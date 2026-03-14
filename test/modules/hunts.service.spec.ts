import { BusinessException } from '../../src/common/exceptions/business.exception'
import { HuntsService } from '../../src/modules/hunts/hunts.service'

const mockAppLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

function createMockPrisma() {
  return {
    huntSession: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    huntEvent: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
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
const USER_EMAIL = 'analyst@auraspear.com'

describe('HuntsService', () => {
  let service: HuntsService
  let prisma: ReturnType<typeof createMockPrisma>
  let connectorsService: ReturnType<typeof createMockConnectorsService>
  let wazuhService: ReturnType<typeof createMockWazuhService>

  beforeEach(() => {
    prisma = createMockPrisma()
    connectorsService = createMockConnectorsService()
    wazuhService = createMockWazuhService()
    service = new HuntsService(
      prisma as never,
      connectorsService as never,
      wazuhService as never,
      mockAppLogger as never
    )
    jest.clearAllMocks()
  })

  /* ------------------------------------------------------------------ */
  /* runHunt                                                              */
  /* ------------------------------------------------------------------ */

  describe('runHunt', () => {
    const dto = { query: 'failed login', timeRange: '24h' as const }
    const sessionId = 'session-001'

    const mockSession = {
      id: sessionId,
      tenantId: TENANT_ID,
      query: dto.query,
      status: 'running' as const,
      startedBy: USER_EMAIL,
      reasoning: ['Querying Wazuh Indexer for matching events'],
      startedAt: new Date(),
      completedAt: null,
      eventsFound: null,
    }

    it('should create session, query Wazuh, extract events, and update status to completed', async () => {
      prisma.huntSession.create.mockResolvedValueOnce(mockSession)
      connectorsService.getDecryptedConfig.mockResolvedValueOnce({
        indexerUrl: 'https://wazuh.local:9200',
        indexerUsername: 'admin',
        indexerPassword: 'secret',
      })

      const wazuhHits = [
        {
          _id: 'event-001',
          _source: {
            timestamp: '2026-03-10T12:00:00Z',
            'rule.level': 12,
            'rule.description': 'Multiple failed SSH logins',
            src_ip: '192.168.1.100',
            'data.dstuser': 'root',
          },
        },
        {
          _id: 'event-002',
          _source: {
            timestamp: '2026-03-10T12:05:00Z',
            'rule.level': 6,
            message: 'Failed password for user admin',
            'agent.ip': '10.0.0.5',
            'data.srcuser': 'admin',
          },
        },
      ]

      wazuhService.searchAlerts.mockResolvedValueOnce({
        hits: wazuhHits,
        total: 2,
      })

      prisma.huntEvent.createMany.mockResolvedValueOnce({ count: 2 })

      const updatedSession = {
        ...mockSession,
        status: 'completed',
        completedAt: new Date(),
        eventsFound: 2,
        events: [],
      }
      prisma.huntSession.update.mockResolvedValueOnce(updatedSession)

      const result = await service.runHunt(TENANT_ID, dto, USER_EMAIL)

      // Verify session creation
      expect(prisma.huntSession.create).toHaveBeenCalledWith({
        data: {
          tenantId: TENANT_ID,
          query: dto.query,
          status: 'running',
          startedBy: USER_EMAIL,
          reasoning: ['Querying Wazuh Indexer for matching events'],
        },
      })

      // Verify Wazuh connector config was fetched
      expect(connectorsService.getDecryptedConfig).toHaveBeenCalledWith(TENANT_ID, 'wazuh')

      // Verify Wazuh was queried
      expect(wazuhService.searchAlerts).toHaveBeenCalled()

      // Verify events were stored
      expect(prisma.huntEvent.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            huntSessionId: sessionId,
            eventId: 'event-001',
            severity: 'critical',
            sourceIp: '192.168.1.100',
            user: 'root',
            description: 'Multiple failed SSH logins',
          }),
          expect.objectContaining({
            huntSessionId: sessionId,
            eventId: 'event-002',
            severity: 'medium',
            sourceIp: '10.0.0.5',
            user: 'admin',
          }),
        ]),
      })

      // Verify session was updated to completed
      expect(prisma.huntSession.update).toHaveBeenCalledWith({
        where: { id: sessionId },
        data: expect.objectContaining({
          status: 'completed',
          eventsFound: 2,
        }),
        include: { events: true },
      })

      expect(result.status).toBe('completed')
    })

    it('should throw 422 when Wazuh connector is not configured', async () => {
      prisma.huntSession.create.mockResolvedValueOnce(mockSession)
      connectorsService.getDecryptedConfig.mockResolvedValueOnce(null)
      prisma.huntSession.update.mockResolvedValueOnce({
        ...mockSession,
        status: 'error',
      })

      try {
        await service.runHunt(TENANT_ID, dto, USER_EMAIL)
        // Should not reach here
        expect(true).toBe(false)
      } catch (error) {
        expect(error).toBeInstanceOf(BusinessException)
        const bizError = error as BusinessException
        expect(bizError.getStatus()).toBe(422)
        expect(bizError.messageKey).toBe('errors.hunts.searchConnectorNotConfigured')
      }

      // Verify session was updated to error before throwing
      expect(prisma.huntSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'error' }),
        })
      )
    })

    it('should update session to ERROR when Wazuh query fails', async () => {
      prisma.huntSession.create.mockResolvedValueOnce(mockSession)
      connectorsService.getDecryptedConfig.mockResolvedValueOnce({
        indexerUrl: 'https://wazuh.local:9200',
        indexerUsername: 'admin',
        indexerPassword: 'secret',
      })
      wazuhService.searchAlerts.mockRejectedValueOnce(
        new Error('Wazuh Indexer search failed: status 503')
      )
      prisma.huntSession.update.mockResolvedValueOnce({
        ...mockSession,
        status: 'error',
        reasoning: [
          'Querying Wazuh Indexer for matching events',
          'Query failed: Wazuh Indexer search failed: status 503',
        ],
      })

      await expect(service.runHunt(TENANT_ID, dto, USER_EMAIL)).rejects.toThrow(BusinessException)

      expect(prisma.huntSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'error',
            reasoning: expect.arrayContaining([expect.stringContaining('Query failed')]),
          }),
        })
      )
    })

    it('should sanitize dangerous queries with script injection patterns', async () => {
      const maliciousDto = { query: 'script alert("xss")', timeRange: '24h' as const }

      prisma.huntSession.create.mockResolvedValueOnce({
        ...mockSession,
        query: maliciousDto.query,
      })
      connectorsService.getDecryptedConfig.mockResolvedValueOnce({
        indexerUrl: 'https://wazuh.local:9200',
        indexerUsername: 'admin',
        indexerPassword: 'secret',
      })
      wazuhService.searchAlerts.mockResolvedValueOnce({
        hits: [],
        total: 0,
      })
      prisma.huntSession.update.mockResolvedValueOnce({
        ...mockSession,
        status: 'completed',
        eventsFound: 0,
        events: [],
      })

      await service.runHunt(TENANT_ID, maliciousDto, USER_EMAIL)

      // Verify Wazuh was called with sanitized query (script keyword removed)
      const searchCall = wazuhService.searchAlerts.mock.calls[0]
      const esQuery = searchCall[1] as Record<string, unknown>
      const boolQuery = (esQuery.query as Record<string, unknown>).bool as Record<string, unknown>
      const must = boolQuery.must as Array<Record<string, unknown>>
      const simpleQueryString = must[0]?.simple_query_string as Record<string, unknown>
      // "script" should be removed from the query
      expect(simpleQueryString.query).not.toMatch(/\bscript\b/i)
    })

    it('should throw 400 when query is empty after sanitization', async () => {
      // A query that becomes empty after sanitization
      const emptyAfterSanitizeDto = { query: 'script', timeRange: '24h' as const }

      prisma.huntSession.create.mockResolvedValueOnce({
        ...mockSession,
        query: emptyAfterSanitizeDto.query,
      })
      connectorsService.getDecryptedConfig.mockResolvedValueOnce({
        indexerUrl: 'https://wazuh.local:9200',
        indexerUsername: 'admin',
        indexerPassword: 'secret',
      })

      await expect(service.runHunt(TENANT_ID, emptyAfterSanitizeDto, USER_EMAIL)).rejects.toThrow(
        BusinessException
      )
    })

    it('should handle zero events from Wazuh without calling createMany', async () => {
      prisma.huntSession.create.mockResolvedValueOnce(mockSession)
      connectorsService.getDecryptedConfig.mockResolvedValueOnce({
        indexerUrl: 'https://wazuh.local:9200',
        indexerUsername: 'admin',
        indexerPassword: 'secret',
      })
      wazuhService.searchAlerts.mockResolvedValueOnce({
        hits: [],
        total: 0,
      })
      prisma.huntSession.update.mockResolvedValueOnce({
        ...mockSession,
        status: 'completed',
        eventsFound: 0,
        events: [],
      })

      await service.runHunt(TENANT_ID, dto, USER_EMAIL)

      expect(prisma.huntEvent.createMany).not.toHaveBeenCalled()
    })
  })

  /* ------------------------------------------------------------------ */
  /* listRuns                                                             */
  /* ------------------------------------------------------------------ */

  describe('listRuns', () => {
    it('should return paginated sessions', async () => {
      const sessions = [
        {
          id: 'session-001',
          tenantId: TENANT_ID,
          query: 'failed login',
          status: 'completed',
          startedBy: USER_EMAIL,
          startedAt: new Date(),
          completedAt: new Date(),
          eventsFound: 5,
          reasoning: [],
        },
        {
          id: 'session-002',
          tenantId: TENANT_ID,
          query: 'suspicious process',
          status: 'running',
          startedBy: USER_EMAIL,
          startedAt: new Date(),
          completedAt: null,
          eventsFound: null,
          reasoning: [],
        },
      ]

      prisma.huntSession.findMany.mockResolvedValueOnce(sessions)
      prisma.huntSession.count.mockResolvedValueOnce(2)

      const result = await service.listRuns(TENANT_ID, 1, 10)

      expect(result.data).toHaveLength(2)
      expect(result.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 2,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      })

      expect(prisma.huntSession.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID },
        orderBy: { startedAt: 'desc' },
        skip: 0,
        take: 10,
      })
    })

    it('should handle empty list', async () => {
      prisma.huntSession.findMany.mockResolvedValueOnce([])
      prisma.huntSession.count.mockResolvedValueOnce(0)

      const result = await service.listRuns(TENANT_ID, 1, 10)

      expect(result.data).toEqual([])
      expect(result.pagination.total).toBe(0)
      expect(result.pagination.totalPages).toBe(0)
      expect(result.pagination.hasNext).toBe(false)
      expect(result.pagination.hasPrev).toBe(false)
    })

    it('should calculate pagination correctly for page 2', async () => {
      prisma.huntSession.findMany.mockResolvedValueOnce([
        {
          id: 'session-003',
          tenantId: TENANT_ID,
          query: 'port scan',
          status: 'completed',
          startedBy: USER_EMAIL,
          startedAt: new Date(),
          completedAt: new Date(),
          eventsFound: 10,
          reasoning: [],
        },
      ])
      prisma.huntSession.count.mockResolvedValueOnce(15)

      const result = await service.listRuns(TENANT_ID, 2, 10)

      expect(result.pagination).toEqual({
        page: 2,
        limit: 10,
        total: 15,
        totalPages: 2,
        hasNext: false,
        hasPrev: true,
      })

      expect(prisma.huntSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        })
      )
    })
  })

  /* ------------------------------------------------------------------ */
  /* getRun                                                               */
  /* ------------------------------------------------------------------ */

  describe('getRun', () => {
    it('should return session with events', async () => {
      const sessionWithEvents = {
        id: 'session-001',
        tenantId: TENANT_ID,
        query: 'failed login',
        status: 'completed',
        startedBy: USER_EMAIL,
        startedAt: new Date(),
        completedAt: new Date(),
        eventsFound: 2,
        reasoning: ['Querying Wazuh Indexer for matching events', 'Found 2 matching events'],
        events: [
          {
            id: 'event-001',
            huntSessionId: 'session-001',
            timestamp: new Date(),
            severity: 'critical',
            eventId: 'wazuh-evt-001',
            sourceIp: '192.168.1.100',
            user: 'root',
            description: 'SSH brute force detected',
          },
          {
            id: 'event-002',
            huntSessionId: 'session-001',
            timestamp: new Date(),
            severity: 'medium',
            eventId: 'wazuh-evt-002',
            sourceIp: '10.0.0.5',
            user: 'admin',
            description: 'Failed login attempt',
          },
        ],
      }

      prisma.huntSession.findFirst.mockResolvedValueOnce(sessionWithEvents)

      const result = await service.getRun(TENANT_ID, 'session-001')

      expect(result.id).toBe('session-001')
      expect(result.events).toHaveLength(2)
      expect(prisma.huntSession.findFirst).toHaveBeenCalledWith({
        where: { id: 'session-001', tenantId: TENANT_ID },
        include: { events: true },
      })
    })

    it('should throw 404 when session is not found', async () => {
      prisma.huntSession.findFirst.mockResolvedValueOnce(null)

      await expect(service.getRun(TENANT_ID, 'nonexistent-id')).rejects.toThrow(BusinessException)
      await expect(service.getRun(TENANT_ID, 'nonexistent-id')).rejects.toMatchObject({
        response: expect.objectContaining({ statusCode: 404 }),
      })
    })
  })

  /* ------------------------------------------------------------------ */
  /* getEvents                                                            */
  /* ------------------------------------------------------------------ */

  describe('getEvents', () => {
    it('should return paginated events', async () => {
      prisma.huntSession.findFirst.mockResolvedValueOnce({ id: 'session-001' })

      const events = [
        {
          id: 'event-001',
          huntSessionId: 'session-001',
          timestamp: new Date(),
          severity: 'critical',
          eventId: 'wazuh-evt-001',
          sourceIp: '192.168.1.100',
          user: 'root',
          description: 'SSH brute force detected',
        },
        {
          id: 'event-002',
          huntSessionId: 'session-001',
          timestamp: new Date(),
          severity: 'high',
          eventId: 'wazuh-evt-002',
          sourceIp: '10.0.0.5',
          user: 'admin',
          description: 'Privilege escalation attempt',
        },
      ]

      prisma.huntEvent.findMany.mockResolvedValueOnce(events)
      prisma.huntEvent.count.mockResolvedValueOnce(2)

      const result = await service.getEvents(TENANT_ID, 'session-001', 1, 10)

      expect(result.data).toHaveLength(2)
      expect(result.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 2,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      })

      expect(prisma.huntEvent.findMany).toHaveBeenCalledWith({
        where: { huntSessionId: 'session-001' },
        orderBy: { timestamp: 'desc' },
        skip: 0,
        take: 10,
      })
    })

    it('should throw 404 when session is not found', async () => {
      prisma.huntSession.findFirst.mockResolvedValueOnce(null)

      await expect(service.getEvents(TENANT_ID, 'nonexistent-session', 1, 10)).rejects.toThrow(
        BusinessException
      )

      await expect(
        service.getEvents(TENANT_ID, 'nonexistent-session', 1, 10)
      ).rejects.toMatchObject({
        response: expect.objectContaining({ statusCode: 404 }),
      })
    })

    it('should handle pagination for page 2 of events', async () => {
      prisma.huntSession.findFirst.mockResolvedValueOnce({ id: 'session-001' })
      prisma.huntEvent.findMany.mockResolvedValueOnce([
        {
          id: 'event-011',
          huntSessionId: 'session-001',
          timestamp: new Date(),
          severity: 'low',
          eventId: 'wazuh-evt-011',
          sourceIp: null,
          user: null,
          description: 'Minor event',
        },
      ])
      prisma.huntEvent.count.mockResolvedValueOnce(25)

      const result = await service.getEvents(TENANT_ID, 'session-001', 2, 10)

      expect(result.pagination).toEqual({
        page: 2,
        limit: 10,
        total: 25,
        totalPages: 3,
        hasNext: true,
        hasPrev: true,
      })

      expect(prisma.huntEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        })
      )
    })

    it('should return empty data when no events exist for session', async () => {
      prisma.huntSession.findFirst.mockResolvedValueOnce({ id: 'session-001' })
      prisma.huntEvent.findMany.mockResolvedValueOnce([])
      prisma.huntEvent.count.mockResolvedValueOnce(0)

      const result = await service.getEvents(TENANT_ID, 'session-001', 1, 10)

      expect(result.data).toEqual([])
      expect(result.pagination.total).toBe(0)
    })
  })
})
