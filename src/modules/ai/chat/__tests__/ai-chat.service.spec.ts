import { Test } from '@nestjs/testing'
import { BusinessException } from '../../../../common/exceptions/business.exception'
import { PrismaService } from '../../../../prisma/prisma.service'
import { ConnectorsService } from '../../../connectors/connectors.service'
import { LlmConnectorsService } from '../../../connectors/llm-connectors/llm-connectors.service'
import { LlmApisService } from '../../../connectors/services/llm-apis.service'
import { MemoryRetrievalService } from '../../memory/memory-retrieval.service'
import { AiChatService } from '../ai-chat.service'
import type { AiChatMessage, AiChatThread } from '@prisma/client'

/* ---------------------------------------------------------------- */
/* Constants                                                         */
/* ---------------------------------------------------------------- */

const TENANT_ID = 'tenant-1'
const USER_ID = 'user-1'
const THREAD_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

/* ---------------------------------------------------------------- */
/* Helpers                                                           */
/* ---------------------------------------------------------------- */

function buildThread(overrides?: Partial<AiChatThread>): AiChatThread {
  return {
    id: THREAD_ID,
    tenantId: TENANT_ID,
    userId: USER_ID,
    connectorId: null,
    title: 'Test thread',
    model: 'gpt-4',
    provider: 'llm_apis',
    outputFormat: 'plain_text',
    temperature: 0.7,
    maxTokens: 4096,
    systemPrompt: null,
    messageCount: 0,
    totalTokensUsed: 0,
    lastActivityAt: new Date('2025-06-01T12:00:00Z'),
    isArchived: false,
    createdAt: new Date('2025-06-01T10:00:00Z'),
    updatedAt: new Date('2025-06-01T12:00:00Z'),
    ...overrides,
  } as AiChatThread
}

function buildMessage(overrides?: Partial<AiChatMessage>): AiChatMessage {
  return {
    id: 'msg-1',
    threadId: THREAD_ID,
    tenantId: TENANT_ID,
    role: 'user',
    content: 'Hello',
    sequenceNum: 1,
    status: 'completed',
    model: null,
    provider: null,
    requestedModel: null,
    requestedProvider: null,
    fallbackModel: null,
    fallbackReason: null,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
    createdAt: new Date('2025-06-01T12:00:00Z'),
    ...overrides,
  } as AiChatMessage
}

/* ---------------------------------------------------------------- */
/* Mocks                                                             */
/* ---------------------------------------------------------------- */

const mockPrisma = {
  aiChatThread: {
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
  },
  aiChatMessage: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
}

const mockConnectorsService = {
  getDecryptedConfig: jest.fn(),
}

const mockLlmConnectorsService = {
  getById: jest.fn(),
  getEnabledConfigs: jest.fn(),
  getDecryptedConfig: jest.fn(),
  hasEnabledConnectors: jest.fn(),
}

const mockLlmApisService = {
  invokeChat: jest.fn(),
}

const mockMemoryRetrievalService = {
  formatForPrompt: jest.fn().mockResolvedValue(null),
  retrieveRelevant: jest.fn().mockResolvedValue([]),
}

/* ---------------------------------------------------------------- */
/* Test suite                                                        */
/* ---------------------------------------------------------------- */

describe('AiChatService', () => {
  let service: AiChatService

  beforeEach(async () => {
    jest.clearAllMocks()

    const module = await Test.createTestingModule({
      providers: [
        AiChatService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConnectorsService, useValue: mockConnectorsService },
        { provide: LlmConnectorsService, useValue: mockLlmConnectorsService },
        { provide: LlmApisService, useValue: mockLlmApisService },
        { provide: MemoryRetrievalService, useValue: mockMemoryRetrievalService },
      ],
    }).compile()

    service = module.get(AiChatService)
  })

  /* ---------------------------------------------------------------- */
  /* listThreads                                                       */
  /* ---------------------------------------------------------------- */

  describe('listThreads', () => {
    it('returns threads with cursor pagination and hasMore=true when more exist', async () => {
      const threads = [
        buildThread({ id: 't-1', lastActivityAt: new Date('2025-06-03') }),
        buildThread({ id: 't-2', lastActivityAt: new Date('2025-06-02') }),
        buildThread({ id: 't-3', lastActivityAt: new Date('2025-06-01') }),
      ]
      // Service fetches limit+1 to detect hasMore, so for limit=2 it returns 3
      mockPrisma.aiChatThread.findMany.mockResolvedValue([...threads])

      const result = await service.listThreads(TENANT_ID, USER_ID, 2)

      expect(result.hasMore).toBe(true)
      expect(result.data).toHaveLength(2)
      expect(result.nextCursor).toBe(threads.at(1)?.lastActivityAt.toISOString())
      expect(mockPrisma.aiChatThread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 3 })
      )
    })

    it('returns hasMore=false when no more threads', async () => {
      const threads = [buildThread({ id: 't-1' })]
      mockPrisma.aiChatThread.findMany.mockResolvedValue(threads)

      const result = await service.listThreads(TENANT_ID, USER_ID, 5)

      expect(result.hasMore).toBe(false)
      expect(result.data).toHaveLength(1)
      expect(result.nextCursor).toBeNull()
    })

    it('applies cursor filter when cursor is provided', async () => {
      mockPrisma.aiChatThread.findMany.mockResolvedValue([])
      const cursor = '2025-06-01T12:00:00.000Z'

      await service.listThreads(TENANT_ID, USER_ID, 10, cursor)

      expect(mockPrisma.aiChatThread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            lastActivityAt: { lt: new Date(cursor) },
          }),
        })
      )
    })
  })

  /* ---------------------------------------------------------------- */
  /* createThread                                                      */
  /* ---------------------------------------------------------------- */

  describe('createThread', () => {
    it('creates with explicit UUID connector', async () => {
      const connectorUuid = 'aaaaaaaa-1111-2222-3333-444444444444'
      mockLlmConnectorsService.getById.mockResolvedValue({
        id: connectorUuid,
        name: 'My Custom LLM',
        defaultModel: 'claude-3',
      })
      mockPrisma.aiChatThread.create.mockResolvedValue(
        buildThread({ connectorId: connectorUuid, provider: 'My Custom LLM', model: 'claude-3' })
      )

      const result = await service.createThread(TENANT_ID, USER_ID, {
        connectorId: connectorUuid,
      })

      expect(mockLlmConnectorsService.getById).toHaveBeenCalledWith(connectorUuid, TENANT_ID)
      expect(mockPrisma.aiChatThread.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            connectorId: connectorUuid,
            provider: 'My Custom LLM',
            model: 'claude-3',
          }),
        })
      )
      expect(result.connectorId).toBe(connectorUuid)
    })

    it('auto-selects fixed connector when no UUID provided', async () => {
      mockConnectorsService.getDecryptedConfig.mockResolvedValueOnce({
        defaultModel: 'gpt-4-turbo',
      })
      mockPrisma.aiChatThread.create.mockResolvedValue(
        buildThread({ connectorId: null, provider: 'llm_apis', model: 'gpt-4-turbo' })
      )

      const result = await service.createThread(TENANT_ID, USER_ID, {})

      expect(mockConnectorsService.getDecryptedConfig).toHaveBeenCalledWith(TENANT_ID, 'llm_apis')
      expect(mockPrisma.aiChatThread.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            connectorId: null,
            provider: 'llm_apis',
          }),
        })
      )
      expect(result.provider).toBe('llm_apis')
    })

    it('auto-selects custom LLM when no fixed connectors available', async () => {
      // All fixed connectors return null
      mockConnectorsService.getDecryptedConfig.mockResolvedValue(null)
      mockLlmConnectorsService.getEnabledConfigs.mockResolvedValue([
        { id: 'custom-1', name: 'Custom LLM', config: { defaultModel: 'llama-3' } },
      ])
      mockPrisma.aiChatThread.create.mockResolvedValue(
        buildThread({ connectorId: 'custom-1', provider: 'Custom LLM', model: 'llama-3' })
      )

      const result = await service.createThread(TENANT_ID, USER_ID, {})

      expect(mockLlmConnectorsService.getEnabledConfigs).toHaveBeenCalledWith(TENANT_ID)
      expect(mockPrisma.aiChatThread.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            connectorId: 'custom-1',
            provider: 'Custom LLM',
          }),
        })
      )
      expect(result.connectorId).toBe('custom-1')
    })

    it('throws BusinessException when no connector is available', async () => {
      mockConnectorsService.getDecryptedConfig.mockResolvedValue(null)
      mockLlmConnectorsService.getEnabledConfigs.mockResolvedValue([])

      await expect(service.createThread(TENANT_ID, USER_ID, {})).rejects.toThrow(BusinessException)
    })
  })

  /* ---------------------------------------------------------------- */
  /* getMessages                                                       */
  /* ---------------------------------------------------------------- */

  describe('getMessages', () => {
    beforeEach(() => {
      mockPrisma.aiChatThread.findUnique.mockResolvedValue(buildThread())
    })

    it('returns messages in chronological order for older direction', async () => {
      const messages = [
        buildMessage({ id: 'm-3', createdAt: new Date('2025-06-03') }),
        buildMessage({ id: 'm-2', createdAt: new Date('2025-06-02') }),
      ]
      mockPrisma.aiChatMessage.findMany.mockResolvedValue(messages)

      const result = await service.getMessages(TENANT_ID, USER_ID, THREAD_ID, 10)

      // older direction reverses to chronological
      expect(result.data.at(0)?.id).toBe('m-2')
      expect(result.data.at(1)?.id).toBe('m-3')
    })

    it('applies cursor filter when cursor is provided', async () => {
      mockPrisma.aiChatMessage.findMany.mockResolvedValue([])
      const cursor = '2025-06-01T12:00:00.000Z'

      await service.getMessages(TENANT_ID, USER_ID, THREAD_ID, 10, cursor, 'older')

      expect(mockPrisma.aiChatMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { lt: new Date(cursor) },
          }),
        })
      )
    })

    it('applies gt cursor filter for newer direction', async () => {
      mockPrisma.aiChatMessage.findMany.mockResolvedValue([])
      const cursor = '2025-06-01T12:00:00.000Z'

      await service.getMessages(TENANT_ID, USER_ID, THREAD_ID, 10, cursor, 'newer')

      expect(mockPrisma.aiChatMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gt: new Date(cursor) },
          }),
        })
      )
    })

    it('verifies thread access before returning messages', async () => {
      mockPrisma.aiChatThread.findUnique.mockResolvedValue(
        buildThread({ tenantId: 'other-tenant' })
      )

      await expect(service.getMessages(TENANT_ID, USER_ID, THREAD_ID, 10)).rejects.toThrow(
        BusinessException
      )
    })
  })

  /* ---------------------------------------------------------------- */
  /* updateThreadSettings                                              */
  /* ---------------------------------------------------------------- */

  describe('updateThreadSettings', () => {
    beforeEach(() => {
      mockPrisma.aiChatThread.findUnique.mockResolvedValue(buildThread())
      mockPrisma.aiChatThread.update.mockResolvedValue(buildThread())
    })

    it('handles UUID connector', async () => {
      const connectorUuid = 'aaaaaaaa-1111-2222-3333-444444444444'
      mockLlmConnectorsService.getById.mockResolvedValue({
        id: connectorUuid,
        name: 'Custom LLM',
        defaultModel: 'claude-3',
      })

      await service.updateThreadSettings(TENANT_ID, USER_ID, THREAD_ID, {
        connectorId: connectorUuid,
      })

      expect(mockLlmConnectorsService.getById).toHaveBeenCalledWith(connectorUuid, TENANT_ID)
      expect(mockPrisma.aiChatThread.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            connectorId: connectorUuid,
            provider: 'Custom LLM',
            model: 'claude-3',
          }),
        })
      )
    })

    it('handles "default" reset', async () => {
      await service.updateThreadSettings(TENANT_ID, USER_ID, THREAD_ID, {
        connectorId: 'default',
      })

      expect(mockPrisma.aiChatThread.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            connectorId: null,
            provider: null,
          }),
        })
      )
    })

    it('handles fixed connector type string', async () => {
      mockConnectorsService.getDecryptedConfig.mockResolvedValue({ defaultModel: 'gpt-4-turbo' })

      await service.updateThreadSettings(TENANT_ID, USER_ID, THREAD_ID, {
        connectorId: 'bedrock',
      })

      expect(mockConnectorsService.getDecryptedConfig).toHaveBeenCalledWith(TENANT_ID, 'bedrock')
      expect(mockPrisma.aiChatThread.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            connectorId: null,
            provider: 'bedrock',
            model: 'gpt-4-turbo',
          }),
        })
      )
    })

    it('preserves explicit model when provided', async () => {
      const connectorUuid = 'aaaaaaaa-1111-2222-3333-444444444444'
      mockLlmConnectorsService.getById.mockResolvedValue({
        id: connectorUuid,
        name: 'Custom LLM',
        defaultModel: 'claude-3',
      })

      await service.updateThreadSettings(TENANT_ID, USER_ID, THREAD_ID, {
        connectorId: connectorUuid,
        model: 'claude-3-opus',
      })

      expect(mockPrisma.aiChatThread.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            model: 'claude-3-opus',
          }),
        })
      )
    })
  })

  /* ---------------------------------------------------------------- */
  /* archiveThread                                                     */
  /* ---------------------------------------------------------------- */

  describe('archiveThread', () => {
    it('sets isArchived to true', async () => {
      mockPrisma.aiChatThread.findUnique.mockResolvedValue(buildThread())
      mockPrisma.aiChatThread.update.mockResolvedValue(buildThread({ isArchived: true }))

      await service.archiveThread(TENANT_ID, USER_ID, THREAD_ID)

      expect(mockPrisma.aiChatThread.update).toHaveBeenCalledWith({
        where: { id: THREAD_ID },
        data: { isArchived: true },
      })
    })

    it('throws when thread not found', async () => {
      mockPrisma.aiChatThread.findUnique.mockResolvedValue(null)

      await expect(service.archiveThread(TENANT_ID, USER_ID, THREAD_ID)).rejects.toThrow(
        BusinessException
      )
    })
  })

  /* ---------------------------------------------------------------- */
  /* verifyThreadAccess (tested indirectly via public methods)         */
  /* ---------------------------------------------------------------- */

  describe('verifyThreadAccess (via archiveThread)', () => {
    it('throws 404 when thread not found', async () => {
      mockPrisma.aiChatThread.findUnique.mockResolvedValue(null)

      await expect(service.archiveThread(TENANT_ID, USER_ID, THREAD_ID)).rejects.toThrow(
        expect.objectContaining({ message: 'Chat thread not found' })
      )
    })

    it('throws 403 when tenant mismatch', async () => {
      mockPrisma.aiChatThread.findUnique.mockResolvedValue(
        buildThread({ tenantId: 'other-tenant' })
      )

      await expect(service.archiveThread(TENANT_ID, USER_ID, THREAD_ID)).rejects.toThrow(
        expect.objectContaining({ message: 'Access denied to this chat' })
      )
    })

    it('throws 403 when user mismatch', async () => {
      mockPrisma.aiChatThread.findUnique.mockResolvedValue(buildThread({ userId: 'other-user' }))

      await expect(service.archiveThread(TENANT_ID, USER_ID, THREAD_ID)).rejects.toThrow(
        expect.objectContaining({ message: 'Access denied to this chat' })
      )
    })
  })
})
