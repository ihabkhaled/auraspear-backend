import { Injectable, Logger } from '@nestjs/common'
import { CasesRepository } from './cases.repository'
import {
  AppLogFeature,
  AppLogOutcome,
  AppLogSourceType,
  CaseStatus,
  CaseTimelineType,
  NotificationType,
} from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { MembershipStatus, UserRole } from '../../common/interfaces/authenticated-request.interface'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import { hasRoleAtLeast } from '../../common/utils/role.util'
import { NotificationsService } from '../notifications/notifications.service'
import type {
  CaseCommentResponse,
  CaseRecord,
  MentionableUser,
  PaginatedCaseComments,
  PaginatedCaseNotes,
  PaginatedCases,
} from './cases.types'
import type { CreateArtifactDto } from './dto/create-artifact.dto'
import type { CreateCaseDto } from './dto/create-case.dto'
import type { CreateCommentDto } from './dto/create-comment.dto'
import type { CreateNoteDto } from './dto/create-note.dto'
import type { CreateTaskDto } from './dto/create-task.dto'
import type { LinkAlertDto } from './dto/link-alert.dto'
import type { UpdateCaseDto } from './dto/update-case.dto'
import type { UpdateCommentDto } from './dto/update-comment.dto'
import type { UpdateTaskDto } from './dto/update-task.dto'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'
import type { CaseNote, CaseSeverity, Prisma } from '@prisma/client'

@Injectable()
export class CasesService {
  private readonly logger = new Logger(CasesService.name)

  constructor(
    private readonly casesRepository: CasesRepository,
    private readonly appLogger: AppLoggerService,
    private readonly notificationsService: NotificationsService
  ) {}

  private async resolveOwner(
    ownerUserId: string | null
  ): Promise<{ ownerName: string | null; ownerEmail: string | null }> {
    if (!ownerUserId) {
      return { ownerName: null, ownerEmail: null }
    }
    const owner = await this.casesRepository.findUserById(ownerUserId)
    return {
      ownerName: owner?.name ?? null,
      ownerEmail: owner?.email ?? null,
    }
  }

  private async resolveCreatorName(email: string | null): Promise<string | null> {
    if (!email) return null
    const user = await this.casesRepository.findUserByEmail(email)
    return user?.name ?? null
  }

  private async resolveCreatorNamesBatch(emails: (string | null)[]): Promise<Map<string, string>> {
    const uniqueEmails = [...new Set(emails.filter((e): e is string => e !== null))]
    if (uniqueEmails.length === 0) return new Map()
    const users = await this.casesRepository.findUsersByEmails(uniqueEmails)
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
    const owners = await this.casesRepository.findUsersByIds(ids)
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

    const [cases, total] = await this.casesRepository.findCasesAndCount({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: this.buildCaseOrderBy(sortBy, sortOrder),
    })

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
      const validAlerts = await this.casesRepository.countAlertsByTenantAndIds(
        user.tenantId,
        linkedAlerts
      )
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

    let result: Awaited<ReturnType<CasesRepository['createCaseTransaction']>>
    try {
      result = await this.casesRepository.createCaseTransaction(
        {
          tenantId: user.tenantId,
          cycleId: dto.cycleId,
          title: dto.title,
          description: dto.description,
          severity: dto.severity,
          status: CaseStatus.OPEN,
          ownerUserId: dto.ownerUserId ?? null,
          createdBy: user.email,
          linkedAlerts,
        },
        {
          type: CaseTimelineType.CREATED,
          actor: user.email,
          description: '',
        },
        linkedAlerts.length > 0
          ? {
              type: CaseTimelineType.ALERT_LINKED,
              actor: user.email,
              description: `${linkedAlerts.length} alert(s) linked at creation`,
            }
          : undefined
      )
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'INVALID_CYCLE') {
        throw new BusinessException(
          400,
          'The specified cycle does not belong to this tenant',
          'errors.cases.invalidCycle'
        )
      }
      throw error
    }

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
    const caseRecord = await this.casesRepository.findCaseByIdAndTenant(id, tenantId)

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
      existing.status === CaseStatus.CLOSED &&
      dto.status !== undefined &&
      dto.status !== CaseStatus.CLOSED
    const isAssigneeChange = dto.ownerUserId !== undefined
    if (existing.status === CaseStatus.CLOSED && !isReopening && !isAssigneeChange) {
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
    const actorUser = await this.casesRepository.findUserNameById(user.sub)
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
        ? await this.casesRepository.findUserById(existing.ownerUserId)
        : null
      const previousLabel = previousOwner ? `${previousOwner.name} (${previousOwner.email})` : null

      if (dto.ownerUserId === null) {
        timelineDescription = previousLabel
          ? `Assignee removed (was ${previousLabel}) by ${actorLabel}`
          : `Assignee removed by ${actorLabel}`
      } else {
        const newOwner = await this.casesRepository.findUserById(dto.ownerUserId)
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
      const cycle = await this.casesRepository.findCaseCycleById(dto.cycleId)
      timelineDescription = `Added to cycle "${cycle?.name ?? dto.cycleId}" by ${actorLabel}`
    }

    // Build update data — handle nullable fields explicitly
    const updateData: Record<string, unknown> = {}
    if (dto.title !== undefined) updateData['title'] = dto.title
    if (dto.description !== undefined) updateData['description'] = dto.description
    if (dto.severity !== undefined) updateData['severity'] = dto.severity
    if (dto.status !== undefined) updateData['status'] = dto.status
    if (dto.ownerUserId !== undefined) updateData['ownerUserId'] = dto.ownerUserId
    if (dto.cycleId !== undefined) updateData['cycleId'] = dto.cycleId
    if (dto.status === CaseStatus.CLOSED) updateData['closedAt'] = new Date()
    if (isReopening) updateData['closedAt'] = null

    let result: Awaited<ReturnType<CasesRepository['updateCaseTransaction']>>
    try {
      result = await this.casesRepository.updateCaseTransaction(id, user.tenantId, updateData, {
        type: timelineType,
        actor: user.email,
        description: timelineDescription,
      })
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'CASE_NOT_FOUND') {
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
      throw error
    }

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

    // Notify case assignment changes (after transaction success)
    if (dto.ownerUserId !== undefined && dto.ownerUserId !== existing.ownerUserId) {
      // Notify new assignee
      if (dto.ownerUserId !== null) {
        await this.notificationsService.notifyCaseAssigned(
          user.tenantId,
          id,
          existing.caseNumber,
          dto.ownerUserId,
          user.sub,
          user.email
        )
      }
      // Notify previous assignee about unassignment
      if (existing.ownerUserId) {
        await this.notificationsService.notifyCaseUnassigned(
          user.tenantId,
          id,
          existing.caseNumber,
          existing.ownerUserId,
          user.sub,
          user.email
        )
      }
    }

    // Notify case owner about status change
    if (isStatusChange) {
      await this.notificationsService.notifyCaseActivity(
        user.tenantId,
        id,
        existing.caseNumber,
        existing.ownerUserId,
        NotificationType.CASE_STATUS_CHANGED,
        `Case ${existing.caseNumber} status changed to ${dto.status}`,
        user.sub,
        user.email
      )
    }

    // Notify case owner about cycle change
    if (dto.cycleId !== undefined && dto.cycleId !== existing.cycleId) {
      const cycleMessage =
        dto.cycleId === null
          ? `Case ${existing.caseNumber} removed from cycle`
          : `Case ${existing.caseNumber} added to a cycle`
      await this.notificationsService.notifyCaseActivity(
        user.tenantId,
        id,
        existing.caseNumber,
        existing.ownerUserId,
        NotificationType.CASE_UPDATED,
        cycleMessage,
        user.sub,
        user.email
      )
    }

    // Notify case owner about field edits (title, description, severity)
    const hasFieldChanges =
      !isStatusChange &&
      dto.ownerUserId === undefined &&
      dto.cycleId === undefined &&
      (dto.title !== undefined || dto.description !== undefined || dto.severity !== undefined)
    if (hasFieldChanges) {
      await this.notificationsService.notifyCaseActivity(
        user.tenantId,
        id,
        existing.caseNumber,
        existing.ownerUserId,
        NotificationType.CASE_UPDATED,
        `Case ${existing.caseNumber} has been updated`,
        user.sub,
        user.email
      )
    }

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
    await this.casesRepository.softDeleteCaseTransaction(id, tenantId, CaseStatus.CLOSED, {
      type: CaseTimelineType.DELETED,
      actor,
      description: `Case ${existing.caseNumber} soft-deleted`,
    })

    this.logger.log(`Case ${existing.caseNumber} soft-deleted by ${actor}`)
    return { deleted: true }
  }

  /* ---------------------------------------------------------------- */
  /* LINK ALERT                                                        */
  /* ---------------------------------------------------------------- */

  async linkAlert(caseId: string, dto: LinkAlertDto, user: JwtPayload): Promise<CaseRecord> {
    const existing = await this.getCaseById(caseId, user.tenantId)

    if (existing.status === CaseStatus.CLOSED) {
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
    const alertExists = await this.casesRepository.countAlertByTenantAndId(
      user.tenantId,
      dto.alertId
    )
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

    let result: Awaited<ReturnType<CasesRepository['linkAlertTransaction']>>
    try {
      result = await this.casesRepository.linkAlertTransaction(
        caseId,
        user.tenantId,
        [...existing.linkedAlerts, dto.alertId],
        {
          type: CaseTimelineType.ALERT_LINKED,
          actor: user.email,
          description: `Alert ${dto.alertId} linked from index ${dto.indexName}`,
        }
      )
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'CASE_NOT_FOUND') {
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
      throw error
    }

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

    const [notes, total] = await this.casesRepository.findCaseNotesAndCount(
      caseId,
      (page - 1) * limit,
      limit
    )

    return {
      data: notes,
      pagination: buildPaginationMeta(page, limit, total),
    }
  }

  async addCaseNote(caseId: string, dto: CreateNoteDto, user: JwtPayload): Promise<CaseNote> {
    const existing = await this.getCaseById(caseId, user.tenantId)

    if (existing.status === CaseStatus.CLOSED) {
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

    const note = await this.casesRepository.addNoteTransaction(caseId, user.email, dto.body, {
      type: CaseTimelineType.NOTE_ADDED,
      actor: user.email,
      description: `Note added: ${truncatedBody}`,
    })

    this.logger.log(`Note added to case ${existing.caseNumber} by ${user.email}`)
    return note
  }

  /* ---------------------------------------------------------------- */
  /* COMMENTS                                                          */
  /* ---------------------------------------------------------------- */

  async listCaseComments(
    caseId: string,
    tenantId: string,
    page = 1,
    limit = 20
  ): Promise<PaginatedCaseComments> {
    await this.getCaseById(caseId, tenantId)

    const [comments, total] = await this.casesRepository.findCommentsAndCount(
      caseId,
      (page - 1) * limit,
      limit
    )

    const authorIds = [...new Set(comments.map(c => c.authorId))]
    const mentionUserIds = [...new Set(comments.flatMap(c => c.mentions.map(m => m.userId)))]
    const allUserIds = [...new Set([...authorIds, ...mentionUserIds])]

    const users = allUserIds.length > 0 ? await this.casesRepository.findUsersByIds(allUserIds) : []

    const userMap = new Map(users.map(u => [u.id, u]))

    const data: CaseCommentResponse[] = comments.map(comment => {
      const author = userMap.get(comment.authorId)
      return {
        id: comment.id,
        caseId: comment.caseId,
        body: comment.body,
        isEdited: comment.isEdited,
        isDeleted: comment.isDeleted,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
        author: {
          id: comment.authorId,
          name: author?.name ?? 'Unknown',
          email: author?.email ?? '',
        },
        mentions: comment.mentions.map(m => {
          const mentionUser = userMap.get(m.userId)
          return {
            id: m.userId,
            name: mentionUser?.name ?? 'Unknown',
            email: mentionUser?.email ?? '',
          }
        }),
      }
    })

    return {
      data,
      pagination: buildPaginationMeta(page, limit, total),
    }
  }

  async addCaseComment(
    caseId: string,
    dto: CreateCommentDto,
    user: JwtPayload
  ): Promise<CaseCommentResponse> {
    const existing = await this.getCaseById(caseId, user.tenantId)

    if (existing.status === CaseStatus.CLOSED) {
      this.appLogger.warn('Cannot add comment: case is closed', {
        feature: AppLogFeature.CASES,
        action: 'addCaseComment',
        className: 'CasesService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        tenantId: user.tenantId,
        actorEmail: user.email,
        metadata: { caseId, status: existing.status },
      })
      throw new BusinessException(
        400,
        'Cannot add comments to a closed case',
        'errors.cases.alreadyClosed'
      )
    }

    // Validate: cannot mention yourself
    const uniqueMentionIds = [...new Set(dto.mentionedUserIds)]
    if (uniqueMentionIds.includes(user.sub)) {
      throw new BusinessException(
        400,
        'You cannot mention yourself in a comment',
        'errors.cases.cannotMentionSelf'
      )
    }

    // Validate mentioned users belong to the same tenant
    if (uniqueMentionIds.length > 0) {
      const validMentions = await this.casesRepository.countActiveMentionMemberships(
        uniqueMentionIds,
        user.tenantId,
        MembershipStatus.ACTIVE
      )
      if (validMentions !== uniqueMentionIds.length) {
        throw new BusinessException(
          400,
          'One or more mentioned users are not active members of this tenant',
          'errors.cases.invalidMentionedUsers'
        )
      }
    }

    const truncatedBody = dto.body.length > 80 ? `${dto.body.slice(0, 80)}...` : dto.body

    const comment = await this.casesRepository.addCommentTransaction(
      caseId,
      user.sub,
      dto.body,
      uniqueMentionIds,
      {
        type: CaseTimelineType.COMMENT_ADDED,
        actor: user.email,
        description: `Comment added: ${truncatedBody}`,
      }
    )

    this.appLogger.info('Comment added', {
      feature: AppLogFeature.CASES,
      action: 'addCaseComment',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'CaseComment',
      targetResourceId: comment.id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'CasesService',
      functionName: 'addCaseComment',
      metadata: { caseId, caseNumber: existing.caseNumber, mentionCount: uniqueMentionIds.length },
    })

    // Create mention notifications after the transaction succeeds
    if (uniqueMentionIds.length > 0) {
      await this.notificationsService.createMentionNotifications(
        user.tenantId,
        caseId,
        comment.id,
        uniqueMentionIds,
        user
      )
    }

    // Notify case owner about the new comment
    await this.notificationsService.notifyCaseActivity(
      user.tenantId,
      caseId,
      existing.caseNumber,
      existing.ownerUserId,
      NotificationType.CASE_COMMENT_ADDED,
      `New comment on case ${existing.caseNumber}: ${truncatedBody}`,
      user.sub,
      user.email
    )

    return this.mapCommentToResponse(comment, user.sub)
  }

  async updateCaseComment(
    caseId: string,
    commentId: string,
    dto: UpdateCommentDto,
    user: JwtPayload
  ): Promise<CaseCommentResponse> {
    await this.getCaseById(caseId, user.tenantId)

    const existing = await this.casesRepository.findCommentByIdAndCase(commentId, caseId)
    if (!existing) {
      throw new BusinessException(404, 'Comment not found', 'errors.cases.commentNotFound')
    }

    // Only author or TENANT_ADMIN+ can edit
    if (existing.authorId !== user.sub && !hasRoleAtLeast(user.role, UserRole.TENANT_ADMIN)) {
      throw new BusinessException(
        403,
        'You can only edit your own comments',
        'errors.cases.commentEditNotAllowed'
      )
    }

    const uniqueMentionIds = [...new Set(dto.mentionedUserIds)]
    if (uniqueMentionIds.length > 0) {
      const validMentions = await this.casesRepository.countActiveMentionMemberships(
        uniqueMentionIds,
        user.tenantId,
        MembershipStatus.ACTIVE
      )
      if (validMentions !== uniqueMentionIds.length) {
        throw new BusinessException(
          400,
          'One or more mentioned users are not active members of this tenant',
          'errors.cases.invalidMentionedUsers'
        )
      }
    }

    const comment = await this.casesRepository.updateCommentTransaction(
      commentId,
      caseId,
      dto.body,
      uniqueMentionIds,
      {
        type: CaseTimelineType.COMMENT_EDITED,
        actor: user.email,
        description: 'Comment edited',
      }
    )

    this.appLogger.info('Comment updated', {
      feature: AppLogFeature.CASES,
      action: 'updateCaseComment',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      targetResource: 'CaseComment',
      targetResourceId: commentId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'CasesService',
      functionName: 'updateCaseComment',
      metadata: { caseId },
    })

    return this.mapCommentToResponse(comment, user.sub)
  }

  async deleteCaseComment(
    caseId: string,
    commentId: string,
    user: JwtPayload
  ): Promise<{ deleted: boolean }> {
    const caseRecord = await this.getCaseById(caseId, user.tenantId)

    const existing = await this.casesRepository.findCommentByIdAndCase(commentId, caseId)
    if (!existing) {
      throw new BusinessException(404, 'Comment not found', 'errors.cases.commentNotFound')
    }

    // Only author or TENANT_ADMIN+ can delete
    if (existing.authorId !== user.sub && !hasRoleAtLeast(user.role, UserRole.TENANT_ADMIN)) {
      throw new BusinessException(
        403,
        'You can only delete your own comments',
        'errors.cases.commentDeleteNotAllowed'
      )
    }

    await this.casesRepository.softDeleteCommentTransaction(commentId, caseId, {
      type: CaseTimelineType.COMMENT_DELETED,
      actor: user.email,
      description: 'Comment deleted',
    })

    this.appLogger.info('Comment deleted', {
      feature: AppLogFeature.CASES,
      action: 'deleteCaseComment',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      targetResource: 'CaseComment',
      targetResourceId: commentId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'CasesService',
      functionName: 'deleteCaseComment',
      metadata: { caseId, caseNumber: caseRecord.caseNumber },
    })

    return { deleted: true }
  }

  async searchMentionableUsers(
    tenantId: string,
    query: string,
    limit = 10
  ): Promise<MentionableUser[]> {
    const memberships = await this.casesRepository.searchMentionableMembers(
      tenantId,
      query,
      MembershipStatus.ACTIVE,
      limit
    )

    return memberships.map(m => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
    }))
  }

  private async mapCommentToResponse(
    comment: {
      id: string
      caseId: string
      authorId: string
      body: string
      isEdited: boolean
      isDeleted: boolean
      createdAt: Date
      updatedAt: Date
      mentions: Array<{ userId: string }>
    },
    _requestUserId: string
  ): Promise<CaseCommentResponse> {
    const allUserIds = [comment.authorId, ...comment.mentions.map(m => m.userId)]
    const users = await this.casesRepository.findUsersByIds([...new Set(allUserIds)])
    const userMap = new Map(users.map(u => [u.id, u]))
    const author = userMap.get(comment.authorId)

    return {
      id: comment.id,
      caseId: comment.caseId,
      body: comment.body,
      isEdited: comment.isEdited,
      isDeleted: comment.isDeleted,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      author: {
        id: comment.authorId,
        name: author?.name ?? 'Unknown',
        email: author?.email ?? '',
      },
      mentions: comment.mentions.map(m => {
        const mentionUser = userMap.get(m.userId)
        return {
          id: m.userId,
          name: mentionUser?.name ?? 'Unknown',
          email: mentionUser?.email ?? '',
        }
      }),
    }
  }

  /* ---------------------------------------------------------------- */
  /* Helpers                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * H4/H5: Validate that ownerUserId has an active membership in the given tenant.
   */
  private async validateOwnerInTenant(ownerUserId: string, tenantId: string): Promise<void> {
    const membership = await this.casesRepository.findMembershipByUserAndTenant(
      ownerUserId,
      tenantId
    )

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

  /* ---------------------------------------------------------------- */
  /* TASKS                                                              */
  /* ---------------------------------------------------------------- */

  async createTask(caseId: string, dto: CreateTaskDto, user: JwtPayload) {
    const caseRecord = await this.getCaseById(caseId, user.tenantId)

    if (caseRecord.status === CaseStatus.CLOSED) {
      throw new BusinessException(
        400,
        'Cannot add tasks to a closed case',
        'errors.cases.alreadyClosed'
      )
    }

    const task = await this.casesRepository.createTask({
      caseId,
      title: dto.title,
      status: dto.status ?? 'pending',
      assignee: dto.assignee ?? null,
    })

    // Add timeline entry
    const actorUser = await this.casesRepository.findUserNameById(user.sub)
    const actorLabel = actorUser ? `${actorUser.name} (${user.email})` : user.email

    await this.casesRepository.createTimeline({
      caseId,
      type: CaseTimelineType.UPDATED,
      actor: user.email,
      description: `Task "${dto.title}" added by ${actorLabel}`,
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

    // Notify case owner about new task
    await this.notificationsService.notifyCaseActivity(
      user.tenantId,
      caseId,
      caseRecord.caseNumber,
      caseRecord.ownerUserId,
      NotificationType.CASE_TASK_ADDED,
      `New task added to case ${caseRecord.caseNumber}: "${dto.title}"`,
      user.sub,
      user.email
    )

    return task
  }

  async updateTask(caseId: string, taskId: string, dto: UpdateTaskDto, user: JwtPayload) {
    await this.getCaseById(caseId, user.tenantId)

    const existing = await this.casesRepository.findTaskByIdAndCase(taskId, caseId)
    if (!existing) {
      throw new BusinessException(404, 'Task not found', 'errors.cases.taskNotFound')
    }

    const updateData: Record<string, unknown> = {}
    if (dto.title !== undefined) updateData['title'] = dto.title
    if (dto.status !== undefined) updateData['status'] = dto.status
    if (dto.assignee !== undefined) updateData['assignee'] = dto.assignee

    const task = await this.casesRepository.updateTask(taskId, updateData)

    // Add timeline entry for status changes
    if (dto.status !== undefined && dto.status !== existing.status) {
      const actorUser = await this.casesRepository.findUserNameById(user.sub)
      const actorLabel = actorUser ? `${actorUser.name} (${user.email})` : user.email

      await this.casesRepository.createTimeline({
        caseId,
        type: CaseTimelineType.UPDATED,
        actor: user.email,
        description: `Task "${existing.title}" ${dto.status === 'completed' ? 'completed' : `changed to ${dto.status}`} by ${actorLabel}`,
      })
    }

    return task
  }

  async deleteTask(caseId: string, taskId: string, user: JwtPayload) {
    const caseRecord = await this.getCaseById(caseId, user.tenantId)

    const existing = await this.casesRepository.findTaskByIdAndCase(taskId, caseId)
    if (!existing) {
      throw new BusinessException(404, 'Task not found', 'errors.cases.taskNotFound')
    }

    await this.casesRepository.deleteTask(taskId)

    const actorUser = await this.casesRepository.findUserNameById(user.sub)
    const actorLabel = actorUser ? `${actorUser.name} (${user.email})` : user.email

    await this.casesRepository.createTimeline({
      caseId,
      type: CaseTimelineType.UPDATED,
      actor: user.email,
      description: `Task "${existing.title}" removed by ${actorLabel}`,
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

    if (caseRecord.status === CaseStatus.CLOSED) {
      throw new BusinessException(
        400,
        'Cannot add artifacts to a closed case',
        'errors.cases.alreadyClosed'
      )
    }

    // Check for duplicate artifact (same type + value on same case)
    const duplicate = await this.casesRepository.findArtifactDuplicate(caseId, dto.type, dto.value)
    if (duplicate) {
      throw new BusinessException(409, 'Duplicate artifact', 'errors.cases.duplicateArtifact')
    }

    const artifact = await this.casesRepository.createArtifact({
      caseId,
      type: dto.type,
      value: dto.value,
      source: dto.source ?? 'manual',
    })

    const actorUser = await this.casesRepository.findUserNameById(user.sub)
    const actorLabel = actorUser ? `${actorUser.name} (${user.email})` : user.email

    await this.casesRepository.createTimeline({
      caseId,
      type: CaseTimelineType.UPDATED,
      actor: user.email,
      description: `Artifact ${dto.type}:${dto.value} added by ${actorLabel}`,
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

    // Notify case owner about new artifact
    await this.notificationsService.notifyCaseActivity(
      user.tenantId,
      caseId,
      caseRecord.caseNumber,
      caseRecord.ownerUserId,
      NotificationType.CASE_ARTIFACT_ADDED,
      `New artifact added to case ${caseRecord.caseNumber}: ${dto.type}:${dto.value}`,
      user.sub,
      user.email
    )

    return artifact
  }

  async deleteArtifact(caseId: string, artifactId: string, user: JwtPayload) {
    const caseRecord = await this.getCaseById(caseId, user.tenantId)

    const existing = await this.casesRepository.findArtifactByIdAndCase(artifactId, caseId)
    if (!existing) {
      throw new BusinessException(404, 'Artifact not found', 'errors.cases.artifactNotFound')
    }

    await this.casesRepository.deleteArtifact(artifactId)

    const actorUser = await this.casesRepository.findUserNameById(user.sub)
    const actorLabel = actorUser ? `${actorUser.name} (${user.email})` : user.email

    await this.casesRepository.createTimeline({
      caseId,
      type: CaseTimelineType.UPDATED,
      actor: user.email,
      description: `Artifact ${existing.type}:${existing.value} removed by ${actorLabel}`,
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
