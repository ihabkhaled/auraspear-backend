import { Injectable, Logger } from '@nestjs/common'
import { BusinessException } from '../../common/exceptions/business.exception'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { PrismaService } from '../../prisma/prisma.service'
import type { PaginatedApplicationLogs, ApplicationLogRecord } from './app-logs.types'
import type { SearchAppLogsDto } from './dto/search-app-logs.dto'
import type { Prisma } from '@prisma/client'

@Injectable()
export class AppLogsService {
  private readonly logger = new Logger(AppLogsService.name)

  constructor(private readonly prisma: PrismaService) {}

  async search(dto: SearchAppLogsDto, scopedTenantId?: string): Promise<PaginatedApplicationLogs> {
    const where: Prisma.ApplicationLogWhereInput = {}

    // Tenant scoping: TENANT_ADMIN sees only their tenant's logs
    if (scopedTenantId) {
      where.tenantId = scopedTenantId
    } else if (dto.tenantId) {
      where.tenantId = dto.tenantId
    }

    if (dto.level) {
      // Support comma-separated levels: "info,warn,error"
      const levels = dto.level
        .split(',')
        .map(l => l.trim())
        .filter(Boolean)
      if (levels.length === 1) {
        where.level = levels[0]
      } else if (levels.length > 1) {
        where.level = { in: levels }
      }
    }

    if (dto.feature) {
      where.feature = { contains: dto.feature, mode: 'insensitive' }
    }

    if (dto.action) {
      where.action = { contains: dto.action, mode: 'insensitive' }
    }

    if (dto.functionName) {
      where.functionName = { contains: dto.functionName, mode: 'insensitive' }
    }

    if (dto.actorEmail) {
      where.actorEmail = { contains: dto.actorEmail, mode: 'insensitive' }
    }

    if (dto.actorUserId) {
      where.actorUserId = dto.actorUserId
    }

    if (dto.requestId) {
      where.requestId = dto.requestId
    }

    if (dto.sourceType) {
      where.sourceType = dto.sourceType
    }

    if (dto.outcome) {
      where.outcome = dto.outcome
    }

    if (dto.query) {
      where.message = { contains: dto.query, mode: 'insensitive' }
    }

    if (dto.from || dto.to) {
      where.createdAt = {}
      if (dto.from) {
        where.createdAt.gte = new Date(dto.from)
      }
      if (dto.to) {
        where.createdAt.lte = new Date(dto.to)
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.applicationLog.findMany({
        where,
        orderBy: this.buildOrderBy(dto.sortBy, dto.sortOrder),
        skip: (dto.page - 1) * dto.limit,
        take: dto.limit,
      }),
      this.prisma.applicationLog.count({ where }),
    ])

    return {
      data,
      pagination: buildPaginationMeta(dto.page, dto.limit, total),
    }
  }

  async findById(id: string, scopedTenantId?: string): Promise<ApplicationLogRecord> {
    const log = await this.prisma.applicationLog.findUnique({ where: { id } })

    if (!log) {
      throw new BusinessException(404, 'Application log not found', 'errors.appLogs.notFound')
    }

    // Tenant scoping enforcement
    if (scopedTenantId && log.tenantId !== scopedTenantId) {
      throw new BusinessException(403, 'Access denied to this log entry', 'errors.forbidden')
    }

    return log
  }

  private buildOrderBy(
    sortBy?: string,
    sortOrder?: string
  ): Prisma.ApplicationLogOrderByWithRelationInput {
    const order: 'asc' | 'desc' = sortOrder === 'asc' ? 'asc' : 'desc'
    switch (sortBy) {
      case 'createdAt':
        return { createdAt: order }
      case 'level':
        return { level: order }
      case 'feature':
        return { feature: order }
      case 'action':
        return { action: order }
      case 'functionName':
        return { functionName: order }
      case 'actorEmail':
        return { actorEmail: order }
      case 'className':
        return { className: order }
      case 'outcome':
        return { outcome: order }
      default:
        return { createdAt: 'desc' }
    }
  }
}
