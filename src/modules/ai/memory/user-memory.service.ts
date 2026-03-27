import { Injectable, Logger } from '@nestjs/common'
import { EmbeddingService } from './embedding.service'
import { getUserMemoryDelegate } from './memory.types'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../prisma/prisma.service'
import type { UserMemoryRecord } from './memory.types'

@Injectable()
export class UserMemoryService {
  private readonly logger = new Logger(UserMemoryService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService
  ) {}

  async listMemories(
    tenantId: string,
    userId: string,
    options?: { category?: string; search?: string; limit?: number; offset?: number }
  ): Promise<{ data: UserMemoryRecord[]; total: number }> {
    const where: Record<string, unknown> = { tenantId, userId, isDeleted: false }

    if (options?.category) {
      where['category'] = options.category
    }
    if (options?.search) {
      where['content'] = { contains: options.search, mode: 'insensitive' }
    }

    const [data, total] = await Promise.all([
      getUserMemoryDelegate(this.prisma).findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: options?.limit ?? 50,
        skip: options?.offset ?? 0,
      }),
      getUserMemoryDelegate(this.prisma).count({ where }),
    ])

    return { data, total }
  }

  async createMemory(
    tenantId: string,
    userId: string,
    input: { content: string; category?: string }
  ): Promise<UserMemoryRecord> {
    const embedding = await this.embeddingService.generateEmbedding(tenantId, input.content)

    return getUserMemoryDelegate(this.prisma).create({
      data: {
        tenantId,
        userId,
        content: input.content,
        category: input.category ?? 'fact',
        embedding,
        sourceType: 'user_edit',
      },
    })
  }

  async updateMemory(
    tenantId: string,
    userId: string,
    memoryId: string,
    input: { content: string; category?: string }
  ): Promise<UserMemoryRecord> {
    const memory = await this.verifyOwnership(tenantId, userId, memoryId)

    const embedding =
      input.content === memory.content
        ? memory.embedding
        : await this.embeddingService.generateEmbedding(tenantId, input.content)

    return getUserMemoryDelegate(this.prisma).update({
      where: { id: memoryId },
      data: {
        content: input.content,
        category: input.category ?? memory.category,
        embedding,
        sourceType: 'user_edit',
      },
    })
  }

  async deleteMemory(tenantId: string, userId: string, memoryId: string): Promise<void> {
    await this.verifyOwnership(tenantId, userId, memoryId)

    await getUserMemoryDelegate(this.prisma).update({
      where: { id: memoryId },
      data: { isDeleted: true },
    })

    this.logger.log(`Memory ${memoryId} soft-deleted by user ${userId}`)
  }

  async deleteAllMemories(tenantId: string, userId: string): Promise<number> {
    const result = await getUserMemoryDelegate(this.prisma).updateMany({
      where: { tenantId, userId, isDeleted: false },
      data: { isDeleted: true },
    })

    this.logger.log(`All memories (${String(result.count)}) soft-deleted for user ${userId}`)
    return result.count
  }

  private async verifyOwnership(
    tenantId: string,
    userId: string,
    memoryId: string
  ): Promise<UserMemoryRecord> {
    const memory = await getUserMemoryDelegate(this.prisma).findUnique({
      where: { id: memoryId },
    })

    if (!memory || memory.isDeleted) {
      throw new BusinessException(404, 'Memory not found', 'errors.memory.notFound')
    }
    if (memory.tenantId !== tenantId || memory.userId !== userId) {
      throw new BusinessException(403, 'Access denied', 'errors.memory.accessDenied')
    }

    return memory
  }
}
