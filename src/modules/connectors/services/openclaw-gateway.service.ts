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
import { formatRemoteError, normalizeTimeoutMs } from '../connectors.utilities'
import type { OpenClawHealthResponse, OpenClawTaskResponse, TestResult } from '../connectors.types'

@Injectable()
export class OpenClawGatewayService {
  private readonly logger = new Logger(OpenClawGatewayService.name)

  constructor(
    private readonly appLogger: AppLoggerService,
    private readonly httpClient: AxiosService
  ) {}

  /**
   * Test connection to OpenClaw Gateway.
   * Tries GET /health first, falls back to a test task POST.
   */
  async testConnection(config: Record<string, unknown>): Promise<TestResult> {
    const baseUrl = config.baseUrl as string | undefined
    if (!baseUrl) {
      return { ok: false, details: 'OpenClaw Gateway base URL not configured' }
    }

    const apiKey = config.apiKey as string | undefined
    if (!apiKey) {
      return { ok: false, details: 'OpenClaw Gateway API key not configured' }
    }

    const rawTimeout = (config.timeout as number | undefined) ?? 30_000
    const timeout = normalizeTimeoutMs(rawTimeout)

    try {
      // Try health endpoint first
      const healthResult = await this.tryHealthEndpoint(baseUrl, apiKey, timeout)
      if (healthResult) {
        return healthResult
      }

      // Fall back to a test task
      return await this.tryTestTask(baseUrl, apiKey, timeout)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed'
      this.logger.warn(`OpenClaw Gateway connection test failed: ${message}`)

      this.appLogger.error('OpenClaw Gateway connection test failed', {
        feature: AppLogFeature.CONNECTORS,
        action: 'testConnection',
        outcome: AppLogOutcome.FAILURE,
        sourceType: AppLogSourceType.SERVICE,
        className: 'OpenClawGatewayService',
        functionName: 'testConnection',
        metadata: { connectorType: ConnectorType.OPENCLAW_GATEWAY, error: message },
        stackTrace: error instanceof Error ? error.stack : undefined,
      })

      return { ok: false, details: message }
    }
  }

  /**
   * Invoke an OpenClaw Gateway task.
   * Sends a structured payload with prompt and optional task type.
   */
  async invoke(
    config: Record<string, unknown>,
    prompt: string,
    maxTokens: number = 1024,
    taskType?: string
  ): Promise<{ text: string; inputTokens: number; outputTokens: number; taskId?: string }> {
    const baseUrl = config.baseUrl as string
    const apiKey = config.apiKey as string
    const timeout = (config.timeout as number | undefined) ?? 60_000
    const resolvedTaskType = taskType ?? 'agent_task'

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    }

    const body = JSON.stringify({
      task_type: resolvedTaskType,
      prompt,
      max_tokens: maxTokens,
    })

    const res = await this.httpClient.fetch(`${baseUrl}/api/v1/task`, {
      method: HttpMethod.POST,
      headers,
      body,
      timeoutMs: timeout,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200 && res.status !== 201) {
      throw new Error(formatRemoteError('OpenClaw Gateway', res.status, res.data))
    }

    const parsed = res.data as OpenClawTaskResponse
    const text = parsed.result?.text ?? ''
    const inputTokens = parsed.result?.usage?.input_tokens ?? 0
    const outputTokens = parsed.result?.usage?.output_tokens ?? 0
    const { taskId } = parsed

    this.appLogger.info('OpenClaw Gateway task invoked', {
      feature: AppLogFeature.CONNECTORS,
      action: 'invoke',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'OpenClawGatewayService',
      functionName: 'invoke',
      metadata: {
        connectorType: ConnectorType.OPENCLAW_GATEWAY,
        taskType: resolvedTaskType,
        maxTokens,
        inputTokens,
        outputTokens,
        taskId,
      },
    })

    return { text, inputTokens, outputTokens, taskId }
  }

  /**
   * Try the health endpoint to verify connectivity.
   */
  private async tryHealthEndpoint(
    baseUrl: string,
    apiKey: string,
    timeout: number
  ): Promise<TestResult | null> {
    try {
      const res = await this.httpClient.fetch(`${baseUrl}/health`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeoutMs: timeout,
        allowPrivateNetwork: true,
      })

      if (res.status === 200) {
        const parsed = res.data as OpenClawHealthResponse

        this.appLogger.info('OpenClaw Gateway connection test succeeded via /health', {
          feature: AppLogFeature.CONNECTORS,
          action: 'testConnection',
          outcome: AppLogOutcome.SUCCESS,
          sourceType: AppLogSourceType.SERVICE,
          className: 'OpenClawGatewayService',
          functionName: 'testConnection',
          metadata: {
            connectorType: ConnectorType.OPENCLAW_GATEWAY,
            version: parsed.version ?? 'unknown',
          },
        })

        return {
          ok: true,
          details: `OpenClaw Gateway reachable at ${baseUrl}. Status: ${parsed.status}. Version: ${parsed.version ?? 'unknown'}.`,
        }
      }

      // Health endpoint returned non-200; fall through to test task
      return null
    } catch {
      // Health endpoint not available; fall through to test task
      return null
    }
  }

  /**
   * Fall back to sending a test task to verify connectivity.
   */
  private async tryTestTask(baseUrl: string, apiKey: string, timeout: number): Promise<TestResult> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    }

    const body = JSON.stringify({
      task_type: 'explain',
      prompt: 'ping',
      max_tokens: 5,
    })

    const res = await this.httpClient.fetch(`${baseUrl}/api/v1/task`, {
      method: HttpMethod.POST,
      headers,
      body,
      timeoutMs: timeout,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200 && res.status !== 201) {
      return { ok: false, details: formatRemoteError('OpenClaw Gateway', res.status, res.data) }
    }

    this.appLogger.info('OpenClaw Gateway connection test succeeded via /api/v1/task', {
      feature: AppLogFeature.CONNECTORS,
      action: 'testConnection',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'OpenClawGatewayService',
      functionName: 'testConnection',
      metadata: { connectorType: ConnectorType.OPENCLAW_GATEWAY },
    })

    return {
      ok: true,
      details: `OpenClaw Gateway reachable at ${baseUrl}. Test task accepted.`,
    }
  }
}
