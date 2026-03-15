import { Injectable, Logger } from '@nestjs/common'
import { CaseCyclesRepository } from './case-cycles.repository'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import type { CaseCycleDetail, CaseCycleRecord, PaginatedCaseCycles } from './case-cycles.types'
import type { CloseCaseCycleDto } from './dto/close-case-cycle.dto'
import type { CreateCaseCycleDto } from './dto/create-case-cycle.dto'
import type { UpdateCaseCycleDto } from './dto/update-case-cycle.dto'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'
import type { CaseCycleStatus as PrismaCycleStatus, Prisma } from '@prisma/client'

@Injectable()
export class CaseCyclesService {
  private readonly logger = new Logger(CaseCyclesService.name)

  constructor(
    private readonly caseCyclesRepository: CaseCyclesRepository,
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
      const [cycles, total] = await this.caseCyclesRepository.findManyWithCasesAndCount({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: this.buildOrderBy(sortBy, sortOrder),
      })

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

  /* ---------------------------------------------------------------- */
  /* ORPHANED STATS (cases with no cycle)                              */
  /* ---------------------------------------------------------------- */

  async getOrphanedStats(
    tenantId: string
  ): Promise<{ caseCount: number; openCount: number; closedCount: number }> {
    const [total, openCases, closedCases] =
      await this.caseCyclesRepository.countOrphanedCases(tenantId)

    return { caseCount: total, openCount: openCases, closedCount: closedCases }
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
    const cycle = await this.caseCyclesRepository.findFirstActive(tenantId)

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
    const cycle = await this.caseCyclesRepository.findFirstByIdAndTenantWithCases(id, tenantId)

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
    const ownerIds = cycle.cases
      .map(c => c.ownerUserId)
      .filter((ownerId): ownerId is string => ownerId !== null)
    const uniqueOwnerIds = [...new Set(ownerIds)]

    const ownerMap = new Map<string, { name: string; email: string }>()
    if (uniqueOwnerIds.length > 0) {
      const owners = await this.caseCyclesRepository.findUsersByIds(uniqueOwnerIds)
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
    // Validate start < end if endDate provided
    if (dto.endDate && dto.startDate >= dto.endDate) {
      throw new BusinessException(
        400,
        'Start date must be before end date',
        'errors.caseCycles.startAfterEnd'
      )
    }

    // Check for overlapping cycles (exclude closed cycles)
    await this.checkDateOverlap(user.tenantId, dto.startDate, dto.endDate ?? null)

    // Create as closed — user must explicitly activate
    const cycle = await this.caseCyclesRepository.create({
      tenantId: user.tenantId,
      name: dto.name,
      description: dto.description ?? null,
      status: 'closed',
      startDate: dto.startDate,
      endDate: dto.endDate ?? null,
      createdBy: user.email,
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
  /* UPDATE                                                            */
  /* ---------------------------------------------------------------- */

  async updateCycle(
    id: string,
    dto: UpdateCaseCycleDto,
    user: JwtPayload
  ): Promise<CaseCycleRecord> {
    const existing = await this.caseCyclesRepository.findFirstByIdAndTenantWithCounts(
      id,
      user.tenantId
    )

    if (!existing) {
      throw new BusinessException(404, `Case cycle ${id} not found`, 'errors.caseCycles.notFound')
    }

    const startDate = dto.startDate ?? existing.startDate
    const endDate = dto.endDate === undefined ? existing.endDate : dto.endDate

    // Validate start < end
    if (endDate && startDate >= endDate) {
      throw new BusinessException(
        400,
        'Start date must be before end date',
        'errors.caseCycles.startAfterEnd'
      )
    }

    // Check overlap if dates changed (exclude self)
    if (dto.startDate !== undefined || dto.endDate !== undefined) {
      await this.checkDateOverlap(user.tenantId, startDate, endDate ?? null, id)
    }

    // If active and dates changed such that today is outside range, auto-deactivate
    const updateData: Record<string, unknown> = {}
    if (dto.name !== undefined) updateData.name = dto.name
    if (dto.description !== undefined) updateData.description = dto.description
    if (dto.startDate !== undefined) updateData.startDate = dto.startDate
    if (dto.endDate !== undefined) updateData.endDate = dto.endDate

    if (
      existing.status === 'active' &&
      (dto.startDate !== undefined || dto.endDate !== undefined)
    ) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const isInRange = startDate <= today && (endDate === null || endDate >= today)
      if (!isInRange) {
        updateData.status = 'closed'
        updateData.closedAt = new Date()
        updateData.closedBy = user.email
      }
    }

    const updated = await this.caseCyclesRepository.update(id, updateData)

    const openCount = existing.cases.filter(c => c.status !== 'closed').length
    const closedCount = existing.cases.filter(c => c.status === 'closed').length

    this.appLogger.info(`Updated case cycle "${existing.name}"`, {
      feature: AppLogFeature.CASE_CYCLES,
      action: 'updateCycle',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'CaseCycle',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'CaseCyclesService',
      functionName: 'updateCycle',
      metadata: {
        updatedFields: Object.keys(dto),
        autoDeactivated: updateData.status === 'closed',
      },
    })

    return {
      ...updated,
      caseCount: existing._count.cases,
      openCount,
      closedCount,
    }
  }

  /* ---------------------------------------------------------------- */
  /* ACTIVATE                                                          */
  /* ---------------------------------------------------------------- */

  async activateCycle(id: string, user: JwtPayload): Promise<CaseCycleRecord> {
    const existing = await this.caseCyclesRepository.findFirstByIdAndTenantWithCounts(
      id,
      user.tenantId
    )

    if (!existing) {
      throw new BusinessException(404, `Case cycle ${id} not found`, 'errors.caseCycles.notFound')
    }

    if (existing.status === 'active') {
      throw new BusinessException(
        400,
        'This cycle is already active',
        'errors.caseCycles.alreadyActive'
      )
    }

    // Check today is within the cycle's date range
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (existing.startDate > today) {
      throw new BusinessException(
        400,
        'Cannot activate: cycle start date is in the future',
        'errors.caseCycles.activationOutsideRange'
      )
    }
    if (existing.endDate && existing.endDate < today) {
      throw new BusinessException(
        400,
        'Cannot activate: cycle end date has passed',
        'errors.caseCycles.activationOutsideRange'
      )
    }

    // Atomically deactivate any currently active cycle and activate this one
    const result = await this.caseCyclesRepository.activateCycleTransaction(
      id,
      user.tenantId,
      user.email
    )

    const openCount = existing.cases.filter(c => c.status !== 'closed').length
    const closedCount = existing.cases.filter(c => c.status === 'closed').length

    this.appLogger.info(`Activated case cycle "${existing.name}"`, {
      feature: AppLogFeature.CASE_CYCLES,
      action: 'activateCycle',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'CaseCycle',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'CaseCyclesService',
      functionName: 'activateCycle',
    })

    return {
      ...result,
      caseCount: existing._count.cases,
      openCount,
      closedCount,
    }
  }

  /* ---------------------------------------------------------------- */
  /* DELETE                                                            */
  /* ---------------------------------------------------------------- */

  async deleteCycle(id: string, user: JwtPayload): Promise<{ deleted: boolean }> {
    const existing = await this.caseCyclesRepository.findFirstByIdAndTenantWithCaseCount(
      id,
      user.tenantId
    )

    if (!existing) {
      throw new BusinessException(404, `Case cycle ${id} not found`, 'errors.caseCycles.notFound')
    }

    if (existing.status === 'active') {
      throw new BusinessException(
        400,
        'Cannot delete an active cycle. Close it first.',
        'errors.caseCycles.deleteActiveNotAllowed'
      )
    }

    if (existing._count.cases > 0) {
      // Unlink cases from this cycle (set cycleId to null) then delete
      await this.caseCyclesRepository.deleteCycleWithCasesTransaction(id, user.tenantId)
    } else {
      await this.caseCyclesRepository.deleteCycle(id)
    }

    this.appLogger.info(`Deleted case cycle "${existing.name}"`, {
      feature: AppLogFeature.CASE_CYCLES,
      action: 'deleteCycle',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'CaseCycle',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'CaseCyclesService',
      functionName: 'deleteCycle',
      metadata: { cycleName: existing.name, casesUnlinked: existing._count.cases },
    })

    return { deleted: true }
  }

  /* ---------------------------------------------------------------- */
  /* CLOSE                                                             */
  /* ---------------------------------------------------------------- */

  async closeCycle(id: string, dto: CloseCaseCycleDto, user: JwtPayload): Promise<CaseCycleRecord> {
    const existing = await this.caseCyclesRepository.findFirstByIdAndTenantWithCounts(
      id,
      user.tenantId
    )

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
    const updated = await this.caseCyclesRepository.update(id, {
      status: 'closed',
      closedBy: user.email,
      closedAt: now,
      endDate: dto.endDate ?? now,
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

  /* ---------------------------------------------------------------- */
  /* OVERLAP CHECK (private)                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Checks if a new/updated cycle's date range overlaps with any existing
   * non-closed cycle for the tenant. Adjacent ranges (end === start of another)
   * are allowed. Only true overlaps are rejected.
   *
   * @param excludeId - Exclude a specific cycle (for update scenarios)
   */
  private async checkDateOverlap(
    tenantId: string,
    startDate: Date,
    endDate: Date | null,
    excludeId?: string
  ): Promise<void> {
    // Fetch all cycles for tenant (excluding the one being edited)
    const where: Prisma.CaseCycleWhereInput = { tenantId }
    if (excludeId) {
      where.id = { not: excludeId }
    }

    const cycles = await this.caseCyclesRepository.findManyForOverlapCheck(where)

    for (const cycle of cycles) {
      if (this.datesOverlap(startDate, endDate, cycle.startDate, cycle.endDate)) {
        this.appLogger.warn(`Cycle date range overlaps with "${cycle.name}"`, {
          feature: AppLogFeature.CASE_CYCLES,
          action: 'checkDateOverlap',
          outcome: AppLogOutcome.DENIED,
          tenantId,
          sourceType: AppLogSourceType.SERVICE,
          className: 'CaseCyclesService',
          functionName: 'checkDateOverlap',
          metadata: { overlappingCycleId: cycle.id, overlappingCycleName: cycle.name },
        })
        throw new BusinessException(
          409,
          `Date range overlaps with existing cycle "${cycle.name}"`,
          'errors.caseCycles.dateOverlap'
        )
      }
    }
  }

  /**
   * Two date ranges overlap if:
   * range1.start < range2.end AND range2.start < range1.end
   *
   * If either range has no endDate, it's treated as open-ended (infinite).
   * Adjacent (same-day boundaries) are allowed: start1 === end2 is NOT overlap.
   */
  private datesOverlap(start1: Date, end1: Date | null, start2: Date, end2: Date | null): boolean {
    // If range1 starts at or after range2 ends → no overlap
    if (end2 && start1 >= end2) return false
    // If range2 starts at or after range1 ends → no overlap
    if (end1 && start2 >= end1) return false
    // Otherwise they overlap
    return true
  }
}
