import { Injectable, Logger } from '@nestjs/common'
import {
  AppLogFeature,
  AppLogOutcome,
  AppLogSourceType,
  ConnectorType,
  HttpMethod,
} from '../../../common/enums'
import { AxiosService } from '../../../common/modules/axios'
import { AppLoggerService } from '../../../common/services/app-logger.service'
import { extractRemoteErrorMessage, formatRemoteError } from '../connectors.utilities'
import type { TestResult } from '../connectors.types'

@Injectable()
export class ShuffleService {
  private readonly logger = new Logger(ShuffleService.name)

  constructor(
    private readonly appLogger: AppLoggerService,
    private readonly httpClient: AxiosService
  ) {}

  /**
   * Test Shuffle SOAR connection.
   * GET /api/v1/apps/authentication with bearer token.
   */
  async testConnection(config: Record<string, unknown>): Promise<TestResult> {
    const baseUrl = (config.webhookUrl ?? config.baseUrl) as string | undefined
    if (!baseUrl) {
      return { ok: false, details: 'Shuffle URL not configured' }
    }

    // apiKey is the canonical key; shuffleApiKey is a legacy fallback
    const apiKey = (config.apiKey ?? config.shuffleApiKey) as string | undefined
    if (!apiKey) {
      return { ok: false, details: 'Shuffle API key not configured' }
    }

    try {
      const res = await this.httpClient.fetch(`${baseUrl}/api/v1/apps/authentication`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        rejectUnauthorized: config.verifyTls !== false,
        allowPrivateNetwork: true,
      })

      if (res.status !== 200) {
        const remoteError = formatRemoteError('Shuffle', res.status, res.data)
        this.appLogger.warn('Shuffle connection test returned non-200', {
          feature: AppLogFeature.CONNECTORS,
          action: 'testConnection',
          className: 'ShuffleService',
          sourceType: AppLogSourceType.SERVICE,
          outcome: AppLogOutcome.FAILURE,
          metadata: {
            connectorType: ConnectorType.SHUFFLE,
            status: res.status,
            remoteError: extractRemoteErrorMessage(res.data),
          },
        })
        return { ok: false, details: remoteError }
      }

      this.appLogger.info('Shuffle connection test succeeded', {
        feature: AppLogFeature.CONNECTORS,
        action: 'testConnection',
        outcome: AppLogOutcome.SUCCESS,
        sourceType: AppLogSourceType.SERVICE,
        className: 'ShuffleService',
        functionName: 'testConnection',
        metadata: { connectorType: ConnectorType.SHUFFLE },
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
        metadata: { connectorType: ConnectorType.SHUFFLE, error: message },
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
    // apiKey is the canonical key; shuffleApiKey is a legacy fallback
    const apiKey = (config.apiKey ?? config.shuffleApiKey) as string

    const res = await this.httpClient.fetch(`${baseUrl}/api/v1/workflows`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      rejectUnauthorized: config.verifyTls !== false,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      const remoteMessage = extractRemoteErrorMessage(res.data)
      this.appLogger.warn('Failed to fetch Shuffle workflows', {
        feature: AppLogFeature.CONNECTORS,
        action: 'getWorkflows',
        className: 'ShuffleService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { status: res.status, remoteError: remoteMessage },
      })
      throw new Error(formatRemoteError('Shuffle', res.status, res.data))
    }

    const workflows = (res.data ?? []) as unknown[]

    this.appLogger.info('Shuffle workflows retrieved', {
      feature: AppLogFeature.CONNECTORS,
      action: 'getWorkflows',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'ShuffleService',
      functionName: 'getWorkflows',
      metadata: { connectorType: ConnectorType.SHUFFLE, count: workflows.length },
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
    // apiKey is the canonical key; shuffleApiKey is a legacy fallback
    const apiKey = (config.apiKey ?? config.shuffleApiKey) as string

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

    const res = await this.httpClient.fetch(`${baseUrl}/api/v1/workflows/${workflowId}/execute`, {
      method: HttpMethod.POST,
      headers: { Authorization: `Bearer ${apiKey}` },
      body: data,
      rejectUnauthorized: config.verifyTls !== false,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      const remoteMessage = extractRemoteErrorMessage(res.data)
      this.appLogger.warn('Shuffle workflow execution failed', {
        feature: AppLogFeature.CONNECTORS,
        action: 'executeWorkflow',
        className: 'ShuffleService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { status: res.status, workflowId, remoteError: remoteMessage },
      })
      throw new Error(formatRemoteError('Shuffle', res.status, res.data))
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
      metadata: { connectorType: ConnectorType.SHUFFLE, workflowId, executionId },
    })

    return { executionId }
  }
}
