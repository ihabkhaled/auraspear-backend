import { Injectable, Logger } from '@nestjs/common'
import { AiOutputFormat } from '../../../common/enums'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { buildPaginationMeta } from '../../../common/interfaces/pagination.interface'
import { PrismaService } from '../../../prisma/prisma.service'
import { LlmConnectorsService } from '../../connectors/llm-connectors/llm-connectors.service'
import { LlmApisService } from '../../connectors/services/llm-apis.service'
import type { PaginatedResponse } from '../../../common/interfaces/pagination.interface'
import type { AiChatMessage, AiChatThread } from '@prisma/client'

@Injectable()
export class AiChatService {
  private readonly logger = new Logger(AiChatService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmConnectorsService: LlmConnectorsService,
    private readonly llmApisService: LlmApisService
  ) {}

  async listThreads(
    tenantId: string,
    userId: string,
    page: number,
    limit: number
  ): Promise<PaginatedResponse<AiChatThread>> {
    const where = { tenantId, userId, isArchived: false }

    const [data, total] = await Promise.all([
      this.prisma.aiChatThread.findMany({
        where,
        orderBy: { lastActivityAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.aiChatThread.count({ where }),
    ])

    return { data, pagination: buildPaginationMeta(page, limit, total) }
  }

  async createThread(
    tenantId: string,
    userId: string,
    options: { connectorId?: string; model?: string; systemPrompt?: string }
  ): Promise<AiChatThread> {
    let provider: string | null = null
    let model: string | null = options.model ?? null

    if (options.connectorId) {
      const connector = await this.llmConnectorsService.getById(options.connectorId, tenantId)
      provider = connector.name
      if (!model) {
        model = connector.defaultModel ?? null
      }
    }

    return this.prisma.aiChatThread.create({
      data: {
        tenantId,
        userId,
        connectorId: options.connectorId ?? null,
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
    page: number,
    limit: number
  ): Promise<PaginatedResponse<AiChatMessage>> {
    await this.verifyThreadAccess(tenantId, userId, threadId)

    const where = { threadId, tenantId }
    const [data, total] = await Promise.all([
      this.prisma.aiChatMessage.findMany({
        where,
        orderBy: { sequenceNum: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.aiChatMessage.count({ where }),
    ])

    return { data: data.reverse(), pagination: buildPaginationMeta(page, limit, total) }
  }

  async sendMessage(
    tenantId: string,
    userId: string,
    threadId: string,
    content: string
  ): Promise<AiChatMessage> {
    const thread = await this.verifyThreadAccess(tenantId, userId, threadId)

    if (!content || content.trim().length === 0) {
      throw new BusinessException(400, 'Message content is required', 'errors.chat.emptyMessage')
    }

    const nextSeq = thread.messageCount + 1

    // Persist user message
    await this.prisma.aiChatMessage.create({
      data: {
        threadId,
        tenantId,
        role: 'user',
        content: content.trim(),
        sequenceNum: nextSeq,
      },
    })

    // Build conversation history for context (last 20 messages)
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

    // Get AI response from connector
    const startTime = Date.now()
    let responseText = ''
    let responseModel = thread.model ?? 'unknown'
    const responseProvider = thread.provider ?? 'unknown'
    let inputTokens = 0
    let outputTokens = 0

    try {
      if (thread.connectorId) {
        const config = await this.llmConnectorsService.getDecryptedConfig(
          thread.connectorId,
          tenantId
        )
        if (!config) {
          throw new BusinessException(
            400,
            'Connector config not available',
            'errors.chat.connectorUnavailable'
          )
        }
        const result = await this.llmApisService.invokeChat(
          config,
          conversationHistory,
          thread.maxTokens,
          thread.model ?? undefined,
          thread.temperature,
          thread.systemPrompt ?? undefined
        )
        responseText = result.text
        responseModel = result.model ?? responseModel
        inputTokens = result.inputTokens
        outputTokens = result.outputTokens
      } else {
        responseText =
          'No LLM connector configured for this chat. Please create the thread with a connector ID.'
      }
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : 'Unknown error'
      this.logger.warn(`Chat AI invocation failed: ${errMessage}`)
      responseText = `AI provider error: ${errMessage}`
    }

    const durationMs = Date.now() - startTime

    // Persist assistant response
    const assistantMessage = await this.prisma.aiChatMessage.create({
      data: {
        threadId,
        tenantId,
        role: 'assistant',
        content: responseText,
        model: responseModel,
        provider: responseProvider,
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
        title: thread.title ?? this.generateTitle(content),
      },
    })

    return assistantMessage
  }

  async archiveThread(tenantId: string, userId: string, threadId: string): Promise<void> {
    await this.verifyThreadAccess(tenantId, userId, threadId)
    await this.prisma.aiChatThread.update({
      where: { id: threadId },
      data: { isArchived: true },
    })
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
