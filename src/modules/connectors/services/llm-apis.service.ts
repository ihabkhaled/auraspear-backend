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
import { LlmMaxTokensParameter } from '../connectors.enums'
import {
  extractRemoteErrorMessage,
  formatRemoteError,
  normalizeTimeoutMs,
} from '../connectors.utilities'
import type { ChatCompletionResponse, ModelsListResponse, TestResult } from '../connectors.types'

@Injectable()
export class LlmApisService {
  private readonly logger = new Logger(LlmApisService.name)

  constructor(
    private readonly appLogger: AppLoggerService,
    private readonly httpClient: AxiosService
  ) {}

  /**
   * Test connection to an OpenAI-compatible LLM API.
   * Sends a minimal chat completion request to verify connectivity.
   */
  async testConnection(config: Record<string, unknown>): Promise<TestResult> {
    const baseUrl = config.baseUrl as string | undefined
    if (!baseUrl) {
      return { ok: false, details: 'LLM API base URL not configured' }
    }

    const apiKey = config.apiKey as string | undefined
    if (!apiKey) {
      return { ok: false, details: 'LLM API key not configured' }
    }

    const defaultModel = (config.defaultModel ?? 'gpt-4') as string
    const organizationId = config.organizationId as string | undefined
    const maxTokensParameter =
      (config.maxTokensParameter as string | undefined) ?? LlmMaxTokensParameter.MAX_TOKENS
    const rawTimeout = (config.timeout as number | undefined) ?? 30_000
    const timeout = normalizeTimeoutMs(rawTimeout)

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      }
      if (organizationId) {
        headers['OpenAI-Organization'] = organizationId
      }

      const body = JSON.stringify({
        model: defaultModel,
        messages: [{ role: 'user', content: 'Hi' }],
        [maxTokensParameter]: 5,
      })

      const res = await this.httpClient.fetch(`${baseUrl}/chat/completions`, {
        method: HttpMethod.POST,
        headers,
        body,
        timeoutMs: timeout,
        allowPrivateNetwork: true,
      })

      if (res.status !== 200) {
        const remoteError = formatRemoteError('LLM API', res.status, res.data)
        this.appLogger.warn('LLM API connection test returned non-200', {
          feature: AppLogFeature.CONNECTORS,
          action: 'testConnection',
          className: 'LlmApisService',
          sourceType: AppLogSourceType.SERVICE,
          outcome: AppLogOutcome.FAILURE,
          metadata: {
            connectorType: ConnectorType.LLM_APIS,
            status: res.status,
            remoteError: extractRemoteErrorMessage(res.data),
          },
        })
        return { ok: false, details: remoteError }
      }

      const parsed = res.data as ChatCompletionResponse
      const hasChoices = Array.isArray(parsed.choices) && parsed.choices.length > 0

      this.appLogger.info('LLM APIs connection test succeeded', {
        feature: AppLogFeature.CONNECTORS,
        action: 'testConnection',
        outcome: AppLogOutcome.SUCCESS,
        sourceType: AppLogSourceType.SERVICE,
        className: 'LlmApisService',
        functionName: 'testConnection',
        metadata: { connectorType: ConnectorType.LLM_APIS, model: defaultModel },
      })

      return {
        ok: true,
        details: `LLM API reachable at ${baseUrl}. Model: ${defaultModel}. ${hasChoices ? 'Response received.' : 'No choices returned.'}`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed'
      this.logger.warn(`LLM APIs connection test failed: ${message}`)

      this.appLogger.error('LLM APIs connection test failed', {
        feature: AppLogFeature.CONNECTORS,
        action: 'testConnection',
        outcome: AppLogOutcome.FAILURE,
        sourceType: AppLogSourceType.SERVICE,
        className: 'LlmApisService',
        functionName: 'testConnection',
        metadata: { connectorType: ConnectorType.LLM_APIS, error: message },
        stackTrace: error instanceof Error ? error.stack : undefined,
      })

      return { ok: false, details: message }
    }
  }

  /**
   * Invoke an OpenAI-compatible chat completions endpoint.
   */
  async invoke(
    config: Record<string, unknown>,
    prompt: string,
    maxTokens: number = 1024,
    model?: string
  ): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const baseUrl = config.baseUrl as string
    const apiKey = config.apiKey as string
    const defaultModel = (config.defaultModel ?? 'gpt-4') as string
    const organizationId = config.organizationId as string | undefined
    const maxTokensParameter =
      (config.maxTokensParameter as string | undefined) ?? LlmMaxTokensParameter.MAX_TOKENS
    const timeout = (config.timeout as number | undefined) ?? 60_000

    const resolvedModel = model ?? defaultModel

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    }
    if (organizationId) {
      headers['OpenAI-Organization'] = organizationId
    }

    const body = JSON.stringify({
      model: resolvedModel,
      messages: [{ role: 'user', content: prompt }],
      [maxTokensParameter]: maxTokens,
    })

    const res = await this.httpClient.fetch(`${baseUrl}/chat/completions`, {
      method: HttpMethod.POST,
      headers,
      body,
      timeoutMs: timeout,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      throw new Error(formatRemoteError('LLM API', res.status, res.data))
    }

    const parsed = res.data as ChatCompletionResponse
    const firstChoice = parsed.choices.at(0)
    const text = firstChoice?.message?.content ?? ''
    const inputTokens = parsed.usage?.prompt_tokens ?? 0
    const outputTokens = parsed.usage?.completion_tokens ?? 0

    this.appLogger.info('LLM API model invoked', {
      feature: AppLogFeature.CONNECTORS,
      action: 'invoke',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'LlmApisService',
      functionName: 'invoke',
      metadata: {
        connectorType: ConnectorType.LLM_APIS,
        model: resolvedModel,
        maxTokens,
        inputTokens,
        outputTokens,
      },
    })

    return { text, inputTokens, outputTokens }
  }

  /**
   * List available models from an OpenAI-compatible API.
   */
  async listModels(config: Record<string, unknown>): Promise<string[]> {
    const baseUrl = config.baseUrl as string
    const apiKey = config.apiKey as string
    const organizationId = config.organizationId as string | undefined
    const rawTimeout = (config.timeout as number | undefined) ?? 15_000
    const timeout = normalizeTimeoutMs(rawTimeout)

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
    }
    if (organizationId) {
      headers['OpenAI-Organization'] = organizationId
    }

    const res = await this.httpClient.fetch(`${baseUrl}/models`, {
      headers,
      timeoutMs: timeout,
      allowPrivateNetwork: true,
    })

    if (res.status !== 200) {
      throw new Error(formatRemoteError('LLM API', res.status, res.data))
    }

    const parsed = res.data as ModelsListResponse
    const models = Array.isArray(parsed.data) ? parsed.data.map(m => m.id) : []

    this.appLogger.info('LLM API models listed', {
      feature: AppLogFeature.CONNECTORS,
      action: 'listModels',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'LlmApisService',
      functionName: 'listModels',
      metadata: {
        connectorType: ConnectorType.LLM_APIS,
        modelCount: models.length,
      },
    })

    return models
  }
}
