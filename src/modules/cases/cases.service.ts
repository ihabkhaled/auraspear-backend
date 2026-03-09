import { Injectable, Logger } from '@nestjs/common'
import { BusinessException } from '../../common/exceptions/business.exception'
import { UserRole } from '../../common/interfaces/authenticated-request.interface'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { hasRoleAtLeast } from '../../common/utils/role.util'
import { PrismaService } from '../../prisma/prisma.service'
import type { CaseRecord, PaginatedCases } from './cases.types'
import type { CreateCaseDto } from './dto/create-case.dto'
import type { CreateNoteDto } from './dto/create-note.dto'
import type { LinkAlertDto } from './dto/link-alert.dto'
import type { UpdateCaseDto } from './dto/update-case.dto'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'
import type { CaseNote, CaseStatus, CaseSeverity, Prisma } from '@prisma/client'

@Injectable()
export class CasesService {
  private readonly logger = new Logger(CasesService.name)

  constructor(private readonly prisma: PrismaService) {}

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
    query?: string
  ): Promise<PaginatedCases> {
    const where: Prisma.CaseWhereInput = { tenantId }

    if (status) {
      where.status = status as CaseStatus
    }

    if (severity) {
      where.severity = severity as CaseSeverity
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

    const ownersMap = await this.resolveOwnersBatch(cases.map(c => c.ownerUserId))

    const data = cases.map(c => {
      const owner = c.ownerUserId ? ownersMap.get(c.ownerUserId) : undefined
      return {
        ...c,
        ownerName: owner?.name ?? null,
        ownerEmail: owner?.email ?? null,
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
        throw new BusinessException(
          400,
          'One or more linked alerts do not belong to this tenant',
          'errors.cases.invalidLinkedAlerts'
        )
      }
    }

    const result = await this.prisma.$transaction(async tx => {
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
          ...(linkedAlerts.length > 0 ? { linkedAlerts } : {}),
        },
      })

      await tx.caseTimeline.create({
        data: {
          caseId: newCase.id,
          type: 'created',
          actor: user.email,
          description: `Case ${caseNumber} created: ${dto.title}`,
        },
      })

      if (linkedAlerts.length > 0) {
        await tx.caseTimeline.create({
          data: {
            caseId: newCase.id,
            type: 'alert_linked',
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
          tenant: { select: { name: true } },
        },
      })
    })

    this.logger.log(`Case created by ${user.email} for tenant ${user.tenantId}`)
    const { ownerName, ownerEmail } = await this.resolveOwner(result.ownerUserId)
    return { ...result, ownerName, ownerEmail, tenantName: result.tenant.name }
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
        tenant: { select: { name: true } },
      },
    })

    if (!caseRecord) {
      throw new BusinessException(404, `Case ${id} not found`, 'errors.cases.notFound')
    }

    const { ownerName, ownerEmail } = await this.resolveOwner(caseRecord.ownerUserId)
    return { ...caseRecord, ownerName, ownerEmail, tenantName: caseRecord.tenant.name }
  }

  /* ---------------------------------------------------------------- */
  /* UPDATE                                                            */
  /* ---------------------------------------------------------------- */

  async updateCase(id: string, dto: UpdateCaseDto, user: JwtPayload): Promise<CaseRecord> {
    const existing = await this.getCaseById(id, user.tenantId)

    if (existing.status === 'closed') {
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
        throw new BusinessException(
          403,
          'Only case owner or admin can change case status',
          'errors.cases.statusChangeNotAllowed'
        )
      }
    }

    const changedFields = Object.keys(dto).join(', ')
    const timelineType = isStatusChange ? 'status_changed' : 'updated'
    const timelineDescription = isStatusChange
      ? `Status changed from ${existing.status} to ${dto.status}`
      : `Case updated: ${changedFields} modified`

    const result = await this.prisma.$transaction(async tx => {
      const updated = await tx.case.updateMany({
        where: { id, tenantId: user.tenantId },
        data: {
          title: dto.title ?? undefined,
          description: dto.description ?? undefined,
          severity: dto.severity ?? undefined,
          status: dto.status ?? undefined,
          ownerUserId: dto.ownerUserId ?? undefined,
          closedAt: dto.status === 'closed' ? new Date() : undefined,
        },
      })

      if (updated.count === 0) {
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
          tenant: { select: { name: true } },
        },
      })
    })

    this.logger.log(`Case ${existing.caseNumber} updated by ${user.email}`)
    const { ownerName, ownerEmail } = await this.resolveOwner(result.ownerUserId)
    return { ...result, ownerName, ownerEmail, tenantName: result.tenant.name }
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
          type: 'deleted',
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
      throw new BusinessException(
        400,
        'The linked alert does not belong to this tenant',
        'errors.cases.invalidLinkedAlerts'
      )
    }

    if (existing.linkedAlerts.includes(dto.alertId)) {
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
        throw new BusinessException(404, `Case ${caseId} not found`, 'errors.cases.notFound')
      }

      await tx.caseTimeline.create({
        data: {
          caseId,
          type: 'alert_linked',
          actor: user.email,
          description: `Alert ${dto.alertId} linked from index ${dto.indexName}`,
        },
      })

      return tx.case.findUniqueOrThrow({
        where: { id: caseId },
        include: {
          notes: true,
          timeline: { orderBy: { timestamp: 'asc' } },
          tenant: { select: { name: true } },
        },
      })
    })

    this.logger.log(`Alert ${dto.alertId} linked to case ${existing.caseNumber}`)
    const { ownerName, ownerEmail } = await this.resolveOwner(result.ownerUserId)
    return { ...result, ownerName, ownerEmail, tenantName: result.tenant.name }
  }

  /* ---------------------------------------------------------------- */
  /* NOTES                                                             */
  /* ---------------------------------------------------------------- */

  async getCaseNotes(caseId: string, tenantId: string): Promise<CaseNote[]> {
    await this.getCaseById(caseId, tenantId)

    return this.prisma.caseNote.findMany({
      where: { caseId },
      orderBy: { createdAt: 'asc' },
    })
  }

  async addCaseNote(caseId: string, dto: CreateNoteDto, user: JwtPayload): Promise<CaseNote> {
    const existing = await this.getCaseById(caseId, user.tenantId)

    if (existing.status === 'closed') {
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
          type: 'note_added',
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

    if (membership?.status !== 'active') {
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
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('case_number_gen'))`

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
}
