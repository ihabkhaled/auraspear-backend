import { Injectable, Logger } from '@nestjs/common'
import { connectorFetch, basicAuth } from '../../../common/utils/connector-http.util'
import type { TestResult } from '../connectors.types'

@Injectable()
export class LogstashService {
  private readonly logger = new Logger(LogstashService.name)

  /**
   * Test Logstash connection via the Monitoring API.
   * GET / on the Logstash API port (default 9600) returns node info.
   * Auth is optional — Logstash API is unauthenticated by default,
   * but can be secured with basic auth via xpack.management.
   */
  async testConnection(config: Record<string, unknown>): Promise<TestResult> {
    const baseUrl = config.baseUrl as string | undefined
    if (!baseUrl) {
      return { ok: false, details: 'Logstash base URL not configured' }
    }

    try {
      const headers: Record<string, string> = {}
      const username = config.username as string | undefined
      const password = config.password as string | undefined
      if (username && password) {
        headers.Authorization = basicAuth(username, password)
      }

      const res = await connectorFetch(`${baseUrl}/`, {
        headers,
        rejectUnauthorized: config.verifyTls !== false,
        allowPrivateNetwork: true,
      })

      if (res.status !== 200) {
        return { ok: false, details: `Logstash returned status ${res.status}` }
      }

      const body = res.data as Record<string, unknown>
      const version = (body.version ?? 'unknown') as string
      const status = (body.status ?? 'unknown') as string

      return {
        ok: true,
        details: `Logstash reachable at ${baseUrl}. Version: ${version}. Status: ${status}.`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed'
      this.logger.warn(`Logstash connection test failed: ${message}`)
      return { ok: false, details: message }
    }
  }

  /**
   * Get pipeline stats from Logstash Monitoring API.
   * GET /_node/pipelines
   */
  async getPipelines(
    config: Record<string, unknown>
  ): Promise<{ pipelines: Record<string, unknown> }> {
    const baseUrl = config.baseUrl as string
    const headers: Record<string, string> = {}
    const username = config.username as string | undefined
    const password = config.password as string | undefined
    if (username && password) {
      headers.Authorization = basicAuth(username, password)
    }

    const res = await connectorFetch(`${baseUrl}/_node/pipelines`, {
      headers,
      rejectUnauthorized: config.verifyTls !== false,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      throw new Error(`Logstash pipelines request failed: status ${res.status}`)
    }

    const body = res.data as Record<string, unknown>
    return {
      pipelines: (body.pipelines ?? {}) as Record<string, unknown>,
    }
  }

  /**
   * Get pipeline stats (events in/out/filtered, queue info).
   * GET /_node/stats/pipelines
   */
  async getPipelineStats(
    config: Record<string, unknown>
  ): Promise<{ pipelines: Record<string, unknown> }> {
    const baseUrl = config.baseUrl as string
    const headers: Record<string, string> = {}
    const username = config.username as string | undefined
    const password = config.password as string | undefined
    if (username && password) {
      headers.Authorization = basicAuth(username, password)
    }

    const res = await connectorFetch(`${baseUrl}/_node/stats/pipelines`, {
      headers,
      rejectUnauthorized: config.verifyTls !== false,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      throw new Error(`Logstash pipeline stats request failed: status ${res.status}`)
    }

    const body = res.data as Record<string, unknown>
    return {
      pipelines: (body.pipelines ?? {}) as Record<string, unknown>,
    }
  }

  /**
   * Get hot threads from Logstash (useful for debugging performance).
   * GET /_node/hot_threads
   */
  async getHotThreads(config: Record<string, unknown>): Promise<unknown> {
    const baseUrl = config.baseUrl as string
    const headers: Record<string, string> = {}
    const username = config.username as string | undefined
    const password = config.password as string | undefined
    if (username && password) {
      headers.Authorization = basicAuth(username, password)
    }

    const res = await connectorFetch(`${baseUrl}/_node/hot_threads?human=true`, {
      headers,
      rejectUnauthorized: config.verifyTls !== false,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      throw new Error(`Logstash hot threads request failed: status ${res.status}`)
    }

    return res.data
  }
}
