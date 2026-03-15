import { Injectable, Logger } from '@nestjs/common'
import { AuditLogsRepository } from './audit-logs.repository'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../common/enums'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
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

  constructor(
    private readonly auditLogsRepository: AuditLogsRepository,
    private readonly appLogger: AppLoggerService
  ) {}

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

    try {
      const [data, total] = await this.auditLogsRepository.findManyAndCount({
        where,
        orderBy: this.buildOrderBy(query.sortBy, query.sortOrder),
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      })

      this.appLogger.info(`Searched audit logs page=${query.page} total=${total}`, {
        feature: AppLogFeature.SYSTEM,
        action: 'search',
        outcome: AppLogOutcome.SUCCESS,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AuditLogsService',
        functionName: 'search',
        metadata: {
          page: query.page,
          limit: query.limit,
          total,
          actor: query.actor ?? null,
          filterAction: query.action ?? null,
          resource: query.resource ?? null,
        },
      })

      return {
        data,
        pagination: buildPaginationMeta(query.page, query.limit, total),
      }
    } catch (error: unknown) {
      this.appLogger.error('Failed to search audit logs', {
        feature: AppLogFeature.SYSTEM,
        action: 'search',
        outcome: AppLogOutcome.FAILURE,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AuditLogsService',
        functionName: 'search',
        stackTrace: error instanceof Error ? error.stack : undefined,
      })
      throw error
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
    try {
      const entry = await this.auditLogsRepository.create({
        tenantId: data.tenantId,
        actor: data.actor,
        role: data.role,
        action: data.action,
        resource: data.resource,
        resourceId: data.resourceId ?? null,
        details: data.details ?? null,
        ipAddress: data.ipAddress ?? null,
      })

      this.logger.log(
        `Audit log created: ${data.action} on ${data.resource} by ${data.actor} in tenant ${data.tenantId}`
      )

      this.appLogger.info(`Created audit log: ${data.action} on ${data.resource}`, {
        feature: AppLogFeature.SYSTEM,
        action: 'create',
        outcome: AppLogOutcome.SUCCESS,
        tenantId: data.tenantId,
        actorEmail: data.actor,
        targetResource: data.resource,
        targetResourceId: data.resourceId ?? undefined,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AuditLogsService',
        functionName: 'create',
        metadata: { auditAction: data.action, role: data.role },
      })

      return entry
    } catch (error: unknown) {
      this.appLogger.error(`Failed to create audit log: ${data.action} on ${data.resource}`, {
        feature: AppLogFeature.SYSTEM,
        action: 'create',
        outcome: AppLogOutcome.FAILURE,
        tenantId: data.tenantId,
        actorEmail: data.actor,
        targetResource: data.resource,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AuditLogsService',
        functionName: 'create',
        stackTrace: error instanceof Error ? error.stack : undefined,
      })
      throw error
    }
  }
}
