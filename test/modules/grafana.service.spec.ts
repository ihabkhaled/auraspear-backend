import { connectorFetch, basicAuth } from '../../src/common/utils/connector-http.util'
import { GrafanaService } from '../../src/modules/connectors/services/grafana.service'
import type { ConnectorHttpResponse } from '../../src/common/utils/connector-http.util'

jest.mock('../../src/common/utils/connector-http.util')

const mockedConnectorFetch = connectorFetch as jest.MockedFunction<typeof connectorFetch>
const mockedBasicAuth = basicAuth as jest.MockedFunction<typeof basicAuth>

const mockAppLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

function createService(): GrafanaService {
  return new GrafanaService(mockAppLogger as never)
}

function buildResponse(overrides: Partial<ConnectorHttpResponse> = {}): ConnectorHttpResponse {
  return {
    status: 200,
    data: {},
    headers: {},
    latencyMs: 42,
    ...overrides,
  }
}

describe('GrafanaService', () => {
  let service: GrafanaService

  beforeEach(() => {
    jest.clearAllMocks()
    mockedBasicAuth.mockImplementation(
      (username: string, password: string) =>
        `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
    )
    service = createService()
  })

  /* ------------------------------------------------------------------ */
  /* testConnection                                                       */
  /* ------------------------------------------------------------------ */

  describe('testConnection', () => {
    it('should return ok: true with version when health endpoint succeeds', async () => {
      mockedConnectorFetch.mockResolvedValue(
        buildResponse({
          status: 200,
          data: { version: '10.2.3', database: 'ok', commit: 'abc123' },
        })
      )

      const result = await service.testConnection({
        baseUrl: 'https://grafana.local:3000',
        apiKey: 'glsa_secret',
      })

      expect(result.ok).toBe(true)
      expect(result.details).toContain('Grafana v10.2.3')
      expect(result.details).toContain('https://grafana.local:3000')
      expect(result.details).toContain('ok')
      expect(mockedConnectorFetch).toHaveBeenCalledWith(
        'https://grafana.local:3000/api/health',
        expect.objectContaining({
          headers: { Authorization: 'Bearer glsa_secret' },
          allowPrivateNetwork: true,
        })
      )
      expect(mockAppLogger.info).toHaveBeenCalled()
    })

    it('should return ok: false when baseUrl is missing', async () => {
      const result = await service.testConnection({})

      expect(result.ok).toBe(false)
      expect(result.details).toBe('Grafana base URL not configured')
      expect(mockedConnectorFetch).not.toHaveBeenCalled()
    })

    it('should return ok: false when health endpoint returns non-200', async () => {
      mockedConnectorFetch.mockResolvedValue(buildResponse({ status: 503 }))

      const result = await service.testConnection({
        baseUrl: 'https://grafana.local',
      })

      expect(result.ok).toBe(false)
      expect(result.details).toBe('Grafana returned status 503')
    })

    it('should return ok: false when connectorFetch throws', async () => {
      mockedConnectorFetch.mockRejectedValue(new Error('ECONNREFUSED'))

      const result = await service.testConnection({
        baseUrl: 'https://grafana.local',
      })

      expect(result.ok).toBe(false)
      expect(result.details).toBe('ECONNREFUSED')
      expect(mockAppLogger.error).toHaveBeenCalled()
    })

    it('should return "Connection failed" when non-Error is thrown', async () => {
      mockedConnectorFetch.mockRejectedValue('string error')

      const result = await service.testConnection({
        baseUrl: 'https://grafana.local',
      })

      expect(result.ok).toBe(false)
      expect(result.details).toBe('Connection failed')
    })

    it('should use "unknown" version when health data has no version field', async () => {
      mockedConnectorFetch.mockResolvedValue(
        buildResponse({ status: 200, data: { database: 'ok' } })
      )

      const result = await service.testConnection({
        baseUrl: 'https://grafana.local',
      })

      expect(result.ok).toBe(true)
      expect(result.details).toContain('Grafana vunknown')
    })

    it('should respect verifyTls setting', async () => {
      mockedConnectorFetch.mockResolvedValue(
        buildResponse({ status: 200, data: { version: '10.0.0' } })
      )

      await service.testConnection({
        baseUrl: 'https://grafana.local',
        verifyTls: false,
      })

      expect(mockedConnectorFetch).toHaveBeenCalledWith(
        'https://grafana.local/api/health',
        expect.objectContaining({
          rejectUnauthorized: false,
        })
      )
    })

    /* ---------------------------------------------------------------- */
    /* Auth priority: apiKey > basic > none                              */
    /* ---------------------------------------------------------------- */

    it('should prioritize apiKey over basic auth credentials', async () => {
      mockedConnectorFetch.mockResolvedValue(
        buildResponse({ status: 200, data: { version: '10.0.0' } })
      )

      await service.testConnection({
        baseUrl: 'https://grafana.local',
        apiKey: 'glsa_mykey',
        username: 'admin',
        password: 'admin',
      })

      expect(mockedConnectorFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/health'),
        expect.objectContaining({
          headers: { Authorization: 'Bearer glsa_mykey' },
        })
      )
    })

    it('should use basic auth when apiKey is absent but username/password provided', async () => {
      mockedConnectorFetch.mockResolvedValue(
        buildResponse({ status: 200, data: { version: '10.0.0' } })
      )

      await service.testConnection({
        baseUrl: 'https://grafana.local',
        username: 'admin',
        password: 'admin',
      })

      const expectedBasic = `Basic ${Buffer.from('admin:admin').toString('base64')}`
      expect(mockedConnectorFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/health'),
        expect.objectContaining({
          headers: { Authorization: expectedBasic },
        })
      )
    })

    it('should send no auth headers when neither apiKey nor credentials provided', async () => {
      mockedConnectorFetch.mockResolvedValue(
        buildResponse({ status: 200, data: { version: '10.0.0' } })
      )

      await service.testConnection({
        baseUrl: 'https://grafana.local',
      })

      expect(mockedConnectorFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/health'),
        expect.objectContaining({
          headers: {},
        })
      )
    })
  })

  /* ------------------------------------------------------------------ */
  /* getDashboards                                                        */
  /* ------------------------------------------------------------------ */

  describe('getDashboards', () => {
    it('should return dashboards array on success', async () => {
      const dashboards = [
        { id: 1, uid: 'abc', title: 'System Overview', type: 'dash-db' },
        { id: 2, uid: 'def', title: 'Network Stats', type: 'dash-db' },
      ]
      mockedConnectorFetch.mockResolvedValue(buildResponse({ status: 200, data: dashboards }))

      const result = await service.getDashboards({
        baseUrl: 'https://grafana.local',
        apiKey: 'glsa_secret',
      })

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual(dashboards[0])
      expect(result[1]).toEqual(dashboards[1])
      expect(mockedConnectorFetch).toHaveBeenCalledWith(
        'https://grafana.local/api/search?type=dash-db',
        expect.objectContaining({
          headers: { Authorization: 'Bearer glsa_secret' },
          allowPrivateNetwork: true,
        })
      )
      expect(mockAppLogger.info).toHaveBeenCalled()
    })

    it('should return empty array when data is null', async () => {
      mockedConnectorFetch.mockResolvedValue(buildResponse({ status: 200, data: null }))

      const result = await service.getDashboards({
        baseUrl: 'https://grafana.local',
        apiKey: 'key',
      })

      expect(result).toEqual([])
    })

    it('should throw when API returns non-200 status', async () => {
      mockedConnectorFetch.mockResolvedValue(buildResponse({ status: 401 }))

      await expect(
        service.getDashboards({
          baseUrl: 'https://grafana.local',
          apiKey: 'bad-key',
        })
      ).rejects.toThrow('Failed to fetch dashboards: status 401')

      expect(mockAppLogger.warn).toHaveBeenCalled()
    })

    it('should throw when connectorFetch rejects', async () => {
      mockedConnectorFetch.mockRejectedValue(new Error('Network error'))

      await expect(
        service.getDashboards({
          baseUrl: 'https://grafana.local',
          apiKey: 'key',
        })
      ).rejects.toThrow('Network error')
    })

    it('should use basic auth for getDashboards when apiKey absent', async () => {
      mockedConnectorFetch.mockResolvedValue(buildResponse({ status: 200, data: [] }))

      await service.getDashboards({
        baseUrl: 'https://grafana.local',
        username: 'viewer',
        password: 'pass',
      })

      const expectedBasic = `Basic ${Buffer.from('viewer:pass').toString('base64')}`
      expect(mockedConnectorFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/search'),
        expect.objectContaining({
          headers: { Authorization: expectedBasic },
        })
      )
    })
  })
})
