import { Injectable, Logger } from '@nestjs/common'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../../common/enums'
import { AppLoggerService } from '../../../common/services/app-logger.service'
import type { TestResult } from '../connectors.types'

@Injectable()
export class BedrockService {
  private readonly logger = new Logger(BedrockService.name)

  constructor(private readonly appLogger: AppLoggerService) {}

  /**
   * Test AWS Bedrock connection.
   * Uses AWS SDK to list foundation models and verify access.
   */
  async testConnection(config: Record<string, unknown>): Promise<TestResult> {
    const region = (config.region ?? 'us-east-1') as string
    const accessKeyId = config.accessKeyId as string | undefined
    const secretAccessKey = config.secretAccessKey as string | undefined
    const modelId = (config.modelId ?? 'anthropic.claude-3-sonnet-20240229-v1:0') as string

    if (!accessKeyId || !secretAccessKey) {
      return { ok: false, details: 'AWS access key ID and secret access key are required' }
    }

    try {
      const { BedrockRuntimeClient, InvokeModelCommand } = await this.loadAwsSdk()

      const endpoint = config.endpoint as string | undefined

      const client = new BedrockRuntimeClient({
        region,
        credentials: { accessKeyId, secretAccessKey },
        ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      })

      // Send a minimal test prompt
      const command = new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      })

      const response = await client.send(command)
      const bodyString = new TextDecoder().decode(response.body)
      const body = JSON.parse(bodyString) as Record<string, unknown>

      this.appLogger.info('Bedrock connection test succeeded', {
        feature: AppLogFeature.CONNECTORS,
        action: 'testConnection',
        outcome: AppLogOutcome.SUCCESS,
        sourceType: AppLogSourceType.SERVICE,
        className: 'BedrockService',
        functionName: 'testConnection',
        metadata: { connectorType: 'bedrock', region, modelId },
      })

      return {
        ok: true,
        details: `AWS Bedrock accessible in ${region}. Model: ${modelId}. Stop reason: ${body.stop_reason ?? 'ok'}.`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed'
      this.logger.warn(`Bedrock connection test failed: ${message}`)

      this.appLogger.error('Bedrock connection test failed', {
        feature: AppLogFeature.CONNECTORS,
        action: 'testConnection',
        outcome: AppLogOutcome.FAILURE,
        sourceType: AppLogSourceType.SERVICE,
        className: 'BedrockService',
        functionName: 'testConnection',
        metadata: { connectorType: 'bedrock', region, error: message },
        stackTrace: error instanceof Error ? error.stack : undefined,
      })

      // Check if it's a missing SDK error
      if (message.includes('Cannot find module') || message.includes('MODULE_NOT_FOUND')) {
        return {
          ok: false,
          details: 'AWS SDK not installed. Run: npm install @aws-sdk/client-bedrock-runtime',
        }
      }

      return { ok: false, details: message }
    }
  }

  /**
   * Invoke a Bedrock model with a prompt.
   * Calls the real AWS Bedrock Runtime API via the AWS SDK.
   */
  async invoke(
    config: Record<string, unknown>,
    prompt: string,
    maxTokens: number = 1024
  ): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const region = (config.region ?? 'us-east-1') as string
    const accessKeyId = config.accessKeyId as string
    const secretAccessKey = config.secretAccessKey as string
    const modelId = (config.modelId ?? 'anthropic.claude-3-sonnet-20240229-v1:0') as string

    const endpoint = config.endpoint as string | undefined
    const { BedrockRuntimeClient, InvokeModelCommand } = await this.loadAwsSdk()

    const client = new BedrockRuntimeClient({
      region,
      credentials: { accessKeyId, secretAccessKey },
      requestHandler: { requestTimeout: 30_000 },
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    })

    const command = new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const response = await Promise.race([
      client.send(command),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('Bedrock invoke timed out after 30 seconds')), 30_000)
      }),
    ])
    const bodyString = new TextDecoder().decode(response.body)
    const body = JSON.parse(bodyString) as Record<string, unknown>
    const content = body.content as Array<{ text: string }> | undefined
    const usage = body.usage as { input_tokens: number; output_tokens: number } | undefined

    this.appLogger.info('Bedrock model invoked', {
      feature: AppLogFeature.CONNECTORS,
      action: 'invoke',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'BedrockService',
      functionName: 'invoke',
      metadata: {
        connectorType: 'bedrock',
        region,
        modelId,
        maxTokens,
        inputTokens: usage?.input_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
      },
    })

    return {
      text: content?.[0]?.text ?? '',
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
    }
  }

  /**
   * Dynamically import AWS SDK to avoid hard dependency.
   * Install with: npm install @aws-sdk/client-bedrock-runtime
   */
  private async loadAwsSdk(): Promise<{
    BedrockRuntimeClient: new (config: unknown) => {
      send: (command: unknown) => Promise<{ body: Uint8Array }>
    }
    InvokeModelCommand: new (input: unknown) => unknown
  }> {
    try {
      // Dynamic import to avoid compile-time dependency
      const moduleName = '@aws-sdk/client-bedrock-runtime'
      const sdk = (await import(moduleName)) as unknown as Record<string, unknown>
      return sdk as unknown as {
        BedrockRuntimeClient: new (config: unknown) => {
          send: (command: unknown) => Promise<{ body: Uint8Array }>
        }
        InvokeModelCommand: new (input: unknown) => unknown
      }
    } catch {
      this.appLogger.warn('AWS SDK not installed for Bedrock', {
        feature: AppLogFeature.CONNECTORS,
        action: 'loadAwsSdk',
        className: 'BedrockService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: {},
      })
      throw new Error(
        '@aws-sdk/client-bedrock-runtime is not installed. Run: npm install @aws-sdk/client-bedrock-runtime'
      )
    }
  }
}
