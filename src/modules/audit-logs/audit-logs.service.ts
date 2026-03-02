import { Injectable, Logger } from '@nestjs/common'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { PrismaService } from '../../prisma/prisma.service'
import type { AuditLogRecord, PaginatedAuditLogs } from './audit-logs.types'
import type { SearchAuditLogsDto } from './dto/search-audit-logs.dto'
import type { UserRole } from '../../common/interfaces/authenticated-request.interface'
import type { Prisma } from '@prisma/client'

export interface CreateAuditLogData {
  tenantId: string
  actor: string
  role: UserRole
  action: string
  resource: string
  resourceId?: string | null
  details?: string | null
  ipAddress?: string | null
}

@Injectable()
export class AuditLogsService {
  private readonly logger = new Logger(AuditLogsService.name)

  constructor(private readonly prisma: PrismaService) {}

  async search(tenantId: string, query: SearchAuditLogsDto): Promise<PaginatedAuditLogs> {
    const where: Prisma.AuditLogWhereInput = { tenantId }

    if (query.actor) {
      where.actor = { contains: query.actor, mode: 'insensitive' }
    }

    if (query.action) {
      where.action = query.action
    }

    if (query.resource) {
      where.resource = query.resource
    }

    if (query.from || query.to) {
      where.createdAt = {}
      if (query.from) {
        where.createdAt.gte = new Date(query.from)
      }
      if (query.to) {
        where.createdAt.lte = new Date(query.to)
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: this.buildOrderBy(query.sortBy, query.sortOrder),
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ])

    return {
      data,
      pagination: buildPaginationMeta(query.page, query.limit, total),
    }
  }

  private buildOrderBy(
    sortBy?: string,
    sortOrder?: string
  ): Prisma.AuditLogOrderByWithRelationInput {
    const order: 'asc' | 'desc' = sortOrder === 'asc' ? 'asc' : 'desc'
    switch (sortBy) {
      case 'createdAt':
        return { createdAt: order }
      case 'actor':
        return { actor: order }
      case 'action':
        return { action: order }
      case 'resource':
        return { resource: order }
      default:
        return { createdAt: 'desc' }
    }
  }

  async create(data: CreateAuditLogData): Promise<AuditLogRecord> {
    const entry = await this.prisma.auditLog.create({
      data: {
        tenantId: data.tenantId,
        actor: data.actor,
        role: data.role,
        action: data.action,
        resource: data.resource,
        resourceId: data.resourceId ?? null,
        details: data.details ?? null,
        ipAddress: data.ipAddress ?? null,
      },
    })

    this.logger.log(
      `Audit log created: ${data.action} on ${data.resource} by ${data.actor} in tenant ${data.tenantId}`
    )

    return entry
  }
}
