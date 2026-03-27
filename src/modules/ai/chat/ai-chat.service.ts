import { Injectable, Logger } from '@nestjs/common'
import { AiOutputFormat } from '../../../common/enums'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../prisma/prisma.service'
import { ConnectorsService } from '../../connectors/connectors.service'
import { LlmConnectorsService } from '../../connectors/llm-connectors/llm-connectors.service'
import { LlmApisService } from '../../connectors/services/llm-apis.service'
import type { AiChatMessage, AiChatThread } from '@prisma/client'

@Injectable()
export class AiChatService {
  private readonly logger = new Logger(AiChatService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly connectorsService: ConnectorsService,
    private readonly llmConnectorsService: LlmConnectorsService,
    private readonly llmApisService: LlmApisService
  ) {}

  async listThreads(
    tenantId: string,
    userId: string,
    limit: number,
    cursor?: string
  ): Promise<{ data: AiChatThread[]; nextCursor: string | null; hasMore: boolean }> {
    const where: Record<string, unknown> = { tenantId, userId, isArchived: false }

    if (cursor) {
      where['lastActivityAt'] = { lt: new Date(cursor) }
    }

    const threads = await this.prisma.aiChatThread.findMany({
      where,
      orderBy: { lastActivityAt: 'desc' },
      take: limit + 1,
    })

    const hasMore = threads.length > limit
    if (hasMore) {
      threads.pop()
    }

    const nextCursor =
      hasMore && threads.length > 0 ? (threads.at(-1)?.lastActivityAt.toISOString() ?? null) : null

    return { data: threads, nextCursor, hasMore }
  }

  async createThread(
    tenantId: string,
    userId: string,
    options: { connectorId?: string; model?: string; systemPrompt?: string }
  ): Promise<AiChatThread> {
    const rawConnectorId = options.connectorId ?? null
    let connectorId: string | null = null
    let provider: string | null = null
    let model: string | null = options.model ?? null

    // Only treat as a specific connector if it looks like a UUID
    const isUuid = rawConnectorId
      ? /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(rawConnectorId)
      : false

    if (rawConnectorId && isUuid) {
      // Explicit custom LLM connector selected
      connectorId = rawConnectorId
      const connector = await this.llmConnectorsService.getById(connectorId, tenantId)
      provider = connector.name
      if (!model) {
        model = connector.defaultModel ?? null
      }
    }

    // Auto-select first enabled LLM connector if none resolved
    if (!connectorId) {
      const enabledConfigs = await this.llmConnectorsService.getEnabledConfigs(tenantId)
      const first = enabledConfigs.at(0)
      if (first) {
        connectorId = first.id
        provider = first.name
        if (!model) {
          model = (first.config.defaultModel as string) ?? null
        }
      }
    }

    if (!connectorId) {
      throw new BusinessException(
        400,
        'No LLM connector available. Configure one in Connectors settings.',
        'errors.chat.noConnectorAvailable'
      )
    }

    return this.prisma.aiChatThread.create({
      data: {
        tenantId,
        userId,
        connectorId,
        title: null,
        model,
        provider,
        outputFormat: AiOutputFormat.PLAIN_TEXT,
        systemPrompt: options.systemPrompt ?? null,
      },
    })
  }

  async getMessages(
    tenantId: string,
    userId: string,
    threadId: string,
    limit: number,
    cursor?: string,
    direction: 'older' | 'newer' = 'older'
  ): Promise<{ data: AiChatMessage[]; nextCursor: string | null; hasMore: boolean }> {
    await this.verifyThreadAccess(tenantId, userId, threadId)

    const where: Record<string, unknown> = { threadId, tenantId }

    if (cursor) {
      where['createdAt'] =
        direction === 'older' ? { lt: new Date(cursor) } : { gt: new Date(cursor) }
    }

    const orderDir = direction === 'older' ? 'desc' : 'asc'

    const messages = await this.prisma.aiChatMessage.findMany({
      where,
      orderBy: { createdAt: orderDir as 'asc' | 'desc' },
      take: limit + 1,
    })

    const hasMore = messages.length > limit
    if (hasMore) {
      messages.pop()
    }

    // Always return in chronological order
    if (direction === 'older') {
      messages.reverse()
    }

    const nextCursor =
      hasMore && messages.length > 0
        ? ((direction === 'older'
            ? messages.at(0)?.createdAt.toISOString()
            : messages.at(-1)?.createdAt.toISOString()) ?? null)
        : null

    return { data: messages, nextCursor, hasMore }
  }

  async sendMessage(
    tenantId: string,
    userId: string,
    threadId: string,
    content: string,
    overrides?: { model?: string; connectorId?: string }
  ): Promise<AiChatMessage> {
    const thread = await this.verifyThreadAccess(tenantId, userId, threadId)

    if (!content || content.trim().length === 0) {
      throw new BusinessException(400, 'Message content is required', 'errors.chat.emptyMessage')
    }

    const nextSeq = thread.messageCount + 1

    // Determine requested model/connector (per-message override or thread default)
    const requestedModel = overrides?.model ?? thread.model ?? null
    const requestedConnectorId = overrides?.connectorId ?? thread.connectorId
    const requestedProvider = thread.provider ?? null

    // If per-message connector override, update thread settings too
    if (overrides?.connectorId && overrides.connectorId !== thread.connectorId) {
      await this.updateThreadSettings(tenantId, userId, threadId, {
        connectorId: overrides.connectorId,
        model: overrides.model,
      })
    } else if (overrides?.model && overrides.model !== thread.model) {
      await this.prisma.aiChatThread.update({
        where: { id: threadId },
        data: { model: overrides.model },
      })
    }

    // Persist user message
    await this.prisma.aiChatMessage.create({
      data: {
        threadId,
        tenantId,
        role: 'user',
        content: content.trim(),
        sequenceNum: nextSeq,
        status: 'completed',
      },
    })

    // Build conversation history (last 20 messages)
    const recentMessages = await this.prisma.aiChatMessage.findMany({
      where: { threadId },
      orderBy: { sequenceNum: 'desc' },
      take: 20,
      select: { role: true, content: true },
    })
    const conversationHistory = recentMessages.reverse().map(m => ({
      role: m.role,
      content: m.content,
    }))

    // Execute AI call
    const startTime = Date.now()
    let responseText = ''
    let actualModel = requestedModel ?? 'unknown'
    const actualProvider = requestedProvider ?? 'unknown'
    let fallbackModel: string | null = null
    let fallbackReason: string | null = null
    let messageStatus = 'completed'
    let inputTokens = 0
    let outputTokens = 0

    try {
      const config = await this.resolveConnectorConfig(tenantId, requestedConnectorId, threadId)

      if (config) {
        const result = await this.llmApisService.invokeChat(
          config,
          conversationHistory,
          thread.maxTokens,
          requestedModel ?? undefined,
          thread.temperature,
          thread.systemPrompt ?? undefined
        )
        responseText = result.text
        actualModel = result.model ?? actualModel
        inputTokens = result.inputTokens
        outputTokens = result.outputTokens

        // Detect fallback: actual model differs from requested
        if (requestedModel && result.model && result.model !== requestedModel) {
          fallbackModel = result.model
          fallbackReason = 'Provider returned different model'
        }
      } else {
        responseText = 'No LLM connector available. Please configure one in Connectors settings.'
        messageStatus = 'failed'
        fallbackReason = 'No connector available'
      }
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : 'Unknown error'
      this.logger.warn(`Chat AI invocation failed: ${errMessage}`)
      responseText = `AI provider error: ${errMessage}`
      messageStatus = 'failed'
      fallbackReason = errMessage
    }

    const durationMs = Date.now() - startTime

    // Persist assistant response with full model attribution
    const assistantMessage = await this.prisma.aiChatMessage.create({
      data: {
        threadId,
        tenantId,
        role: 'assistant',
        content: responseText,
        requestedModel,
        requestedProvider,
        model: actualModel,
        provider: actualProvider,
        fallbackModel,
        fallbackReason,
        status: messageStatus,
        inputTokens,
        outputTokens,
        durationMs,
        sequenceNum: nextSeq + 1,
      },
    })

    // Update thread metadata
    await this.prisma.aiChatThread.update({
      where: { id: threadId },
      data: {
        messageCount: nextSeq + 1,
        totalTokensUsed: { increment: inputTokens + outputTokens },
        lastActivityAt: new Date(),
        model: actualModel,
        title: thread.title ?? this.generateTitle(content),
      },
    })

    return assistantMessage
  }

  async updateThreadSettings(
    tenantId: string,
    userId: string,
    threadId: string,
    settings: { connectorId?: string; model?: string }
  ): Promise<AiChatThread> {
    await this.verifyThreadAccess(tenantId, userId, threadId)

    const data: Record<string, unknown> = {}

    if (settings.connectorId) {
      const isUuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
        settings.connectorId
      )
      if (isUuid) {
        // Custom LLM connector
        const connector = await this.llmConnectorsService.getById(settings.connectorId, tenantId)
        data.connectorId = settings.connectorId
        data.provider = connector.name
        if (!settings.model) {
          data.model = connector.defaultModel ?? null
        }
      } else {
        // Non-UUID value (e.g. "default") — auto-select first enabled connector
        const enabledConfigs = await this.llmConnectorsService.getEnabledConfigs(tenantId)
        const first = enabledConfigs.at(0)
        if (first) {
          data.connectorId = first.id
          data.provider = first.name
          if (!settings.model) {
            data.model = (first.config.defaultModel as string) ?? null
          }
        } else {
          // No connector available — clear connector
          data.connectorId = null
          data.provider = null
        }
      }
    }

    if (settings.model) {
      data.model = settings.model
    }

    return this.prisma.aiChatThread.update({
      where: { id: threadId },
      data,
    })
  }

  async archiveThread(tenantId: string, userId: string, threadId: string): Promise<void> {
    await this.verifyThreadAccess(tenantId, userId, threadId)
    await this.prisma.aiChatThread.update({
      where: { id: threadId },
      data: { isArchived: true },
    })
  }

  /**
   * Resolves connector config from either:
   * - Custom LLM connector (UUID) via LlmConnectorsService
   * - Fixed connector (type string like "llm_apis") via ConnectorsService
   * - Auto-select first enabled if null
   */
  private async resolveConnectorConfig(
    tenantId: string,
    connectorId: string | null,
    threadId: string
  ): Promise<Record<string, unknown> | null> {
    const isUuid = connectorId
      ? /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(connectorId)
      : false

    // Case 1: Explicit custom LLM connector (UUID)
    if (connectorId && isUuid) {
      return this.llmConnectorsService.getDecryptedConfig(connectorId, tenantId)
    }

    // Case 2: Fixed connector type (e.g., "llm_apis", "bedrock")
    if (connectorId && !isUuid) {
      const fixedConfig = await this.connectorsService.getDecryptedConfig(tenantId, connectorId)
      return fixedConfig ?? null
    }

    // Case 3: No connector — auto-select first enabled custom LLM
    const enabledConfigs = await this.llmConnectorsService.getEnabledConfigs(tenantId)
    const first = enabledConfigs.at(0)
    if (first) {
      // Save resolved connector to thread for future messages
      await this.prisma.aiChatThread.update({
        where: { id: threadId },
        data: { connectorId: first.id, provider: first.name },
      })
      return first.config
    }

    // Case 4: Try fixed llm_apis connector as last resort
    const fixedLlmConfig = await this.connectorsService.getDecryptedConfig(tenantId, 'llm_apis')
    if (fixedLlmConfig) {
      await this.prisma.aiChatThread.update({
        where: { id: threadId },
        data: { connectorId: 'llm_apis', provider: 'LLM APIs' },
      })
      return fixedLlmConfig
    }

    return null
  }

  private async verifyThreadAccess(
    tenantId: string,
    userId: string,
    threadId: string
  ): Promise<AiChatThread> {
    const thread = await this.prisma.aiChatThread.findUnique({ where: { id: threadId } })
    if (!thread) {
      throw new BusinessException(404, 'Chat thread not found', 'errors.chat.threadNotFound')
    }
    if (thread.tenantId !== tenantId || thread.userId !== userId) {
      throw new BusinessException(403, 'Access denied to this chat', 'errors.chat.accessDenied')
    }
    return thread
  }

  private generateTitle(firstMessage: string): string {
    const trimmed = firstMessage.trim().substring(0, 60)
    return trimmed.length < firstMessage.trim().length ? `${trimmed}...` : trimmed
  }
}
