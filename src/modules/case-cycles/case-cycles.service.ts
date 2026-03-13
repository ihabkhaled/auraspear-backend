import { Injectable, Logger } from '@nestjs/common'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import { PrismaService } from '../../prisma/prisma.service'
import type { CaseCycleDetail, CaseCycleRecord, PaginatedCaseCycles } from './case-cycles.types'
import type { CloseCaseCycleDto } from './dto/close-case-cycle.dto'
import type { CreateCaseCycleDto } from './dto/create-case-cycle.dto'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'
import type { CaseCycleStatus as PrismaCycleStatus, Prisma } from '@prisma/client'

@Injectable()
export class CaseCyclesService {
  private readonly logger = new Logger(CaseCyclesService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly appLogger: AppLoggerService
  ) {}

  /* ---------------------------------------------------------------- */
  /* LIST (paginated, tenant-scoped)                                   */
  /* ---------------------------------------------------------------- */

  async listCycles(
    tenantId: string,
    page = 1,
    limit = 20,
    sortBy?: string,
    sortOrder?: string,
    status?: string
  ): Promise<PaginatedCaseCycles> {
    const where: Prisma.CaseCycleWhereInput = { tenantId }

    if (status) {
      where.status = status as PrismaCycleStatus
    }

    try {
      const [cycles, total] = await Promise.all([
        this.prisma.caseCycle.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: this.buildOrderBy(sortBy, sortOrder),
          include: {
            _count: { select: { cases: true } },
            cases: { select: { status: true } },
          },
        }),
        this.prisma.caseCycle.count({ where }),
      ])

      const data: CaseCycleRecord[] = cycles.map(cycle => {
        const openCount = cycle.cases.filter(c => c.status !== 'closed').length
        const closedCount = cycle.cases.filter(c => c.status === 'closed').length
        const { cases: _cases, _count, ...rest } = cycle
        return {
          ...rest,
          caseCount: _count.cases,
          openCount,
          closedCount,
        }
      })

      this.appLogger.info(`Listed case cycles page=${page} total=${total}`, {
        feature: AppLogFeature.CASE_CYCLES,
        action: 'listCycles',
        outcome: AppLogOutcome.SUCCESS,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'CaseCyclesService',
        functionName: 'listCycles',
        metadata: { page, limit, total, status: status ?? null },
      })

      return {
        data,
        pagination: buildPaginationMeta(page, limit, total),
      }
    } catch (error: unknown) {
      this.appLogger.error('Failed to list case cycles', {
        feature: AppLogFeature.CASE_CYCLES,
        action: 'listCycles',
        outcome: AppLogOutcome.FAILURE,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'CaseCyclesService',
        functionName: 'listCycles',
        stackTrace: error instanceof Error ? error.stack : undefined,
      })
      throw error
    }
  }

  private buildOrderBy(
    sortBy?: string,
    sortOrder?: string
  ): Prisma.CaseCycleOrderByWithRelationInput {
    const order: 'asc' | 'desc' = sortOrder === 'asc' ? 'asc' : 'desc'
    switch (sortBy) {
      case 'name':
        return { name: order }
      case 'startDate':
        return { startDate: order }
      case 'endDate':
        return { endDate: order }
      case 'status':
        return { status: order }
      case 'createdAt':
        return { createdAt: order }
      default:
        return { createdAt: 'desc' }
    }
  }

  /* ---------------------------------------------------------------- */
  /* GET ACTIVE CYCLE                                                  */
  /* ---------------------------------------------------------------- */

  async getActiveCycle(tenantId: string): Promise<CaseCycleRecord | null> {
    const cycle = await this.prisma.caseCycle.findFirst({
      where: { tenantId, status: 'active' },
      include: {
        _count: { select: { cases: true } },
        cases: { select: { status: true } },
      },
    })

    if (!cycle) {
      this.appLogger.info('No active case cycle found', {
        feature: AppLogFeature.CASE_CYCLES,
        action: 'getActiveCycle',
        outcome: AppLogOutcome.SUCCESS,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'CaseCyclesService',
        functionName: 'getActiveCycle',
      })
      return null
    }

    const openCount = cycle.cases.filter(c => c.status !== 'closed').length
    const closedCount = cycle.cases.filter(c => c.status === 'closed').length
    const { cases: _cases, _count, ...rest } = cycle

    this.appLogger.info(`Retrieved active case cycle id=${cycle.id}`, {
      feature: AppLogFeature.CASE_CYCLES,
      action: 'getActiveCycle',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      targetResource: 'CaseCycle',
      targetResourceId: cycle.id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'CaseCyclesService',
      functionName: 'getActiveCycle',
    })

    return {
      ...rest,
      caseCount: _count.cases,
      openCount,
      closedCount,
    }
  }

  /* ---------------------------------------------------------------- */
  /* GET BY ID (detail with cases)                                     */
  /* ---------------------------------------------------------------- */

  async getCycleById(id: string, tenantId: string): Promise<CaseCycleDetail> {
    const cycle = await this.prisma.caseCycle.findFirst({
      where: { id, tenantId },
      include: {
        _count: { select: { cases: true } },
        cases: {
          orderBy: { createdAt: 'desc' },
          include: { tenant: { select: { name: true } } },
        },
      },
    })

    if (!cycle) {
      this.appLogger.warn(`Case cycle not found id=${id}`, {
        feature: AppLogFeature.CASE_CYCLES,
        action: 'getCycleById',
        outcome: AppLogOutcome.FAILURE,
        tenantId,
        targetResource: 'CaseCycle',
        targetResourceId: id,
        sourceType: AppLogSourceType.SERVICE,
        className: 'CaseCyclesService',
        functionName: 'getCycleById',
      })
      throw new BusinessException(404, `Case cycle ${id} not found`, 'errors.caseCycles.notFound')
    }

    // Resolve case owners in batch
    const ownerIds = cycle.cases.map(c => c.ownerUserId).filter((id): id is string => id !== null)
    const uniqueOwnerIds = [...new Set(ownerIds)]

    const ownerMap = new Map<string, { name: string; email: string }>()
    if (uniqueOwnerIds.length > 0) {
      const owners = await this.prisma.user.findMany({
        where: { id: { in: uniqueOwnerIds } },
        select: { id: true, name: true, email: true },
      })
      for (const o of owners) {
        ownerMap.set(o.id, { name: o.name, email: o.email })
      }
    }

    const openCount = cycle.cases.filter(c => c.status !== 'closed').length
    const closedCount = cycle.cases.filter(c => c.status === 'closed').length

    const casesWithOwners = cycle.cases.map(c => {
      const owner = c.ownerUserId ? ownerMap.get(c.ownerUserId) : undefined
      const { tenant: _tenant, ...caseData } = c
      return {
        ...caseData,
        ownerName: owner?.name ?? null,
        ownerEmail: owner?.email ?? null,
      }
    })

    const { cases: _cases, _count, ...rest } = cycle

    this.appLogger.info(`Retrieved case cycle detail id=${id}`, {
      feature: AppLogFeature.CASE_CYCLES,
      action: 'getCycleById',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      targetResource: 'CaseCycle',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'CaseCyclesService',
      functionName: 'getCycleById',
      metadata: { caseCount: _count.cases, openCount, closedCount },
    })

    return {
      ...rest,
      cases: casesWithOwners,
      caseCount: _count.cases,
      openCount,
      closedCount,
    }
  }

  /* ---------------------------------------------------------------- */
  /* CREATE                                                            */
  /* ---------------------------------------------------------------- */

  async createCycle(dto: CreateCaseCycleDto, user: JwtPayload): Promise<CaseCycleRecord> {
    // Check if there's already an active cycle for this tenant
    const existingActive = await this.prisma.caseCycle.findFirst({
      where: { tenantId: user.tenantId, status: 'active' },
      select: { id: true, name: true },
    })

    if (existingActive) {
      this.appLogger.warn(
        `Cannot create cycle: active cycle "${existingActive.name}" already exists`,
        {
          feature: AppLogFeature.CASE_CYCLES,
          action: 'createCycle',
          outcome: AppLogOutcome.DENIED,
          tenantId: user.tenantId,
          actorEmail: user.email,
          actorUserId: user.sub,
          sourceType: AppLogSourceType.SERVICE,
          className: 'CaseCyclesService',
          functionName: 'createCycle',
          metadata: { existingCycleId: existingActive.id, existingCycleName: existingActive.name },
        }
      )
      throw new BusinessException(
        409,
        `An active cycle "${existingActive.name}" already exists. Close it before creating a new one.`,
        'errors.caseCycles.activeAlreadyExists'
      )
    }

    const cycle = await this.prisma.caseCycle.create({
      data: {
        tenantId: user.tenantId,
        name: dto.name,
        description: dto.description ?? null,
        status: 'active',
        startDate: dto.startDate,
        endDate: dto.endDate ?? null,
        createdBy: user.email,
      },
    })

    this.logger.log(
      `Case cycle "${cycle.name}" created by ${user.email} for tenant ${user.tenantId}`
    )

    this.appLogger.info(`Created case cycle "${cycle.name}"`, {
      feature: AppLogFeature.CASE_CYCLES,
      action: 'createCycle',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'CaseCycle',
      targetResourceId: cycle.id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'CaseCyclesService',
      functionName: 'createCycle',
      metadata: { cycleName: cycle.name },
    })

    return {
      ...cycle,
      caseCount: 0,
      openCount: 0,
      closedCount: 0,
    }
  }

  /* ---------------------------------------------------------------- */
  /* CLOSE                                                             */
  /* ---------------------------------------------------------------- */

  async closeCycle(id: string, dto: CloseCaseCycleDto, user: JwtPayload): Promise<CaseCycleRecord> {
    const existing = await this.prisma.caseCycle.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        _count: { select: { cases: true } },
        cases: { select: { status: true } },
      },
    })

    if (!existing) {
      this.appLogger.warn(`Case cycle not found for close id=${id}`, {
        feature: AppLogFeature.CASE_CYCLES,
        action: 'closeCycle',
        outcome: AppLogOutcome.FAILURE,
        tenantId: user.tenantId,
        actorEmail: user.email,
        actorUserId: user.sub,
        targetResource: 'CaseCycle',
        targetResourceId: id,
        sourceType: AppLogSourceType.SERVICE,
        className: 'CaseCyclesService',
        functionName: 'closeCycle',
      })
      throw new BusinessException(404, `Case cycle ${id} not found`, 'errors.caseCycles.notFound')
    }

    if (existing.status === 'closed') {
      this.appLogger.warn(`Cannot close already closed cycle id=${id}`, {
        feature: AppLogFeature.CASE_CYCLES,
        action: 'closeCycle',
        outcome: AppLogOutcome.DENIED,
        tenantId: user.tenantId,
        actorEmail: user.email,
        actorUserId: user.sub,
        targetResource: 'CaseCycle',
        targetResourceId: id,
        sourceType: AppLogSourceType.SERVICE,
        className: 'CaseCyclesService',
        functionName: 'closeCycle',
      })
      throw new BusinessException(
        400,
        'This cycle is already closed',
        'errors.caseCycles.alreadyClosed'
      )
    }

    const now = new Date()
    const updated = await this.prisma.caseCycle.update({
      where: { id },
      data: {
        status: 'closed',
        closedBy: user.email,
        closedAt: now,
        endDate: dto.endDate ?? now,
      },
    })

    const openCount = existing.cases.filter(c => c.status !== 'closed').length
    const closedCount = existing.cases.filter(c => c.status === 'closed').length

    this.logger.log(`Case cycle "${existing.name}" closed by ${user.email}`)

    this.appLogger.info(`Closed case cycle "${existing.name}"`, {
      feature: AppLogFeature.CASE_CYCLES,
      action: 'closeCycle',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'CaseCycle',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'CaseCyclesService',
      functionName: 'closeCycle',
      metadata: {
        cycleName: existing.name,
        caseCount: existing._count.cases,
        openCount,
        closedCount,
      },
    })

    return {
      ...updated,
      caseCount: existing._count.cases,
      openCount,
      closedCount,
    }
  }
}
