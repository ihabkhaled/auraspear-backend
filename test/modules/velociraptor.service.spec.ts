import { connectorFetch } from '../../src/common/utils/connector-http.util'
import { VelociraptorService } from '../../src/modules/connectors/services/velociraptor.service'

jest.mock('../../src/common/utils/connector-http.util')

const mockedConnectorFetch = connectorFetch as jest.MockedFunction<typeof connectorFetch>

const mockAppLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

function createService(): VelociraptorService {
  return new VelociraptorService(mockAppLogger as never)
}

const VALID_CONFIG: Record<string, unknown> = {
  baseUrl: 'https://velociraptor.local',
  apiKey: 'vr-api-key-xyz',
  verifyTls: true,
}

describe('VelociraptorService', () => {
  let service: VelociraptorService

  beforeEach(() => {
    jest.clearAllMocks()
    service = createService()
  })

  /* ------------------------------------------------------------------ */
  /* testConnection                                                      */
  /* ------------------------------------------------------------------ */

  describe('testConnection', () => {
    it('should return ok: true when Velociraptor is reachable', async () => {
      mockedConnectorFetch.mockResolvedValue({
        status: 200,
        data: { metadata: {} },
        headers: {},
        latencyMs: 25,
      })

      const result = await service.testConnection(VALID_CONFIG)

      expect(result.ok).toBe(true)
      expect(result.details).toContain('Velociraptor server reachable')
      expect(result.details).toContain('velociraptor.local')
      expect(mockedConnectorFetch).toHaveBeenCalledWith(
        'https://velociraptor.local/api/v1/GetServerMetadata',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Grpc-Metadata-authorization': 'Bearer vr-api-key-xyz',
          }),
        })
      )
    })

    it('should use gRPC auth header format', async () => {
      mockedConnectorFetch.mockResolvedValue({
        status: 200,
        data: {},
        headers: {},
        latencyMs: 10,
      })

      await service.testConnection(VALID_CONFIG)

      const callArguments = mockedConnectorFetch.mock.calls[0]
      const options = callArguments?.[1] as Record<string, unknown> | undefined
      const headers = options?.headers as Record<string, string> | undefined

      expect(headers?.['Grpc-Metadata-authorization']).toBe('Bearer vr-api-key-xyz')
    })

    it('should return error when base URL is not configured', async () => {
      const result = await service.testConnection({ apiKey: 'key' })

      expect(result.ok).toBe(false)
      expect(result.details).toBe('Velociraptor base URL not configured')
      expect(mockedConnectorFetch).not.toHaveBeenCalled()
    })

    it('should return error when API key is not configured', async () => {
      const result = await service.testConnection({ baseUrl: 'https://vr.local' })

      expect(result.ok).toBe(false)
      expect(result.details).toBe('Velociraptor API key not configured')
      expect(mockedConnectorFetch).not.toHaveBeenCalled()
    })

    it('should return error when Velociraptor returns non-200 status', async () => {
      mockedConnectorFetch.mockResolvedValue({
        status: 403,
        data: {},
        headers: {},
        latencyMs: 10,
      })

      const result = await service.testConnection(VALID_CONFIG)

      expect(result.ok).toBe(false)
      expect(result.details).toBe('Velociraptor returned status 403')
    })

    it('should handle network errors gracefully', async () => {
      mockedConnectorFetch.mockRejectedValue(new Error('self-signed certificate'))

      const result = await service.testConnection(VALID_CONFIG)

      expect(result.ok).toBe(false)
      expect(result.details).toBe('self-signed certificate')
      expect(mockAppLogger.error).toHaveBeenCalled()
    })

    it('should handle non-Error thrown values', async () => {
      mockedConnectorFetch.mockRejectedValue({ code: 'UNKNOWN' })

      const result = await service.testConnection(VALID_CONFIG)

      expect(result.ok).toBe(false)
      expect(result.details).toBe('Connection failed')
    })

    it('should log success on successful connection', async () => {
      mockedConnectorFetch.mockResolvedValue({
        status: 200,
        data: {},
        headers: {},
        latencyMs: 10,
      })

      await service.testConnection(VALID_CONFIG)

      expect(mockAppLogger.info).toHaveBeenCalledWith(
        'Velociraptor connection test succeeded',
        expect.objectContaining({
          metadata: expect.objectContaining({ connectorType: 'velociraptor' }),
        })
      )
    })

    it('should log error on failed connection', async () => {
      mockedConnectorFetch.mockRejectedValue(new Error('ETIMEDOUT'))

      await service.testConnection(VALID_CONFIG)

      expect(mockAppLogger.error).toHaveBeenCalledWith(
        'Velociraptor connection test failed',
        expect.objectContaining({
          metadata: expect.objectContaining({ connectorType: 'velociraptor' }),
          stackTrace: expect.stringContaining('ETIMEDOUT'),
        })
      )
    })

    it('should pass verifyTls option correctly', async () => {
      mockedConnectorFetch.mockResolvedValue({
        status: 200,
        data: {},
        headers: {},
        latencyMs: 10,
      })

      await service.testConnection({ ...VALID_CONFIG, verifyTls: false })

      expect(mockedConnectorFetch).toHaveBeenCalledWith(
        expect.stringContaining('velociraptor.local'),
        expect.objectContaining({ rejectUnauthorized: false })
      )
    })
  })

  /* ------------------------------------------------------------------ */
  /* runVQL                                                              */
  /* ------------------------------------------------------------------ */

  describe('runVQL', () => {
    it('should execute VQL query and return rows and columns', async () => {
      const mockRows = [{ ClientId: 'C.123', Hostname: 'server01' }]
      const mockColumns = ['ClientId', 'Hostname']
      mockedConnectorFetch.mockResolvedValue({
        status: 200,
        data: { rows: mockRows, columns: mockColumns },
        headers: {},
        latencyMs: 200,
      })

      const vql = 'SELECT * FROM clients()'
      const result = await service.runVQL(VALID_CONFIG, vql)

      expect(result.rows).toEqual(mockRows)
      expect(result.columns).toEqual(mockColumns)
      expect(mockedConnectorFetch).toHaveBeenCalledWith(
        'https://velociraptor.local/api/v1/CreateNotebook',
        expect.objectContaining({
          method: 'POST',
          body: { query: vql },
          headers: expect.objectContaining({
            'Grpc-Metadata-authorization': 'Bearer vr-api-key-xyz',
          }),
        })
      )
    })

    it('should return empty arrays when rows and columns are missing', async () => {
      mockedConnectorFetch.mockResolvedValue({
        status: 200,
        data: {},
        headers: {},
        latencyMs: 10,
      })

      const result = await service.runVQL(VALID_CONFIG, 'SELECT 1')

      expect(result.rows).toEqual([])
      expect(result.columns).toEqual([])
    })

    it('should throw when status is not 200', async () => {
      mockedConnectorFetch.mockResolvedValue({
        status: 400,
        data: { error: 'Bad query' },
        headers: {},
        latencyMs: 10,
      })

      await expect(service.runVQL(VALID_CONFIG, 'INVALID VQL')).rejects.toThrow(
        'VQL query failed: status 400'
      )
      expect(mockAppLogger.warn).toHaveBeenCalled()
    })

    it('should log success after VQL execution', async () => {
      mockedConnectorFetch.mockResolvedValue({
        status: 200,
        data: { rows: [{ a: 1 }, { a: 2 }], columns: ['a'] },
        headers: {},
        latencyMs: 10,
      })

      await service.runVQL(VALID_CONFIG, 'SELECT a FROM test()')

      expect(mockAppLogger.info).toHaveBeenCalledWith(
        'Velociraptor VQL query executed',
        expect.objectContaining({
          metadata: expect.objectContaining({ rowCount: 2, columnCount: 1 }),
        })
      )
    })

    it('should use gRPC auth header for VQL queries', async () => {
      mockedConnectorFetch.mockResolvedValue({
        status: 200,
        data: { rows: [], columns: [] },
        headers: {},
        latencyMs: 10,
      })

      await service.runVQL(VALID_CONFIG, 'SELECT 1')

      const callArguments = mockedConnectorFetch.mock.calls[0]
      const options = callArguments?.[1] as Record<string, unknown> | undefined
      const headers = options?.headers as Record<string, string> | undefined

      expect(headers?.['Grpc-Metadata-authorization']).toBe('Bearer vr-api-key-xyz')
    })
  })

  /* ------------------------------------------------------------------ */
  /* getClients                                                          */
  /* ------------------------------------------------------------------ */

  describe('getClients', () => {
    it('should return clients from Velociraptor', async () => {
      const mockClients = [
        { client_id: 'C.123', os_info: { hostname: 'server01' } },
        { client_id: 'C.456', os_info: { hostname: 'server02' } },
      ]
      mockedConnectorFetch.mockResolvedValue({
        status: 200,
        data: { items: mockClients },
        headers: {},
        latencyMs: 80,
      })

      const clients = await service.getClients(VALID_CONFIG)

      expect(clients).toEqual(mockClients)
      expect(mockedConnectorFetch).toHaveBeenCalledWith(
        'https://velociraptor.local/api/v1/SearchClients?query=all&limit=500',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Grpc-Metadata-authorization': 'Bearer vr-api-key-xyz',
          }),
        })
      )
    })

    it('should return empty array when items key is missing', async () => {
      mockedConnectorFetch.mockResolvedValue({
        status: 200,
        data: {},
        headers: {},
        latencyMs: 10,
      })

      const clients = await service.getClients(VALID_CONFIG)

      expect(clients).toEqual([])
    })

    it('should throw when status is not 200', async () => {
      mockedConnectorFetch.mockResolvedValue({
        status: 503,
        data: {},
        headers: {},
        latencyMs: 10,
      })

      await expect(service.getClients(VALID_CONFIG)).rejects.toThrow(
        'Failed to fetch clients: status 503'
      )
      expect(mockAppLogger.warn).toHaveBeenCalled()
    })

    it('should log success after retrieving clients', async () => {
      mockedConnectorFetch.mockResolvedValue({
        status: 200,
        data: { items: [{ client_id: 'C.1' }] },
        headers: {},
        latencyMs: 10,
      })

      await service.getClients(VALID_CONFIG)

      expect(mockAppLogger.info).toHaveBeenCalledWith(
        'Velociraptor clients retrieved',
        expect.objectContaining({
          metadata: expect.objectContaining({ count: 1 }),
        })
      )
    })

    it('should use gRPC auth header for client queries', async () => {
      mockedConnectorFetch.mockResolvedValue({
        status: 200,
        data: { items: [] },
        headers: {},
        latencyMs: 10,
      })

      await service.getClients(VALID_CONFIG)

      const callArguments = mockedConnectorFetch.mock.calls[0]
      const options = callArguments?.[1] as Record<string, unknown> | undefined
      const headers = options?.headers as Record<string, string> | undefined

      expect(headers?.['Grpc-Metadata-authorization']).toBe('Bearer vr-api-key-xyz')
    })
  })
})
