import { Injectable } from '@nestjs/common'
import {
  buildPaginationMeta,
  type PaginatedResponse,
} from '../../../common/interfaces/pagination.interface'
import { PrismaService } from '../../../prisma/prisma.service'
import type { ListFindingsQueryDto } from './dto/list-findings-query.dto'
import type { AiExecutionFinding } from '@prisma/client'

@Injectable()
export class AiWritebackRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listFindings(
    tenantId: string,
    dto: ListFindingsQueryDto
  ): Promise<PaginatedResponse<AiExecutionFinding>> {
    const {
      page,
      limit,
      sortBy,
      sortOrder,
      sourceModule,
      agentId,
      status,
      findingType,
      sourceEntityId,
      query,
    } = dto

    const where: Record<string, unknown> = { tenantId }

    if (sourceModule) {
      where['sourceModule'] = sourceModule
    }
    if (agentId) {
      where['agentId'] = agentId
    }
    if (status) {
      where['status'] = status
    }
    if (findingType) {
      where['findingType'] = findingType
    }
    if (sourceEntityId) {
      where['sourceEntityId'] = sourceEntityId
    }
    if (query) {
      where['OR'] = [
        { title: { contains: query, mode: 'insensitive' } },
        { summary: { contains: query, mode: 'insensitive' } },
      ]
    }

    const [data, total] = await Promise.all([
      this.prisma.aiExecutionFinding.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.aiExecutionFinding.count({ where }),
    ])

    return {
      data,
      pagination: buildPaginationMeta(page, limit, total),
    }
  }

  async getFindingById(tenantId: string, id: string): Promise<AiExecutionFinding | null> {
    return this.prisma.aiExecutionFinding.findFirst({
      where: { id, tenantId },
    })
  }

  async findingsByEntity(
    tenantId: string,
    entityType: string,
    entityId: string
  ): Promise<AiExecutionFinding[]> {
    return this.prisma.aiExecutionFinding.findMany({
      where: {
        tenantId,
        sourceModule: entityType,
        sourceEntityId: entityId,
      },
      orderBy: { createdAt: 'desc' },
    })
  }
}
