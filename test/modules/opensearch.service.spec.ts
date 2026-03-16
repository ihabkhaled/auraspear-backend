import { connectorFetch, basicAuth } from '../../src/common/utils/connector-http.utility'
import { OpenSearchService } from '../../src/modules/connectors/services/opensearch.service'

jest.mock('../../src/common/utils/connector-http.utility')

const mockedConnectorFetch = connectorFetch as jest.MockedFunction<typeof connectorFetch>
const mockedBasicAuth = basicAuth as jest.MockedFunction<typeof basicAuth>

const mockAppLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

function createService(): OpenSearchService {
  return new OpenSearchService(mockAppLogger as never)
}

function buildConnectorResponse(overrides: {
  status?: number
  data?: unknown
  headers?: Record<string, string>
  latencyMs?: number
}) {
  return {
    status: overrides.status ?? 200,
    data: overrides.data ?? {},
    headers: overrides.headers ?? {},
    latencyMs: overrides.latencyMs ?? 28,
  }
}

const VALID_CONFIG: Record<string, unknown> = {
  baseUrl: 'https://opensearch.local:9200',
  username: 'admin',
  password: 'os-secret',
  verifyTls: true,
}

describe('OpenSearchService', () => {
  let service: OpenSearchService

  beforeEach(() => {
    jest.clearAllMocks()
    service = createService()
    mockedBasicAuth.mockReturnValue('Basic bW9jay1hdXRo')
  })

  /* ------------------------------------------------------------------ */
  /* testConnection                                                       */
  /* ------------------------------------------------------------------ */

  describe('testConnection', () => {
    it('should return ok: true with cluster health details', async () => {
      mockedConnectorFetch.mockResolvedValueOnce(
        buildConnectorResponse({
          data: {
            cluster_name: 'auraspear-cluster',
            status: 'green',
            number_of_nodes: 3,
          },
        })
      )

      const result = await service.testConnection(VALID_CONFIG)

      expect(result.ok).toBe(true)
      expect(result.details).toContain('auraspear-cluster')
      expect(result.details).toContain('green')
      expect(result.details).toContain('3')
      expect(mockedConnectorFetch).toHaveBeenCalledWith(
        'https://opensearch.local:9200/_cluster/health',
        expect.objectContaining({
          allowPrivateNetwork: true,
        })
      )
      expect(mockAppLogger.info).toHaveBeenCalled()
    })

    it('should return ok: false when baseUrl is missing', async () => {
      const config = { username: 'admin', password: 'secret' }

      const result = await service.testConnection(config)

      expect(result.ok).toBe(false)
      expect(result.details).toBe('OpenSearch base URL not configured')
      expect(mockedConnectorFetch).not.toHaveBeenCalled()
    })

    it('should return ok: false when cluster health returns non-200', async () => {
      mockedConnectorFetch.mockResolvedValueOnce(buildConnectorResponse({ status: 401, data: {} }))

      const result = await service.testConnection(VALID_CONFIG)

      expect(result.ok).toBe(false)
      expect(result.details).toContain('401')
    })

    it('should return ok: false when connectorFetch throws', async () => {
      mockedConnectorFetch.mockRejectedValueOnce(new Error('SSL handshake failed'))

      const result = await service.testConnection(VALID_CONFIG)

      expect(result.ok).toBe(false)
      expect(result.details).toBe('SSL handshake failed')
      expect(mockAppLogger.error).toHaveBeenCalled()
    })

    it('should handle non-Error thrown values', async () => {
      mockedConnectorFetch.mockRejectedValueOnce(42)

      const result = await service.testConnection(VALID_CONFIG)

      expect(result.ok).toBe(false)
      expect(result.details).toBe('Connection failed')
    })

    it('should work without credentials (anonymous access)', async () => {
      const config = { baseUrl: 'https://opensearch.local:9200' }
      mockedConnectorFetch.mockResolvedValueOnce(
        buildConnectorResponse({
          data: {
            cluster_name: 'open-cluster',
            status: 'yellow',
            number_of_nodes: 1,
          },
        })
      )

      const result = await service.testConnection(config)

      expect(result.ok).toBe(true)
      expect(mockedBasicAuth).not.toHaveBeenCalled()
      expect(mockedConnectorFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          headers: {},
        })
      )
    })

    it('should include Authorization header when credentials are provided', async () => {
      mockedConnectorFetch.mockResolvedValueOnce(
        buildConnectorResponse({
          data: { cluster_name: 'test', status: 'green', number_of_nodes: 1 },
        })
      )

      await service.testConnection(VALID_CONFIG)

      expect(mockedBasicAuth).toHaveBeenCalledWith('admin', 'os-secret')
      expect(mockedConnectorFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          headers: { Authorization: 'Basic bW9jay1hdXRo' },
        })
      )
    })

    it('should pass verifyTls config to rejectUnauthorized', async () => {
      const config = { ...VALID_CONFIG, verifyTls: false }
      mockedConnectorFetch.mockResolvedValueOnce(
        buildConnectorResponse({
          data: { cluster_name: 'test', status: 'green', number_of_nodes: 1 },
        })
      )

      await service.testConnection(config)

      expect(mockedConnectorFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ rejectUnauthorized: false })
      )
    })
  })

  /* ------------------------------------------------------------------ */
  /* search                                                               */
  /* ------------------------------------------------------------------ */

  describe('search', () => {
    const index = 'logs-2024-*'
    const dslQuery = { query: { match_all: {} }, size: 25 }

    it('should return hits and total with object total (ES 7+ format)', async () => {
      const hitItems = [
        { _id: 'doc-1', _source: { message: 'login success' } },
        { _id: 'doc-2', _source: { message: 'login failed' } },
        { _id: 'doc-3', _source: { message: 'logout' } },
      ]
      mockedConnectorFetch.mockResolvedValueOnce(
        buildConnectorResponse({
          data: {
            hits: {
              total: { value: 150, relation: 'eq' },
              hits: hitItems,
            },
          },
        })
      )

      const result = await service.search(VALID_CONFIG, index, dslQuery)

      expect(result.total).toBe(150)
      expect(result.hits).toHaveLength(3)
      expect(result.hits[0]).toEqual(hitItems[0])
      expect(mockedConnectorFetch).toHaveBeenCalledWith(
        'https://opensearch.local:9200/logs-2024-*/_search',
        expect.objectContaining({
          method: 'POST',
          body: dslQuery,
          allowPrivateNetwork: true,
        })
      )
      expect(mockAppLogger.info).toHaveBeenCalled()
    })

    it('should handle numeric total (ES 6 format)', async () => {
      mockedConnectorFetch.mockResolvedValueOnce(
        buildConnectorResponse({
          data: {
            hits: {
              total: 500,
              hits: [{ _id: '1' }],
            },
          },
        })
      )

      const result = await service.search(VALID_CONFIG, index, dslQuery)

      expect(result.total).toBe(500)
      expect(result.hits).toHaveLength(1)
    })

    it('should return empty hits when hits.hits is absent', async () => {
      mockedConnectorFetch.mockResolvedValueOnce(
        buildConnectorResponse({
          data: {
            hits: {
              total: { value: 0 },
            },
          },
        })
      )

      const result = await service.search(VALID_CONFIG, index, dslQuery)

      expect(result.hits).toHaveLength(0)
      expect(result.total).toBe(0)
    })

    it('should throw when search returns non-200 status', async () => {
      mockedConnectorFetch.mockResolvedValueOnce(
        buildConnectorResponse({ status: 400, data: { error: 'parsing_exception' } })
      )

      await expect(service.search(VALID_CONFIG, index, dslQuery)).rejects.toThrow(
        'OpenSearch search failed: status 400'
      )
      expect(mockAppLogger.warn).toHaveBeenCalled()
    })

    it('should throw on 500 server error', async () => {
      mockedConnectorFetch.mockResolvedValueOnce(buildConnectorResponse({ status: 500, data: {} }))

      await expect(service.search(VALID_CONFIG, index, dslQuery)).rejects.toThrow(
        'OpenSearch search failed: status 500'
      )
    })

    it('should propagate connectorFetch errors', async () => {
      mockedConnectorFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))

      await expect(service.search(VALID_CONFIG, index, dslQuery)).rejects.toThrow('ECONNREFUSED')
    })

    it('should work without credentials (anonymous access)', async () => {
      const config = { baseUrl: 'https://opensearch.local:9200' }
      mockedConnectorFetch.mockResolvedValueOnce(
        buildConnectorResponse({
          data: {
            hits: {
              total: { value: 0 },
              hits: [],
            },
          },
        })
      )

      await service.search(config, index, dslQuery)

      expect(mockedBasicAuth).not.toHaveBeenCalled()
      expect(mockedConnectorFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          headers: {},
        })
      )
    })

    it('should include Authorization header when credentials are provided', async () => {
      mockedConnectorFetch.mockResolvedValueOnce(
        buildConnectorResponse({
          data: {
            hits: { total: { value: 0 }, hits: [] },
          },
        })
      )

      await service.search(VALID_CONFIG, index, dslQuery)

      expect(mockedBasicAuth).toHaveBeenCalledWith('admin', 'os-secret')
    })

    it('should pass verifyTls config to rejectUnauthorized', async () => {
      const config = { ...VALID_CONFIG, verifyTls: false }
      mockedConnectorFetch.mockResolvedValueOnce(
        buildConnectorResponse({
          data: { hits: { total: { value: 0 }, hits: [] } },
        })
      )

      await service.search(config, index, dslQuery)

      expect(mockedConnectorFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ rejectUnauthorized: false })
      )
    })

    it('should construct the correct URL with index name', async () => {
      mockedConnectorFetch.mockResolvedValueOnce(
        buildConnectorResponse({
          data: { hits: { total: { value: 0 }, hits: [] } },
        })
      )

      await service.search(VALID_CONFIG, 'my-custom-index', dslQuery)

      expect(mockedConnectorFetch).toHaveBeenCalledWith(
        'https://opensearch.local:9200/my-custom-index/_search',
        expect.objectContaining({})
      )
    })

    it('should pass the query body to connectorFetch', async () => {
      const complexQuery = {
        query: {
          bool: {
            must: [{ match: { level: 'error' } }],
            filter: [{ range: { '@timestamp': { gte: 'now-1h' } } }],
          },
        },
        size: 50,
        sort: [{ '@timestamp': { order: 'desc' } }],
      }
      mockedConnectorFetch.mockResolvedValueOnce(
        buildConnectorResponse({
          data: { hits: { total: { value: 10 }, hits: [] } },
        })
      )

      await service.search(VALID_CONFIG, index, complexQuery)

      expect(mockedConnectorFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ body: complexQuery })
      )
    })
  })
})
