import { Injectable, Logger } from '@nestjs/common'
import { connectorFetch } from '../../../common/utils/connector-http.util'
import type { TestResult } from '../connectors.types'

@Injectable()
export class ShuffleService {
  private readonly logger = new Logger(ShuffleService.name)

  /**
   * Test Shuffle SOAR connection.
   * GET /api/v1/apps/authentication with bearer token.
   */
  async testConnection(config: Record<string, unknown>): Promise<TestResult> {
    const baseUrl = (config.webhookUrl ?? config.baseUrl) as string | undefined
    if (!baseUrl) {
      return { ok: false, details: 'Shuffle URL not configured' }
    }

    const apiKey = config.apiKey as string | undefined
    if (!apiKey) {
      return { ok: false, details: 'Shuffle API key not configured' }
    }

    try {
      const res = await connectorFetch(`${baseUrl}/api/v1/apps/authentication`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        rejectUnauthorized: config.verifyTls !== false,
      })

      if (res.status !== 200) {
        return { ok: false, details: `Shuffle returned status ${res.status}` }
      }

      return {
        ok: true,
        details: `Shuffle SOAR reachable at ${baseUrl}.`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed'
      this.logger.warn(`Shuffle connection test failed: ${message}`)
      return { ok: false, details: message }
    }
  }

  /**
   * Get available workflows from Shuffle.
   */
  async getWorkflows(config: Record<string, unknown>): Promise<unknown[]> {
    const baseUrl = (config.webhookUrl ?? config.baseUrl) as string
    const apiKey = config.apiKey as string

    const res = await connectorFetch(`${baseUrl}/api/v1/workflows`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      rejectUnauthorized: config.verifyTls !== false,
    })

    if (res.status !== 200) {
      throw new Error(`Failed to fetch workflows: status ${res.status}`)
    }

    return (res.data ?? []) as unknown[]
  }

  /**
   * Execute a workflow in Shuffle.
   */
  async executeWorkflow(
    config: Record<string, unknown>,
    workflowId: string,
    data: Record<string, unknown> = {}
  ): Promise<{ executionId: string }> {
    const baseUrl = (config.webhookUrl ?? config.baseUrl) as string
    const apiKey = config.apiKey as string

    // Validate workflowId to prevent path traversal
    if (!/^[\da-f-]+$/i.test(workflowId)) {
      throw new Error('Invalid workflow ID')
    }

    const res = await connectorFetch(`${baseUrl}/api/v1/workflows/${workflowId}/execute`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: data,
      rejectUnauthorized: config.verifyTls !== false,
    })

    if (res.status !== 200) {
      throw new Error(`Workflow execution failed: status ${res.status}`)
    }

    const body = res.data as Record<string, unknown>
    return { executionId: (body.execution_id ?? body.id ?? 'unknown') as string }
  }
}
