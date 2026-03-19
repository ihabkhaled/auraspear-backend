export interface ConnectorResponse {
  type: string
  name: string
  enabled: boolean
  authType: string
  config: Record<string, unknown>
  lastTestAt: Date | null
  lastTestOk: boolean | null
  lastError: string | null
}

export interface ConnectorStats {
  totalConnectors: number
  enabledConnectors: number
  healthyConnectors: number
  failingConnectors: number
  untestedConnectors: number
}

/** Base test result returned by individual connector adapters. */
export interface TestResult {
  ok: boolean
  details: string
}

/** Extended test result returned by ConnectorsService.testConnection(). */
export interface ConnectorTestResult extends TestResult {
  type: string
  latencyMs: number
  testedAt: string
}

/** Parameters for the recursive scroll collection helper in WazuhService. */
export interface ScrollCollectionParameters {
  indexerUrl: string
  authHeader: string
  tlsOption: boolean
  scrollId: string | undefined
  allHits: unknown[]
  total: number
  maxEvents: number
}
