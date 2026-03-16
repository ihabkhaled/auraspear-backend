import { connectorFetch } from '../../src/common/utils/connector-http.utility'
import { MispService } from '../../src/modules/connectors/services/misp.service'

jest.mock('../../src/common/utils/connector-http.utility')

const mockedConnectorFetch = connectorFetch as jest.MockedFunction<typeof connectorFetch>

const mockAppLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

function createService(): MispService {
  return new MispService(mockAppLogger as never)
}

const VALID_CONFIG: Record<string, unknown> = {
  mispUrl: 'https://misp.local',
  authKey: 'test-auth-key-123',
  verifyTls: true,
}

describe('MispService', () => {
  let service: MispService

  beforeEach(() => {
    jest.clearAllMocks()
    service = createService()
  })

  /* ------------------------------------------------------------------ */
  /* testConnection                                                      */
  /* ------------------------------------------------------------------ */

  describe('testConnection', () => {
    it('should return ok: true when MISP is reachable', async () => {
      mockedConnectorFetch.mockResolvedValue({
        status: 200,
        data: { version: '2.4.178' },
        headers: {},
        latencyMs: 42,
      })

      const result = await service.testConnection(VALID_CONFIG)

      expect(result.ok).toBe(true)
      expect(result.details).toContain('MISP reachable')
      expect(result.details).toContain('2.4.178')
      expect(mockedConnectorFetch).toHaveBeenCalledWith(
        'https://misp.local/servers/getPyMISPVersion.json',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'test-auth-key-123',
          }),
        })
      )
    })

    it('should return ok: true with unknown version when version is missing', async () => {
      mockedConnectorFetch.mockResolvedValue({
        status: 200,
        data: {},
        headers: {},
        latencyMs: 30,
      })

      const result = await service.testConnection(VALID_CONFIG)

      expect(result.ok).toBe(true)
      expect(result.details).toContain('unknown')
    })

    it('should accept baseUrl as alternative to mispUrl', async () => {
      mockedConnectorFetch.mockResolvedValue({
        status: 200,
        data: { version: '2.4.178' },
        headers: {},
        latencyMs: 10,
      })

      const config = { baseUrl: 'https://misp-alt.local', authKey: 'key' }
      const result = await service.testConnection(config)

      expect(result.ok).toBe(true)
      expect(mockedConnectorFetch).toHaveBeenCalledWith(
        'https://misp-alt.local/servers/getPyMISPVersion.json',
        expect.objectContaining({})
      )
    })

    it('should accept apiKey as alternative to authKey', async () => {
      mockedConnectorFetch.mockResolvedValue({
        status: 200,
        data: { version: '2.4.178' },
        headers: {},
        latencyMs: 10,
      })

      const config = { mispUrl: 'https://misp.local', apiKey: 'alt-key' }
      const result = await service.testConnection(config)

      expect(result.ok).toBe(true)
      expect(mockedConnectorFetch).toHaveBeenCalledWith(
        expect.stringContaining('misp.local'),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'alt-key' }),
        })
      )
    })

    it('should return error when MISP URL is not configured', async () => {
      const result = await service.testConnection({})

      expect(result.ok).toBe(false)
      expect(result.details).toBe('MISP URL not configured')
      expect(mockedConnectorFetch).not.toHaveBeenCalled()
    })

    it('should return error when auth key is not configured', async () => {
      const result = await service.testConnection({ mispUrl: 'https://misp.local' })

      expect(result.ok).toBe(false)
      expect(result.details).toBe('MISP auth key not configured')
      expect(mockedConnectorFetch).not.toHaveBeenCalled()
    })

    it('should return error when MISP returns non-200 status', async () => {
      mockedConnectorFetch.mockResolvedValue({
        status: 403,
        data: { error: 'Forbidden' },
        headers: {},
        latencyMs: 20,
      })

      const result = await service.testConnection(VALID_CONFIG)

      expect(result.ok).toBe(false)
      expect(result.details).toBe('MISP returned status 403')
    })

    it('should handle network errors gracefully', async () => {
      mockedConnectorFetch.mockRejectedValue(new Error('ECONNREFUSED'))

      const result = await service.testConnection(VALID_CONFIG)

      expect(result.ok).toBe(false)
      expect(result.details).toBe('ECONNREFUSED')
      expect(mockAppLogger.error).toHaveBeenCalled()
    })

    it('should handle non-Error thrown values', async () => {
      mockedConnectorFetch.mockRejectedValue('string error')

      const result = await service.testConnection(VALID_CONFIG)

      expect(result.ok).toBe(false)
      expect(result.details).toBe('Connection failed')
    })

    it('should log success on successful connection', async () => {
      mockedConnectorFetch.mockResolvedValue({
        status: 200,
        data: { version: '2.4.178' },
        headers: {},
        latencyMs: 10,
      })

      await service.testConnection(VALID_CONFIG)

      expect(mockAppLogger.info).toHaveBeenCalledWith(
        'MISP connection test succeeded',
        expect.objectContaining({
          metadata: expect.objectContaining({
            connectorType: 'misp',
            version: '2.4.178',
          }),
        })
      )
    })

    it('should log error on failed connection', async () => {
      mockedConnectorFetch.mockRejectedValue(new Error('timeout'))

      await service.testConnection(VALID_CONFIG)

      expect(mockAppLogger.error).toHaveBeenCalledWith(
        'MISP connection test failed',
        expect.objectContaining({
          metadata: expect.objectContaining({ connectorType: 'misp' }),
        })
      )
    })

    it('should pass verifyTls option correctly', async () => {
      mockedConnectorFetch.mockResolvedValue({
        status: 200,
        data: { version: '2.4.178' },
        headers: {},
        latencyMs: 10,
      })

      await service.testConnection({ ...VALID_CONFIG, verifyTls: false })

      expect(mockedConnectorFetch).toHaveBeenCalledWith(
        expect.stringContaining('misp.local'),
        expect.objectContaining({ rejectUnauthorized: false })
      )
    })
  })

  /* ------------------------------------------------------------------ */
  /* getEvents                                                           */
  /* ------------------------------------------------------------------ */

  describe('getEvents', () => {
    it('should return events with default limit', async () => {
      const mockEvents = [
        { id: 1, info: 'Event 1' },
        { id: 2, info: 'Event 2' },
      ]
      mockedConnectorFetch.mockResolvedValue({
        status: 200,
        data: mockEvents,
        headers: {},
        latencyMs: 50,
      })

      const events = await service.getEvents(VALID_CONFIG)

      expect(events).toEqual(mockEvents)
      expect(mockedConnectorFetch).toHaveBeenCalledWith(
        'https://misp.local/events/index?limit=20&sort=date&direction=desc',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'test-auth-key-123' }),
        })
      )
    })

    it('should accept a custom limit', async () => {
      mockedConnectorFetch.mockResolvedValue({
        status: 200,
        data: [],
        headers: {},
        latencyMs: 10,
      })

      await service.getEvents(VALID_CONFIG, 50)

      expect(mockedConnectorFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=50'),
        expect.objectContaining({})
      )
    })

    it('should throw when status is not 200', async () => {
      mockedConnectorFetch.mockResolvedValue({
        status: 500,
        data: { error: 'Internal' },
        headers: {},
        latencyMs: 10,
      })

      await expect(service.getEvents(VALID_CONFIG)).rejects.toThrow(
        'MISP events fetch failed: status 500'
      )
      expect(mockAppLogger.warn).toHaveBeenCalled()
    })

    it('should return empty array when data is null', async () => {
      mockedConnectorFetch.mockResolvedValue({
        status: 200,
        data: null,
        headers: {},
        latencyMs: 10,
      })

      const events = await service.getEvents(VALID_CONFIG)

      expect(events).toEqual([])
    })

    it('should log success after retrieving events', async () => {
      mockedConnectorFetch.mockResolvedValue({
        status: 200,
        data: [{ id: 1 }],
        headers: {},
        latencyMs: 10,
      })

      await service.getEvents(VALID_CONFIG, 10)

      expect(mockAppLogger.info).toHaveBeenCalledWith(
        'MISP events retrieved',
        expect.objectContaining({
          metadata: expect.objectContaining({ limit: 10, count: 1 }),
        })
      )
    })
  })

  /* ------------------------------------------------------------------ */
  /* searchAttributes                                                    */
  /* ------------------------------------------------------------------ */

  describe('searchAttributes', () => {
    it('should return attributes from search', async () => {
      const mockAttributes = [{ id: '1', value: '8.8.8.8', type: 'ip-dst' }]
      mockedConnectorFetch.mockResolvedValue({
        status: 200,
        data: { response: { Attribute: mockAttributes } },
        headers: {},
        latencyMs: 30,
      })

      const searchParameters = { value: '8.8.8.8', type: 'ip-dst' }
      const result = await service.searchAttributes(VALID_CONFIG, searchParameters)

      expect(result).toEqual(mockAttributes)
      expect(mockedConnectorFetch).toHaveBeenCalledWith(
        'https://misp.local/attributes/restSearch',
        expect.objectContaining({
          method: 'POST',
          body: searchParameters,
        })
      )
    })

    it('should return empty array when no attributes found', async () => {
      mockedConnectorFetch.mockResolvedValue({
        status: 200,
        data: { response: {} },
        headers: {},
        latencyMs: 10,
      })

      const result = await service.searchAttributes(VALID_CONFIG, { value: 'nonexistent' })

      expect(result).toEqual([])
    })

    it('should return empty array when response is missing', async () => {
      mockedConnectorFetch.mockResolvedValue({
        status: 200,
        data: {},
        headers: {},
        latencyMs: 10,
      })

      const result = await service.searchAttributes(VALID_CONFIG, { value: 'test' })

      expect(result).toEqual([])
    })

    it('should throw when status is not 200', async () => {
      mockedConnectorFetch.mockResolvedValue({
        status: 403,
        data: {},
        headers: {},
        latencyMs: 10,
      })

      await expect(service.searchAttributes(VALID_CONFIG, { value: 'test' })).rejects.toThrow(
        'MISP attribute search failed: status 403'
      )
      expect(mockAppLogger.warn).toHaveBeenCalled()
    })

    it('should log success after search', async () => {
      mockedConnectorFetch.mockResolvedValue({
        status: 200,
        data: { response: { Attribute: [{ id: '1' }, { id: '2' }] } },
        headers: {},
        latencyMs: 10,
      })

      await service.searchAttributes(VALID_CONFIG, { value: 'test' })

      expect(mockAppLogger.info).toHaveBeenCalledWith(
        'MISP attribute search executed',
        expect.objectContaining({
          metadata: expect.objectContaining({ resultCount: 2 }),
        })
      )
    })
  })

  /* ------------------------------------------------------------------ */
  /* getEvent                                                            */
  /* ------------------------------------------------------------------ */

  describe('getEvent', () => {
    it('should return a single event by ID', async () => {
      const mockEvent = { id: '123', info: 'Test Event' }
      mockedConnectorFetch.mockResolvedValue({
        status: 200,
        data: { Event: mockEvent },
        headers: {},
        latencyMs: 20,
      })

      const result = await service.getEvent(VALID_CONFIG, '123')

      expect(result).toEqual(mockEvent)
      expect(mockedConnectorFetch).toHaveBeenCalledWith(
        'https://misp.local/events/view/123',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'test-auth-key-123' }),
        })
      )
    })

    it('should return body when Event key is missing', async () => {
      const mockBody = { id: '456', info: 'Raw body' }
      mockedConnectorFetch.mockResolvedValue({
        status: 200,
        data: mockBody,
        headers: {},
        latencyMs: 10,
      })

      const result = await service.getEvent(VALID_CONFIG, '456')

      expect(result).toEqual(mockBody)
    })

    it('should throw on invalid event ID (non-numeric)', async () => {
      await expect(service.getEvent(VALID_CONFIG, 'abc')).rejects.toThrow('Invalid MISP event ID')
      expect(mockedConnectorFetch).not.toHaveBeenCalled()
    })

    it('should throw on event ID with path traversal', async () => {
      await expect(service.getEvent(VALID_CONFIG, '../etc/passwd')).rejects.toThrow(
        'Invalid MISP event ID'
      )
      expect(mockedConnectorFetch).not.toHaveBeenCalled()
    })

    it('should throw on event ID with special characters', async () => {
      await expect(service.getEvent(VALID_CONFIG, '123;drop')).rejects.toThrow(
        'Invalid MISP event ID'
      )
      expect(mockedConnectorFetch).not.toHaveBeenCalled()
    })

    it('should accept valid numeric event IDs', async () => {
      mockedConnectorFetch.mockResolvedValue({
        status: 200,
        data: { Event: { id: '99999' } },
        headers: {},
        latencyMs: 10,
      })

      const result = await service.getEvent(VALID_CONFIG, '99999')

      expect(result).toEqual({ id: '99999' })
    })

    it('should throw when status is not 200', async () => {
      mockedConnectorFetch.mockResolvedValue({
        status: 404,
        data: {},
        headers: {},
        latencyMs: 10,
      })

      await expect(service.getEvent(VALID_CONFIG, '123')).rejects.toThrow(
        'MISP event fetch failed: status 404'
      )
      expect(mockAppLogger.warn).toHaveBeenCalled()
    })

    it('should log warning for invalid event ID', async () => {
      try {
        await service.getEvent(VALID_CONFIG, 'invalid')
      } catch {
        // expected
      }

      expect(mockAppLogger.warn).toHaveBeenCalledWith(
        'Invalid MISP event ID provided',
        expect.objectContaining({
          metadata: expect.objectContaining({ eventId: 'invalid' }),
        })
      )
    })

    it('should log success after retrieving event', async () => {
      mockedConnectorFetch.mockResolvedValue({
        status: 200,
        data: { Event: { id: '1' } },
        headers: {},
        latencyMs: 10,
      })

      await service.getEvent(VALID_CONFIG, '1')

      expect(mockAppLogger.info).toHaveBeenCalledWith(
        'MISP event retrieved',
        expect.objectContaining({
          metadata: expect.objectContaining({ eventId: '1' }),
        })
      )
    })
  })
})
