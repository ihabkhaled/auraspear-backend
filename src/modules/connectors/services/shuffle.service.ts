import { Injectable, Logger } from '@nestjs/common'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../../common/enums'
import { AppLoggerService } from '../../../common/services/app-logger.service'
import { connectorFetch } from '../../../common/utils/connector-http.util'
import type { TestResult } from '../connectors.types'

@Injectable()
export class ShuffleService {
  private readonly logger = new Logger(ShuffleService.name)

  constructor(private readonly appLogger: AppLoggerService) {}

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
        allowPrivateNetwork: true,
      })

      if (res.status !== 200) {
        return { ok: false, details: `Shuffle returned status ${res.status}` }
      }

      this.appLogger.info('Shuffle connection test succeeded', {
        feature: AppLogFeature.CONNECTORS,
        action: 'testConnection',
        outcome: AppLogOutcome.SUCCESS,
        sourceType: AppLogSourceType.SERVICE,
        className: 'ShuffleService',
        functionName: 'testConnection',
        metadata: { connectorType: 'shuffle' },
      })

      return {
        ok: true,
        details: `Shuffle SOAR reachable at ${baseUrl}.`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed'
      this.logger.warn(`Shuffle connection test failed: ${message}`)

      this.appLogger.error('Shuffle connection test failed', {
        feature: AppLogFeature.CONNECTORS,
        action: 'testConnection',
        outcome: AppLogOutcome.FAILURE,
        sourceType: AppLogSourceType.SERVICE,
        className: 'ShuffleService',
        functionName: 'testConnection',
        metadata: { connectorType: 'shuffle' },
        stackTrace: error instanceof Error ? error.stack : undefined,
      })

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
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      this.appLogger.warn('Failed to fetch Shuffle workflows', {
        feature: AppLogFeature.CONNECTORS,
        action: 'getWorkflows',
        className: 'ShuffleService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { status: res.status },
      })
      throw new Error(`Failed to fetch workflows: status ${res.status}`)
    }

    const workflows = (res.data ?? []) as unknown[]

    this.appLogger.info('Shuffle workflows retrieved', {
      feature: AppLogFeature.CONNECTORS,
      action: 'getWorkflows',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'ShuffleService',
      functionName: 'getWorkflows',
      metadata: { connectorType: 'shuffle', count: workflows.length },
    })

    return workflows
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
      this.appLogger.warn('Invalid Shuffle workflow ID provided', {
        feature: AppLogFeature.CONNECTORS,
        action: 'executeWorkflow',
        className: 'ShuffleService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { workflowId },
      })
      throw new Error('Invalid workflow ID')
    }

    const res = await connectorFetch(`${baseUrl}/api/v1/workflows/${workflowId}/execute`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: data,
      rejectUnauthorized: config.verifyTls !== false,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      this.appLogger.warn('Shuffle workflow execution failed', {
        feature: AppLogFeature.CONNECTORS,
        action: 'executeWorkflow',
        className: 'ShuffleService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { status: res.status, workflowId },
      })
      throw new Error(`Workflow execution failed: status ${res.status}`)
    }

    const body = res.data as Record<string, unknown>
    const executionId = (body.execution_id ?? body.id ?? 'unknown') as string

    this.appLogger.info('Shuffle workflow executed', {
      feature: AppLogFeature.CONNECTORS,
      action: 'executeWorkflow',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'ShuffleService',
      functionName: 'executeWorkflow',
      metadata: { connectorType: 'shuffle', workflowId, executionId },
    })

    return { executionId }
  }
}
