import { Injectable, Logger } from '@nestjs/common'
import {
  AppLogFeature,
  AppLogOutcome,
  AppLogSourceType,
  CaseTimelineType,
} from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { MembershipStatus, UserRole } from '../../common/interfaces/authenticated-request.interface'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import { hasRoleAtLeast } from '../../common/utils/role.util'
import { PrismaService } from '../../prisma/prisma.service'
import type { CaseRecord, PaginatedCaseNotes, PaginatedCases } from './cases.types'
import type { CreateArtifactDto } from './dto/create-artifact.dto'
import type { CreateCaseDto } from './dto/create-case.dto'
import type { CreateNoteDto } from './dto/create-note.dto'
import type { CreateTaskDto } from './dto/create-task.dto'
import type { LinkAlertDto } from './dto/link-alert.dto'
import type { UpdateCaseDto } from './dto/update-case.dto'
import type { UpdateTaskDto } from './dto/update-task.dto'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'
import type { CaseNote, CaseStatus, CaseSeverity, Prisma } from '@prisma/client'

@Injectable()
export class CasesService {
  private readonly logger = new Logger(CasesService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly appLogger: AppLoggerService
  ) {}

  private async resolveOwner(
    ownerUserId: string | null
  ): Promise<{ ownerName: string | null; ownerEmail: string | null }> {
    if (!ownerUserId) {
      return { ownerName: null, ownerEmail: null }
    }
    const owner = await this.prisma.user.findUnique({
      where: { id: ownerUserId },
      select: { name: true, email: true },
    })
    return {
      ownerName: owner?.name ?? null,
      ownerEmail: owner?.email ?? null,
    }
  }

  private async resolveCreatorName(email: string | null): Promise<string | null> {
    if (!email) return null
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { name: true },
    })
    return user?.name ?? null
  }

  private async resolveCreatorNamesBatch(emails: (string | null)[]): Promise<Map<string, string>> {
    const uniqueEmails = [...new Set(emails.filter((e): e is string => e !== null))]
    if (uniqueEmails.length === 0) return new Map()
    const users = await this.prisma.user.findMany({
      where: { email: { in: uniqueEmails } },
      select: { email: true, name: true },
    })
    const map = new Map<string, string>()
    for (const u of users) {
      map.set(u.email, u.name)
    }
    return map
  }

  private async resolveOwnersBatch(
    ownerUserIds: (string | null)[]
  ): Promise<Map<string, { name: string; email: string }>> {
    const ids = [...new Set(ownerUserIds.filter((id): id is string => id !== null))]
    if (ids.length === 0) {
      return new Map()
    }
    const owners = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, email: true },
    })
    const map = new Map<string, { name: string; email: string }>()
    for (const o of owners) {
      map.set(o.id, { name: o.name, email: o.email })
    }
    return map
  }

  /* ---------------------------------------------------------------- */
  /* LIST (paginated, tenant-scoped)                                   */
  /* ---------------------------------------------------------------- */

  async listCases(
    tenantId: string,
    page = 1,
    limit = 20,
    sortBy?: string,
    sortOrder?: string,
    status?: string,
    severity?: string,
    query?: string,
    cycleId?: string,
    ownerUserId?: string
  ): Promise<PaginatedCases> {
    const where: Prisma.CaseWhereInput = { tenantId }

    if (status) {
      where.status = status as CaseStatus
    }

    if (severity) {
      where.severity = severity as CaseSeverity
    }

    if (cycleId === 'none') {
      where.cycleId = null
    } else if (cycleId) {
      where.cycleId = cycleId
    }

    if (ownerUserId) {
      where.ownerUserId = ownerUserId
    }

    if (query && query.trim().length > 0) {
      where.OR = [
        { title: { contains: query, mode: 'insensitive' } },
        { caseNumber: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
      ]
    }

    const [cases, total] = await Promise.all([
      this.prisma.case.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: this.buildCaseOrderBy(sortBy, sortOrder),
        include: { tenant: { select: { name: true } } },
      }),
      this.prisma.case.count({ where }),
    ])

    const [ownersMap, creatorsMap] = await Promise.all([
      this.resolveOwnersBatch(cases.map(c => c.ownerUserId)),
      this.resolveCreatorNamesBatch(cases.map(c => c.createdBy)),
    ])

    const data = cases.map(c => {
      const owner = c.ownerUserId ? ownersMap.get(c.ownerUserId) : undefined
      return {
        ...c,
        ownerName: owner?.name ?? null,
        ownerEmail: owner?.email ?? null,
        createdByName: c.createdBy ? (creatorsMap.get(c.createdBy) ?? null) : null,
        tenantName: c.tenant.name,
      }
    })

    return {
      data,
      pagination: buildPaginationMeta(page, limit, total),
    }
  }

  private buildCaseOrderBy(
    sortBy?: string,
    sortOrder?: string
  ): Prisma.CaseOrderByWithRelationInput {
    const order: 'asc' | 'desc' = sortOrder === 'asc' ? 'asc' : 'desc'
    switch (sortBy) {
      case 'createdAt':
        return { createdAt: order }
      case 'updatedAt':
        return { updatedAt: order }
      case 'severity':
        return { severity: order }
      case 'status':
        return { status: order }
      case 'caseNumber':
        return { caseNumber: order }
      case 'title':
        return { title: order }
      default:
        return { createdAt: 'desc' }
    }
  }

  /* ---------------------------------------------------------------- */
  /* CREATE                                                            */
  /* ---------------------------------------------------------------- */

  async createCase(dto: CreateCaseDto, user: JwtPayload): Promise<CaseRecord> {
    const linkedAlerts = dto.linkedAlertIds ?? []

    if (dto.ownerUserId) {
      await this.validateOwnerInTenant(dto.ownerUserId, user.tenantId)
    }

    // M5: Validate linkedAlertIds belong to the same tenant
    if (linkedAlerts.length > 0) {
      const validAlerts = await this.prisma.alert.count({
        where: { id: { in: linkedAlerts }, tenantId: user.tenantId },
      })
      if (validAlerts !== linkedAlerts.length) {
        this.appLogger.warn('Invalid linked alerts: some do not belong to tenant', {
          feature: AppLogFeature.CASES,
          action: 'createCase',
          className: 'CasesService',
          sourceType: AppLogSourceType.SERVICE,
          outcome: AppLogOutcome.FAILURE,
          tenantId: user.tenantId,
          actorEmail: user.email,
          metadata: { linkedAlertIds: linkedAlerts, validCount: validAlerts },
        })
        throw new BusinessException(
          400,
          'One or more linked alerts do not belong to this tenant',
          'errors.cases.invalidLinkedAlerts'
        )
      }
    }

    const result = await this.prisma.$transaction(async tx => {
      // Use provided cycleId, or auto-assign to active cycle if one exists
      let resolvedCycleId: string | null = null
      if (dto.cycleId) {
        // Validate the provided cycle belongs to the tenant
        const cycle = await tx.caseCycle.findFirst({
          where: { id: dto.cycleId, tenantId: user.tenantId },
          select: { id: true },
        })
        if (!cycle) {
          throw new BusinessException(
            400,
            'The specified cycle does not belong to this tenant',
            'errors.cases.invalidCycle'
          )
        }
        resolvedCycleId = dto.cycleId
      } else {
        const activeCycle = await tx.caseCycle.findFirst({
          where: { tenantId: user.tenantId, status: 'active' },
          select: { id: true },
        })
        resolvedCycleId = activeCycle?.id ?? null
      }

      const caseNumber = await this.generateCaseNumber(tx)
      const newCase = await tx.case.create({
        data: {
          tenantId: user.tenantId,
          caseNumber,
          title: dto.title,
          description: dto.description,
          severity: dto.severity,
          status: 'open',
          ownerUserId: dto.ownerUserId ?? null,
          createdBy: user.email,
          cycleId: resolvedCycleId,
          ...(linkedAlerts.length > 0 ? { linkedAlerts } : {}),
        },
      })

      await tx.caseTimeline.create({
        data: {
          caseId: newCase.id,
          type: CaseTimelineType.CREATED,
          actor: user.email,
          description: `Case ${caseNumber} created: ${dto.title}`,
        },
      })

      if (linkedAlerts.length > 0) {
        await tx.caseTimeline.create({
          data: {
            caseId: newCase.id,
            type: CaseTimelineType.ALERT_LINKED,
            actor: user.email,
            description: `${linkedAlerts.length} alert(s) linked at creation`,
          },
        })
      }

      return tx.case.findUniqueOrThrow({
        where: { id: newCase.id },
        include: {
          notes: true,
          timeline: { orderBy: { timestamp: 'asc' } },
          tasks: true,
          artifacts: true,
          tenant: { select: { name: true } },
        },
      })
    })

    this.appLogger.info('Case created', {
      feature: AppLogFeature.CASES,
      action: 'createCase',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'Case',
      targetResourceId: result.id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'CasesService',
      functionName: 'createCase',
      metadata: { caseNumber: result.caseNumber, severity: result.severity },
    })

    const [{ ownerName, ownerEmail }, createdByName] = await Promise.all([
      this.resolveOwner(result.ownerUserId),
      this.resolveCreatorName(result.createdBy),
    ])
    return { ...result, ownerName, ownerEmail, createdByName, tenantName: result.tenant.name }
  }

  /* ---------------------------------------------------------------- */
  /* GET BY ID                                                         */
  /* ---------------------------------------------------------------- */

  async getCaseById(id: string, tenantId: string): Promise<CaseRecord> {
    const caseRecord = await this.prisma.case.findFirst({
      where: { id, tenantId },
      include: {
        notes: { orderBy: { createdAt: 'asc' } },
        timeline: { orderBy: { timestamp: 'asc' } },
        tasks: true,
        artifacts: true,
        tenant: { select: { name: true } },
      },
    })

    if (!caseRecord) {
      this.appLogger.warn('Case not found', {
        feature: AppLogFeature.CASES,
        action: 'getCaseById',
        className: 'CasesService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { caseId: id, tenantId },
      })
      throw new BusinessException(404, `Case ${id} not found`, 'errors.cases.notFound')
    }

    const [{ ownerName, ownerEmail }, createdByName] = await Promise.all([
      this.resolveOwner(caseRecord.ownerUserId),
      this.resolveCreatorName(caseRecord.createdBy),
    ])
    return {
      ...caseRecord,
      ownerName,
      ownerEmail,
      createdByName,
      tenantName: caseRecord.tenant.name,
    }
  }

  /* ---------------------------------------------------------------- */
  /* UPDATE                                                            */
  /* ---------------------------------------------------------------- */

  async updateCase(id: string, dto: UpdateCaseDto, user: JwtPayload): Promise<CaseRecord> {
    const existing = await this.getCaseById(id, user.tenantId)

    // Allow re-opening and assignee changes on closed cases, block other updates
    const isReopening =
      existing.status === 'closed' && dto.status !== undefined && dto.status !== 'closed'
    const isAssigneeChange = dto.ownerUserId !== undefined
    if (existing.status === 'closed' && !isReopening && !isAssigneeChange) {
      this.appLogger.warn('Update case denied: case is closed', {
        feature: AppLogFeature.CASES,
        action: 'updateCase',
        outcome: AppLogOutcome.DENIED,
        tenantId: user.tenantId,
        actorEmail: user.email,
        targetResource: 'Case',
        targetResourceId: id,
        sourceType: AppLogSourceType.SERVICE,
        className: 'CasesService',
        functionName: 'updateCase',
      })
      throw new BusinessException(400, 'Cannot update a closed case', 'errors.cases.alreadyClosed')
    }

    if (dto.ownerUserId) {
      await this.validateOwnerInTenant(dto.ownerUserId, user.tenantId)
    }

    // Block non-admin, non-owner users from changing case status
    const isStatusChange = dto.status !== undefined && dto.status !== existing.status
    if (isStatusChange) {
      const isAdmin = hasRoleAtLeast(user.role, UserRole.TENANT_ADMIN)
      if (!isAdmin && user.sub !== existing.ownerUserId) {
        this.appLogger.warn('Status change denied: user is not owner or admin', {
          feature: AppLogFeature.CASES,
          action: 'updateCase',
          className: 'CasesService',
          sourceType: AppLogSourceType.SERVICE,
          outcome: AppLogOutcome.DENIED,
          tenantId: user.tenantId,
          actorEmail: user.email,
          metadata: { caseId: id, userId: user.sub, ownerUserId: existing.ownerUserId },
        })
        throw new BusinessException(
          403,
          'Only case owner or admin can change case status',
          'errors.cases.statusChangeNotAllowed'
        )
      }
    }

    // Resolve user name for actor
    const actorUser = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { name: true },
    })
    const actorLabel = actorUser ? `${actorUser.name} (${user.email})` : user.email

    // Build timeline description with meaningful details
    const timelineType = isStatusChange ? CaseTimelineType.STATUS_CHANGED : CaseTimelineType.UPDATED
    let timelineDescription: string
    if (isReopening) {
      timelineDescription = `Case re-opened by ${actorLabel}`
    } else if (isStatusChange) {
      timelineDescription = `Status changed to ${dto.status} by ${actorLabel}`
    } else if (dto.ownerUserId !== undefined) {
      // Resolve previous owner for "from X" in description
      const previousOwner = existing.ownerUserId
        ? await this.prisma.user.findUnique({
            where: { id: existing.ownerUserId },
            select: { name: true, email: true },
          })
        : null
      const previousLabel = previousOwner ? `${previousOwner.name} (${previousOwner.email})` : null

      if (dto.ownerUserId === null) {
        timelineDescription = previousLabel
          ? `Assignee removed (was ${previousLabel}) by ${actorLabel}`
          : `Assignee removed by ${actorLabel}`
      } else {
        const newOwner = await this.prisma.user.findUnique({
          where: { id: dto.ownerUserId },
          select: { name: true, email: true },
        })
        const ownerLabel = newOwner ? `${newOwner.name} (${newOwner.email})` : dto.ownerUserId
        timelineDescription = previousLabel
          ? `Assigned to ${ownerLabel} from ${previousLabel} by ${actorLabel}`
          : `Assigned to ${ownerLabel} by ${actorLabel}`
      }
    } else if (dto.cycleId === undefined) {
      const changes: string[] = []
      if (dto.title !== undefined && dto.title !== existing.title) {
        changes.push(`title changed to "${dto.title}"`)
      }
      if (dto.description !== undefined && dto.description !== existing.description) {
        changes.push('description updated')
      }
      if (dto.severity !== undefined && dto.severity !== existing.severity) {
        changes.push(`severity changed from ${existing.severity} to ${dto.severity}`)
      }
      timelineDescription =
        changes.length > 0
          ? `Case updated by ${actorLabel}: ${changes.join(', ')}`
          : `Case updated by ${actorLabel}`
    } else if (dto.cycleId === null) {
      timelineDescription = `Removed from cycle by ${actorLabel}`
    } else {
      const cycle = await this.prisma.caseCycle.findUnique({
        where: { id: dto.cycleId },
        select: { name: true },
      })
      timelineDescription = `Added to cycle "${cycle?.name ?? dto.cycleId}" by ${actorLabel}`
    }

    const result = await this.prisma.$transaction(async tx => {
      // Build update data — handle nullable fields explicitly
      const updateData: Record<string, unknown> = {}
      if (dto.title !== undefined) updateData['title'] = dto.title
      if (dto.description !== undefined) updateData['description'] = dto.description
      if (dto.severity !== undefined) updateData['severity'] = dto.severity
      if (dto.status !== undefined) updateData['status'] = dto.status
      if (dto.ownerUserId !== undefined) updateData['ownerUserId'] = dto.ownerUserId
      if (dto.cycleId !== undefined) updateData['cycleId'] = dto.cycleId
      if (dto.status === 'closed') updateData['closedAt'] = new Date()
      if (isReopening) updateData['closedAt'] = null

      const updated = await tx.case.updateMany({
        where: { id, tenantId: user.tenantId },
        data: updateData,
      })

      if (updated.count === 0) {
        this.appLogger.warn('Case not found during update transaction', {
          feature: AppLogFeature.CASES,
          action: 'updateCase',
          className: 'CasesService',
          sourceType: AppLogSourceType.SERVICE,
          outcome: AppLogOutcome.FAILURE,
          tenantId: user.tenantId,
          metadata: { caseId: id },
        })
        throw new BusinessException(404, `Case ${id} not found`, 'errors.cases.notFound')
      }

      await tx.caseTimeline.create({
        data: {
          caseId: id,
          type: timelineType,
          actor: user.email,
          description: timelineDescription,
        },
      })

      return tx.case.findUniqueOrThrow({
        where: { id },
        include: {
          notes: true,
          timeline: { orderBy: { timestamp: 'asc' } },
          tasks: true,
          artifacts: true,
          tenant: { select: { name: true } },
        },
      })
    })

    this.appLogger.info('Case updated', {
      feature: AppLogFeature.CASES,
      action: 'updateCase',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'Case',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'CasesService',
      functionName: 'updateCase',
      metadata: { caseNumber: existing.caseNumber, changedFields: Object.keys(dto).join(', ') },
    })

    const [{ ownerName, ownerEmail }, createdByName] = await Promise.all([
      this.resolveOwner(result.ownerUserId),
      this.resolveCreatorName(result.createdBy),
    ])
    return { ...result, ownerName, ownerEmail, createdByName, tenantName: result.tenant.name }
  }

  /* ---------------------------------------------------------------- */
  /* DELETE                                                            */
  /* ---------------------------------------------------------------- */

  async deleteCase(id: string, tenantId: string, actor: string): Promise<{ deleted: boolean }> {
    const existing = await this.getCaseById(id, tenantId)

    // Soft-delete: close the case instead of destroying audit trail
    await this.prisma.$transaction(async tx => {
      await tx.case.updateMany({
        where: { id, tenantId },
        data: { status: 'closed' as CaseStatus, closedAt: new Date() },
      })
      await tx.caseTimeline.create({
        data: {
          caseId: id,
          type: CaseTimelineType.DELETED,
          actor,
          description: `Case ${existing.caseNumber} soft-deleted`,
        },
      })
    })

    this.logger.log(`Case ${existing.caseNumber} soft-deleted by ${actor}`)
    return { deleted: true }
  }

  /* ---------------------------------------------------------------- */
  /* LINK ALERT                                                        */
  /* ---------------------------------------------------------------- */

  async linkAlert(caseId: string, dto: LinkAlertDto, user: JwtPayload): Promise<CaseRecord> {
    const existing = await this.getCaseById(caseId, user.tenantId)

    if (existing.status === 'closed') {
      this.appLogger.warn('Cannot link alert: case is closed', {
        feature: AppLogFeature.CASES,
        action: 'linkAlert',
        className: 'CasesService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        tenantId: user.tenantId,
        actorEmail: user.email,
        metadata: { caseId, status: existing.status },
      })
      throw new BusinessException(
        400,
        'Cannot link alerts to a closed case',
        'errors.cases.alreadyClosed'
      )
    }

    // Validate that the alert belongs to the caller's tenant
    const alertExists = await this.prisma.alert.count({
      where: { id: dto.alertId, tenantId: user.tenantId },
    })
    if (alertExists === 0) {
      this.appLogger.warn('Linked alert does not belong to tenant', {
        feature: AppLogFeature.CASES,
        action: 'linkAlert',
        className: 'CasesService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        tenantId: user.tenantId,
        actorEmail: user.email,
        metadata: { caseId, alertId: dto.alertId },
      })
      throw new BusinessException(
        400,
        'The linked alert does not belong to this tenant',
        'errors.cases.invalidLinkedAlerts'
      )
    }

    if (existing.linkedAlerts.includes(dto.alertId)) {
      this.appLogger.warn('Duplicate alert link attempt', {
        feature: AppLogFeature.CASES,
        action: 'linkAlert',
        className: 'CasesService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        tenantId: user.tenantId,
        actorEmail: user.email,
        metadata: { caseId, alertId: dto.alertId },
      })
      throw new BusinessException(
        409,
        `Alert ${dto.alertId} is already linked to this case`,
        'errors.cases.duplicateAlert'
      )
    }

    const result = await this.prisma.$transaction(async tx => {
      const updated = await tx.case.updateMany({
        where: { id: caseId, tenantId: user.tenantId },
        data: {
          // updateMany doesn't support { push }, so we set the full array
          linkedAlerts: [...existing.linkedAlerts, dto.alertId],
        },
      })

      if (updated.count === 0) {
        this.appLogger.warn('Case not found during link alert transaction', {
          feature: AppLogFeature.CASES,
          action: 'linkAlert',
          className: 'CasesService',
          sourceType: AppLogSourceType.SERVICE,
          outcome: AppLogOutcome.FAILURE,
          tenantId: user.tenantId,
          metadata: { caseId },
        })
        throw new BusinessException(404, `Case ${caseId} not found`, 'errors.cases.notFound')
      }

      await tx.caseTimeline.create({
        data: {
          caseId,
          type: CaseTimelineType.ALERT_LINKED,
          actor: user.email,
          description: `Alert ${dto.alertId} linked from index ${dto.indexName}`,
        },
      })

      return tx.case.findUniqueOrThrow({
        where: { id: caseId },
        include: {
          notes: true,
          timeline: { orderBy: { timestamp: 'asc' } },
          tasks: true,
          artifacts: true,
          tenant: { select: { name: true } },
        },
      })
    })

    this.logger.log(`Alert ${dto.alertId} linked to case ${existing.caseNumber}`)
    const [{ ownerName, ownerEmail }, createdByName] = await Promise.all([
      this.resolveOwner(result.ownerUserId),
      this.resolveCreatorName(result.createdBy),
    ])
    return { ...result, ownerName, ownerEmail, createdByName, tenantName: result.tenant.name }
  }

  /* ---------------------------------------------------------------- */
  /* NOTES                                                             */
  /* ---------------------------------------------------------------- */

  async getCaseNotes(
    caseId: string,
    tenantId: string,
    page = 1,
    limit = 50
  ): Promise<PaginatedCaseNotes> {
    await this.getCaseById(caseId, tenantId)

    const where = { caseId }

    const [notes, total] = await Promise.all([
      this.prisma.caseNote.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.caseNote.count({ where }),
    ])

    return {
      data: notes,
      pagination: buildPaginationMeta(page, limit, total),
    }
  }

  async addCaseNote(caseId: string, dto: CreateNoteDto, user: JwtPayload): Promise<CaseNote> {
    const existing = await this.getCaseById(caseId, user.tenantId)

    if (existing.status === 'closed') {
      this.appLogger.warn('Cannot add note: case is closed', {
        feature: AppLogFeature.CASES,
        action: 'addCaseNote',
        className: 'CasesService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        tenantId: user.tenantId,
        actorEmail: user.email,
        metadata: { caseId, status: existing.status },
      })
      throw new BusinessException(
        400,
        'Cannot add notes to a closed case',
        'errors.cases.alreadyClosed'
      )
    }

    const truncatedBody = dto.body.length > 80 ? `${dto.body.slice(0, 80)}...` : dto.body

    const note = await this.prisma.$transaction(async tx => {
      const createdNote = await tx.caseNote.create({
        data: {
          caseId,
          author: user.email,
          body: dto.body,
        },
      })

      await tx.caseTimeline.create({
        data: {
          caseId,
          type: CaseTimelineType.NOTE_ADDED,
          actor: user.email,
          description: `Note added: ${truncatedBody}`,
        },
      })

      return createdNote
    })

    this.logger.log(`Note added to case ${existing.caseNumber} by ${user.email}`)
    return note
  }

  /* ---------------------------------------------------------------- */
  /* Helpers                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * H4/H5: Validate that ownerUserId has an active membership in the given tenant.
   */
  private async validateOwnerInTenant(ownerUserId: string, tenantId: string): Promise<void> {
    const membership = await this.prisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId: ownerUserId, tenantId } },
      select: { status: true },
    })

    if (membership?.status !== MembershipStatus.ACTIVE) {
      this.appLogger.warn('Invalid case owner: not an active tenant member', {
        feature: AppLogFeature.CASES,
        action: 'validateOwnerInTenant',
        className: 'CasesService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { ownerUserId, tenantId, membershipStatus: membership?.status ?? null },
      })
      throw new BusinessException(
        400,
        'Assigned owner is not an active member of this tenant',
        'errors.cases.invalidOwner'
      )
    }
  }

  /**
   * Generate the next case number in format SOC-YYYY-NNN.
   * Uses advisory lock to prevent race conditions across concurrent transactions.
   */
  private async generateCaseNumber(tx: Prisma.TransactionClient = this.prisma): Promise<string> {
    // M3: Advisory lock to prevent concurrent case number collisions
    // Cast to text to avoid Prisma void deserialization error
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('case_number_gen'))::text`

    const year = new Date().getFullYear()
    const prefix = `SOC-${year}-`

    const latestCase = await tx.case.findFirst({
      where: {
        caseNumber: { startsWith: prefix },
      },
      orderBy: { caseNumber: 'desc' },
      select: { caseNumber: true },
    })

    let nextSequence = 1

    if (latestCase) {
      const parts = latestCase.caseNumber.split('-')
      const lastPart = parts[2]
      if (lastPart) {
        nextSequence = Number.parseInt(lastPart, 10) + 1
      }
    }

    return `${prefix}${String(nextSequence).padStart(3, '0')}`
  }

  /* ---------------------------------------------------------------- */
  /* TASKS                                                              */
  /* ---------------------------------------------------------------- */

  async createTask(caseId: string, dto: CreateTaskDto, user: JwtPayload) {
    const caseRecord = await this.getCaseById(caseId, user.tenantId)

    if (caseRecord.status === 'closed') {
      throw new BusinessException(
        400,
        'Cannot add tasks to a closed case',
        'errors.cases.alreadyClosed'
      )
    }

    const task = await this.prisma.caseTask.create({
      data: {
        caseId,
        title: dto.title,
        status: dto.status ?? 'pending',
        assignee: dto.assignee ?? null,
      },
    })

    // Add timeline entry
    const actorUser = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { name: true },
    })
    const actorLabel = actorUser ? `${actorUser.name} (${user.email})` : user.email

    await this.prisma.caseTimeline.create({
      data: {
        caseId,
        type: CaseTimelineType.UPDATED,
        actor: user.email,
        description: `Task "${dto.title}" added by ${actorLabel}`,
      },
    })

    this.appLogger.info('Task created', {
      feature: AppLogFeature.CASES,
      action: 'createTask',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      targetResource: 'CaseTask',
      targetResourceId: task.id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'CasesService',
      functionName: 'createTask',
      metadata: { caseId, caseNumber: caseRecord.caseNumber },
    })

    return task
  }

  async updateTask(caseId: string, taskId: string, dto: UpdateTaskDto, user: JwtPayload) {
    await this.getCaseById(caseId, user.tenantId)

    const existing = await this.prisma.caseTask.findFirst({
      where: { id: taskId, caseId },
    })
    if (!existing) {
      throw new BusinessException(404, 'Task not found', 'errors.cases.taskNotFound')
    }

    const updateData: Record<string, unknown> = {}
    if (dto.title !== undefined) updateData['title'] = dto.title
    if (dto.status !== undefined) updateData['status'] = dto.status
    if (dto.assignee !== undefined) updateData['assignee'] = dto.assignee

    const task = await this.prisma.caseTask.update({
      where: { id: taskId },
      data: updateData,
    })

    // Add timeline entry for status changes
    if (dto.status !== undefined && dto.status !== existing.status) {
      const actorUser = await this.prisma.user.findUnique({
        where: { id: user.sub },
        select: { name: true },
      })
      const actorLabel = actorUser ? `${actorUser.name} (${user.email})` : user.email

      await this.prisma.caseTimeline.create({
        data: {
          caseId,
          type: CaseTimelineType.UPDATED,
          actor: user.email,
          description: `Task "${existing.title}" ${dto.status === 'completed' ? 'completed' : `changed to ${dto.status}`} by ${actorLabel}`,
        },
      })
    }

    return task
  }

  async deleteTask(caseId: string, taskId: string, user: JwtPayload) {
    const caseRecord = await this.getCaseById(caseId, user.tenantId)

    const existing = await this.prisma.caseTask.findFirst({
      where: { id: taskId, caseId },
    })
    if (!existing) {
      throw new BusinessException(404, 'Task not found', 'errors.cases.taskNotFound')
    }

    await this.prisma.caseTask.delete({ where: { id: taskId } })

    const actorUser = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { name: true },
    })
    const actorLabel = actorUser ? `${actorUser.name} (${user.email})` : user.email

    await this.prisma.caseTimeline.create({
      data: {
        caseId,
        type: CaseTimelineType.UPDATED,
        actor: user.email,
        description: `Task "${existing.title}" removed by ${actorLabel}`,
      },
    })

    this.appLogger.info('Task deleted', {
      feature: AppLogFeature.CASES,
      action: 'deleteTask',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      targetResource: 'CaseTask',
      targetResourceId: taskId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'CasesService',
      functionName: 'deleteTask',
      metadata: { caseId, caseNumber: caseRecord.caseNumber },
    })

    return { deleted: true }
  }

  /* ---------------------------------------------------------------- */
  /* ARTIFACTS                                                          */
  /* ---------------------------------------------------------------- */

  async createArtifact(caseId: string, dto: CreateArtifactDto, user: JwtPayload) {
    const caseRecord = await this.getCaseById(caseId, user.tenantId)

    if (caseRecord.status === 'closed') {
      throw new BusinessException(
        400,
        'Cannot add artifacts to a closed case',
        'errors.cases.alreadyClosed'
      )
    }

    // Check for duplicate artifact (same type + value on same case)
    const duplicate = await this.prisma.caseArtifact.findFirst({
      where: { caseId, type: dto.type, value: dto.value },
    })
    if (duplicate) {
      throw new BusinessException(409, 'Duplicate artifact', 'errors.cases.duplicateArtifact')
    }

    const artifact = await this.prisma.caseArtifact.create({
      data: {
        caseId,
        type: dto.type,
        value: dto.value,
        source: dto.source ?? 'manual',
      },
    })

    const actorUser = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { name: true },
    })
    const actorLabel = actorUser ? `${actorUser.name} (${user.email})` : user.email

    await this.prisma.caseTimeline.create({
      data: {
        caseId,
        type: CaseTimelineType.UPDATED,
        actor: user.email,
        description: `Artifact ${dto.type}:${dto.value} added by ${actorLabel}`,
      },
    })

    this.appLogger.info('Artifact created', {
      feature: AppLogFeature.CASES,
      action: 'createArtifact',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      targetResource: 'CaseArtifact',
      targetResourceId: artifact.id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'CasesService',
      functionName: 'createArtifact',
      metadata: { caseId, caseNumber: caseRecord.caseNumber },
    })

    return artifact
  }

  async deleteArtifact(caseId: string, artifactId: string, user: JwtPayload) {
    const caseRecord = await this.getCaseById(caseId, user.tenantId)

    const existing = await this.prisma.caseArtifact.findFirst({
      where: { id: artifactId, caseId },
    })
    if (!existing) {
      throw new BusinessException(404, 'Artifact not found', 'errors.cases.artifactNotFound')
    }

    await this.prisma.caseArtifact.delete({ where: { id: artifactId } })

    const actorUser = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { name: true },
    })
    const actorLabel = actorUser ? `${actorUser.name} (${user.email})` : user.email

    await this.prisma.caseTimeline.create({
      data: {
        caseId,
        type: CaseTimelineType.UPDATED,
        actor: user.email,
        description: `Artifact ${existing.type}:${existing.value} removed by ${actorLabel}`,
      },
    })

    this.appLogger.info('Artifact deleted', {
      feature: AppLogFeature.CASES,
      action: 'deleteArtifact',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      targetResource: 'CaseArtifact',
      targetResourceId: artifactId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'CasesService',
      functionName: 'deleteArtifact',
      metadata: { caseId, caseNumber: caseRecord.caseNumber },
    })

    return { deleted: true }
  }
}
