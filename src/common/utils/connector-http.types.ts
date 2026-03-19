import type { HttpMethod } from '../enums'

export interface ConnectorHttpOptions {
  method?: HttpMethod
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
  rejectUnauthorized?: boolean
  allowPrivateNetwork?: boolean
  clientCert?: string
  clientKey?: string
  caCert?: string
}

export interface ConnectorHttpResponse {
  status: number
  data: unknown
  headers: Record<string, string>
  latencyMs: number
}
