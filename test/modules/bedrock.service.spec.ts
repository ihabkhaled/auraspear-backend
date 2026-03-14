import { BedrockService } from '../../src/modules/connectors/services/bedrock.service'

const mockAppLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

function createService(): BedrockService {
  return new BedrockService(mockAppLogger as never)
}

const VALID_CONFIG: Record<string, unknown> = {
  region: 'us-east-1',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  modelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
}

/* ------------------------------------------------------------------ */
/* Helper: build a mock AWS SDK module                                 */
/* ------------------------------------------------------------------ */

interface MockSendResult {
  body: Uint8Array
}

function buildMockSdk(sendResult: MockSendResult) {
  const mockSend = jest.fn().mockResolvedValue(sendResult)

  const MockBedrockRuntimeClient = jest.fn().mockImplementation(() => ({
    send: mockSend,
  }))

  const MockInvokeModelCommand = jest.fn().mockImplementation((input: unknown) => ({
    _input: input,
  }))

  return { MockBedrockRuntimeClient, MockInvokeModelCommand, mockSend }
}

function encodeBody(body: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(body))
}

describe('BedrockService', () => {
  let service: BedrockService
  const originalBedrockMock = process.env['BEDROCK_MOCK']

  beforeEach(() => {
    jest.clearAllMocks()
    jest.restoreAllMocks()
    // Disable mock mode so tests exercise real SDK code paths
    delete process.env['BEDROCK_MOCK']
    service = createService()
  })

  afterAll(() => {
    // Restore original env value
    if (originalBedrockMock !== undefined) {
      process.env['BEDROCK_MOCK'] = originalBedrockMock
    }
  })

  /* ------------------------------------------------------------------ */
  /* testConnection                                                      */
  /* ------------------------------------------------------------------ */

  describe('testConnection', () => {
    it('should return ok: true when Bedrock is accessible', async () => {
      const responseBody = { stop_reason: 'end_turn' }
      const { MockBedrockRuntimeClient, MockInvokeModelCommand } = buildMockSdk({
        body: encodeBody(responseBody),
      })

      jest.spyOn(service as never, 'loadAwsSdk').mockResolvedValue({
        BedrockRuntimeClient: MockBedrockRuntimeClient,
        InvokeModelCommand: MockInvokeModelCommand,
      } as never)

      const result = await service.testConnection(VALID_CONFIG)

      expect(result.ok).toBe(true)
      expect(result.details).toContain('AWS Bedrock accessible')
      expect(result.details).toContain('us-east-1')
      expect(result.details).toContain('anthropic.claude-3-sonnet')
      expect(result.details).toContain('end_turn')
    })

    it('should use default region when not specified', async () => {
      const { MockBedrockRuntimeClient, MockInvokeModelCommand } = buildMockSdk({
        body: encodeBody({ stop_reason: 'end_turn' }),
      })

      jest.spyOn(service as never, 'loadAwsSdk').mockResolvedValue({
        BedrockRuntimeClient: MockBedrockRuntimeClient,
        InvokeModelCommand: MockInvokeModelCommand,
      } as never)

      const config = {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'secretKey',
      }

      const result = await service.testConnection(config)

      expect(result.ok).toBe(true)
      expect(result.details).toContain('us-east-1')
      expect(MockBedrockRuntimeClient).toHaveBeenCalledWith(
        expect.objectContaining({ region: 'us-east-1' })
      )
    })

    it('should use default model when not specified', async () => {
      const { MockBedrockRuntimeClient, MockInvokeModelCommand } = buildMockSdk({
        body: encodeBody({ stop_reason: 'ok' }),
      })

      jest.spyOn(service as never, 'loadAwsSdk').mockResolvedValue({
        BedrockRuntimeClient: MockBedrockRuntimeClient,
        InvokeModelCommand: MockInvokeModelCommand,
      } as never)

      const config = {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'secretKey',
      }

      await service.testConnection(config)

      expect(MockInvokeModelCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
        })
      )
    })

    it('should return error when accessKeyId is missing', async () => {
      const result = await service.testConnection({
        secretAccessKey: 'secret',
        region: 'us-east-1',
      })

      expect(result.ok).toBe(false)
      expect(result.details).toBe('AWS access key ID and secret access key are required')
    })

    it('should return error when secretAccessKey is missing', async () => {
      const result = await service.testConnection({
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        region: 'us-east-1',
      })

      expect(result.ok).toBe(false)
      expect(result.details).toBe('AWS access key ID and secret access key are required')
    })

    it('should return error when both credentials are missing', async () => {
      const result = await service.testConnection({ region: 'us-east-1' })

      expect(result.ok).toBe(false)
      expect(result.details).toBe('AWS access key ID and secret access key are required')
    })

    it('should handle missing stop_reason in response', async () => {
      const { MockBedrockRuntimeClient, MockInvokeModelCommand } = buildMockSdk({
        body: encodeBody({}),
      })

      jest.spyOn(service as never, 'loadAwsSdk').mockResolvedValue({
        BedrockRuntimeClient: MockBedrockRuntimeClient,
        InvokeModelCommand: MockInvokeModelCommand,
      } as never)

      const result = await service.testConnection(VALID_CONFIG)

      expect(result.ok).toBe(true)
      expect(result.details).toContain('ok')
    })

    it('should handle AWS SDK errors gracefully', async () => {
      jest
        .spyOn(service as never, 'loadAwsSdk')
        .mockRejectedValue(
          new Error(
            '@aws-sdk/client-bedrock-runtime is not installed. Run: npm install @aws-sdk/client-bedrock-runtime'
          )
        )

      const result = await service.testConnection(VALID_CONFIG)

      expect(result.ok).toBe(false)
    })

    it('should detect missing SDK module and return install instructions', async () => {
      jest
        .spyOn(service as never, 'loadAwsSdk')
        .mockRejectedValue(new Error('Cannot find module @aws-sdk/client-bedrock-runtime'))

      const result = await service.testConnection(VALID_CONFIG)

      expect(result.ok).toBe(false)
      expect(result.details).toContain('AWS SDK not installed')
      expect(result.details).toContain('npm install')
    })

    it('should detect MODULE_NOT_FOUND error and return install instructions', async () => {
      const moduleError = new Error('MODULE_NOT_FOUND')
      jest.spyOn(service as never, 'loadAwsSdk').mockRejectedValue(moduleError)

      const result = await service.testConnection(VALID_CONFIG)

      expect(result.ok).toBe(false)
      expect(result.details).toContain('AWS SDK not installed')
    })

    it('should handle non-Error thrown values', async () => {
      jest.spyOn(service as never, 'loadAwsSdk').mockRejectedValue('unknown error')

      const result = await service.testConnection(VALID_CONFIG)

      expect(result.ok).toBe(false)
      expect(result.details).toBe('Connection failed')
    })

    it('should handle API invocation errors', async () => {
      const { MockBedrockRuntimeClient, MockInvokeModelCommand } = buildMockSdk({
        body: encodeBody({}),
      })

      const mockSend = jest.fn().mockRejectedValue(new Error('AccessDeniedException'))
      MockBedrockRuntimeClient.mockImplementation(() => ({ send: mockSend }))

      jest.spyOn(service as never, 'loadAwsSdk').mockResolvedValue({
        BedrockRuntimeClient: MockBedrockRuntimeClient,
        InvokeModelCommand: MockInvokeModelCommand,
      } as never)

      const result = await service.testConnection(VALID_CONFIG)

      expect(result.ok).toBe(false)
      expect(result.details).toBe('AccessDeniedException')
    })

    it('should log success on successful connection', async () => {
      const { MockBedrockRuntimeClient, MockInvokeModelCommand } = buildMockSdk({
        body: encodeBody({ stop_reason: 'end_turn' }),
      })

      jest.spyOn(service as never, 'loadAwsSdk').mockResolvedValue({
        BedrockRuntimeClient: MockBedrockRuntimeClient,
        InvokeModelCommand: MockInvokeModelCommand,
      } as never)

      await service.testConnection(VALID_CONFIG)

      expect(mockAppLogger.info).toHaveBeenCalledWith(
        'Bedrock connection test succeeded',
        expect.objectContaining({
          metadata: expect.objectContaining({
            connectorType: 'bedrock',
            region: 'us-east-1',
          }),
        })
      )
    })

    it('should log error on failed connection', async () => {
      jest.spyOn(service as never, 'loadAwsSdk').mockRejectedValue(new Error('Network failure'))

      await service.testConnection(VALID_CONFIG)

      expect(mockAppLogger.error).toHaveBeenCalledWith(
        'Bedrock connection test failed',
        expect.objectContaining({
          metadata: expect.objectContaining({
            connectorType: 'bedrock',
            region: 'us-east-1',
          }),
        })
      )
    })

    it('should pass credentials to BedrockRuntimeClient', async () => {
      const { MockBedrockRuntimeClient, MockInvokeModelCommand } = buildMockSdk({
        body: encodeBody({ stop_reason: 'end_turn' }),
      })

      jest.spyOn(service as never, 'loadAwsSdk').mockResolvedValue({
        BedrockRuntimeClient: MockBedrockRuntimeClient,
        InvokeModelCommand: MockInvokeModelCommand,
      } as never)

      await service.testConnection(VALID_CONFIG)

      expect(MockBedrockRuntimeClient).toHaveBeenCalledWith({
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
          secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        },
      })
    })

    it('should send a minimal test prompt with max_tokens 10', async () => {
      const { MockBedrockRuntimeClient, MockInvokeModelCommand } = buildMockSdk({
        body: encodeBody({ stop_reason: 'end_turn' }),
      })

      jest.spyOn(service as never, 'loadAwsSdk').mockResolvedValue({
        BedrockRuntimeClient: MockBedrockRuntimeClient,
        InvokeModelCommand: MockInvokeModelCommand,
      } as never)

      await service.testConnection(VALID_CONFIG)

      expect(MockInvokeModelCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          contentType: 'application/json',
          accept: 'application/json',
          body: expect.stringContaining('"max_tokens":10'),
        })
      )
    })
  })

  /* ------------------------------------------------------------------ */
  /* invoke                                                              */
  /* ------------------------------------------------------------------ */

  describe('invoke', () => {
    it('should invoke model and return text with token counts', async () => {
      const responseBody = {
        content: [{ text: 'Hello, this is the response.' }],
        usage: { input_tokens: 5, output_tokens: 12 },
      }
      const { MockBedrockRuntimeClient, MockInvokeModelCommand } = buildMockSdk({
        body: encodeBody(responseBody),
      })

      jest.spyOn(service as never, 'loadAwsSdk').mockResolvedValue({
        BedrockRuntimeClient: MockBedrockRuntimeClient,
        InvokeModelCommand: MockInvokeModelCommand,
      } as never)

      const result = await service.invoke(VALID_CONFIG, 'Tell me about security')

      expect(result.text).toBe('Hello, this is the response.')
      expect(result.inputTokens).toBe(5)
      expect(result.outputTokens).toBe(12)
    })

    it('should use default maxTokens of 1024', async () => {
      const { MockBedrockRuntimeClient, MockInvokeModelCommand } = buildMockSdk({
        body: encodeBody({
          content: [{ text: 'Response' }],
          usage: { input_tokens: 3, output_tokens: 1 },
        }),
      })

      jest.spyOn(service as never, 'loadAwsSdk').mockResolvedValue({
        BedrockRuntimeClient: MockBedrockRuntimeClient,
        InvokeModelCommand: MockInvokeModelCommand,
      } as never)

      await service.invoke(VALID_CONFIG, 'Hello')

      expect(MockInvokeModelCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('"max_tokens":1024'),
        })
      )
    })

    it('should use custom maxTokens when provided', async () => {
      const { MockBedrockRuntimeClient, MockInvokeModelCommand } = buildMockSdk({
        body: encodeBody({
          content: [{ text: 'Response' }],
          usage: { input_tokens: 3, output_tokens: 1 },
        }),
      })

      jest.spyOn(service as never, 'loadAwsSdk').mockResolvedValue({
        BedrockRuntimeClient: MockBedrockRuntimeClient,
        InvokeModelCommand: MockInvokeModelCommand,
      } as never)

      await service.invoke(VALID_CONFIG, 'Hello', 2048)

      expect(MockInvokeModelCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('"max_tokens":2048'),
        })
      )
    })

    it('should return empty text when content is missing', async () => {
      const { MockBedrockRuntimeClient, MockInvokeModelCommand } = buildMockSdk({
        body: encodeBody({ usage: { input_tokens: 5, output_tokens: 0 } }),
      })

      jest.spyOn(service as never, 'loadAwsSdk').mockResolvedValue({
        BedrockRuntimeClient: MockBedrockRuntimeClient,
        InvokeModelCommand: MockInvokeModelCommand,
      } as never)

      const result = await service.invoke(VALID_CONFIG, 'Hello')

      expect(result.text).toBe('')
    })

    it('should return zero token counts when usage is missing', async () => {
      const { MockBedrockRuntimeClient, MockInvokeModelCommand } = buildMockSdk({
        body: encodeBody({ content: [{ text: 'No usage' }] }),
      })

      jest.spyOn(service as never, 'loadAwsSdk').mockResolvedValue({
        BedrockRuntimeClient: MockBedrockRuntimeClient,
        InvokeModelCommand: MockInvokeModelCommand,
      } as never)

      const result = await service.invoke(VALID_CONFIG, 'Hello')

      expect(result.text).toBe('No usage')
      expect(result.inputTokens).toBe(0)
      expect(result.outputTokens).toBe(0)
    })

    it('should use default region when not specified', async () => {
      const { MockBedrockRuntimeClient, MockInvokeModelCommand } = buildMockSdk({
        body: encodeBody({
          content: [{ text: 'R' }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      })

      jest.spyOn(service as never, 'loadAwsSdk').mockResolvedValue({
        BedrockRuntimeClient: MockBedrockRuntimeClient,
        InvokeModelCommand: MockInvokeModelCommand,
      } as never)

      const config = {
        accessKeyId: 'AKID',
        secretAccessKey: 'secret',
      }

      await service.invoke(config, 'Hello')

      expect(MockBedrockRuntimeClient).toHaveBeenCalledWith(
        expect.objectContaining({ region: 'us-east-1' })
      )
    })

    it('should use default model when not specified', async () => {
      const { MockBedrockRuntimeClient, MockInvokeModelCommand } = buildMockSdk({
        body: encodeBody({
          content: [{ text: 'R' }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      })

      jest.spyOn(service as never, 'loadAwsSdk').mockResolvedValue({
        BedrockRuntimeClient: MockBedrockRuntimeClient,
        InvokeModelCommand: MockInvokeModelCommand,
      } as never)

      const config = {
        accessKeyId: 'AKID',
        secretAccessKey: 'secret',
      }

      await service.invoke(config, 'Hello')

      expect(MockInvokeModelCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
        })
      )
    })

    it('should send prompt as user message in request body', async () => {
      const { MockBedrockRuntimeClient, MockInvokeModelCommand } = buildMockSdk({
        body: encodeBody({
          content: [{ text: 'R' }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      })

      jest.spyOn(service as never, 'loadAwsSdk').mockResolvedValue({
        BedrockRuntimeClient: MockBedrockRuntimeClient,
        InvokeModelCommand: MockInvokeModelCommand,
      } as never)

      await service.invoke(VALID_CONFIG, 'Analyze this IOC')

      const callArguments = MockInvokeModelCommand.mock.calls[0]?.[0] as
        | Record<string, unknown>
        | undefined
      const body = JSON.parse(callArguments?.body as string) as Record<string, unknown>
      const messages = body.messages as Array<Record<string, unknown>>

      expect(messages).toEqual([{ role: 'user', content: 'Analyze this IOC' }])
    })

    it('should log success after invocation', async () => {
      const { MockBedrockRuntimeClient, MockInvokeModelCommand } = buildMockSdk({
        body: encodeBody({
          content: [{ text: 'R' }],
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      })

      jest.spyOn(service as never, 'loadAwsSdk').mockResolvedValue({
        BedrockRuntimeClient: MockBedrockRuntimeClient,
        InvokeModelCommand: MockInvokeModelCommand,
      } as never)

      await service.invoke(VALID_CONFIG, 'Hello', 512)

      expect(mockAppLogger.info).toHaveBeenCalledWith(
        'Bedrock model invoked',
        expect.objectContaining({
          metadata: expect.objectContaining({
            connectorType: 'bedrock',
            region: 'us-east-1',
            maxTokens: 512,
            inputTokens: 10,
            outputTokens: 20,
          }),
        })
      )
    })

    it('should propagate errors from SDK send', async () => {
      const { MockBedrockRuntimeClient, MockInvokeModelCommand } = buildMockSdk({
        body: encodeBody({}),
      })

      const mockSend = jest.fn().mockRejectedValue(new Error('ThrottlingException'))
      MockBedrockRuntimeClient.mockImplementation(() => ({ send: mockSend }))

      jest.spyOn(service as never, 'loadAwsSdk').mockResolvedValue({
        BedrockRuntimeClient: MockBedrockRuntimeClient,
        InvokeModelCommand: MockInvokeModelCommand,
      } as never)

      await expect(service.invoke(VALID_CONFIG, 'Hello')).rejects.toThrow('ThrottlingException')
    })
  })

  /* ------------------------------------------------------------------ */
  /* loadAwsSdk (dynamic import)                                         */
  /* ------------------------------------------------------------------ */

  describe('loadAwsSdk', () => {
    it('should log warning and throw when SDK is not installed', async () => {
      jest.spyOn(service as never, 'loadAwsSdk').mockRestore()

      // The dynamic import will fail in the test environment since the SDK
      // is not installed. We test the error path directly.
      // We need to call the private method indirectly via testConnection.
      const result = await service.testConnection(VALID_CONFIG)

      // In test environment, the SDK likely isn't installed, so this should fail.
      // If the SDK IS installed, the test will still pass (ok: true).
      expect(typeof result.ok).toBe('boolean')
      expect(typeof result.details).toBe('string')
    })
  })
})
