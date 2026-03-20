import type { AxiosRequestOptions } from '../../common/modules/axios'

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

export interface WazuhTokenCache {
  token: string
  expiresAt: number
}

export interface VelociraptorAuthOptions {
  headers: Record<string, string>
  httpOptions: Partial<AxiosRequestOptions>
}

/* ---------------------------------------------------------------- */
/* LLM APIs (OpenAI-compatible)                                      */
/* ---------------------------------------------------------------- */

export interface ChatCompletionMessage {
  role: string
  content: string
}

export interface ChatCompletionChoice {
  index: number
  message: ChatCompletionMessage
  finish_reason: string
}

export interface ChatCompletionUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface ChatCompletionResponse {
  id: string
  object: string
  choices: ChatCompletionChoice[]
  usage: ChatCompletionUsage
}

export interface ModelEntry {
  id: string
  object: string
}

export interface ModelsListResponse {
  data: ModelEntry[]
  object: string
}

/* ---------------------------------------------------------------- */
/* OpenClaw Gateway                                                  */
/* ---------------------------------------------------------------- */

export interface OpenClawTaskResult {
  text: string
  usage?: {
    input_tokens: number
    output_tokens: number
  }
}

export interface OpenClawTaskResponse {
  taskId: string
  status: string
  result?: OpenClawTaskResult
}

export interface OpenClawHealthResponse {
  status: string
  version?: string
}
