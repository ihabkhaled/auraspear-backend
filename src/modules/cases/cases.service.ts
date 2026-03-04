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
    const caseNumber = await this.generateCaseNumber()
    const linkedAlerts = dto.linkedAlertIds ?? []

    const result = await this.prisma.$transaction(async tx => {
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
        include: { notes: true, timeline: { orderBy: { timestamp: 'asc' } } },
      })
    })

    this.logger.log(`Case ${caseNumber} created by ${user.email} for tenant ${user.tenantId}`)
    const { ownerName, ownerEmail } = await this.resolveOwner(result.ownerUserId)
    return { ...result, ownerName, ownerEmail }
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
      },
    })

    if (!caseRecord) {
      throw new BusinessException(404, `Case ${id} not found`, 'errors.cases.notFound')
    }

    const { ownerName, ownerEmail } = await this.resolveOwner(caseRecord.ownerUserId)
    return { ...caseRecord, ownerName, ownerEmail }
  }

  /* ---------------------------------------------------------------- */
  /* UPDATE                                                            */
  /* ---------------------------------------------------------------- */

  async updateCase(id: string, dto: UpdateCaseDto, user: JwtPayload): Promise<CaseRecord> {
    const existing = await this.getCaseById(id, user.tenantId)

    if (existing.status === 'closed') {
      throw new BusinessException(400, 'Cannot update a closed case', 'errors.cases.alreadyClosed')
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
      await tx.case.update({
        where: { id },
        data: {
          title: dto.title ?? undefined,
          description: dto.description ?? undefined,
          severity: dto.severity ?? undefined,
          status: dto.status ?? undefined,
          ownerUserId: dto.ownerUserId ?? undefined,
          closedAt: (() => {
            if (dto.status !== 'closed') return
            return dto.closedAt ? new Date(dto.closedAt) : new Date()
          })(),
        },
      })

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
        include: { notes: true, timeline: { orderBy: { timestamp: 'asc' } } },
      })
    })

    this.logger.log(`Case ${existing.caseNumber} updated by ${user.email}`)
    const { ownerName, ownerEmail } = await this.resolveOwner(result.ownerUserId)
    return { ...result, ownerName, ownerEmail }
  }

  /* ---------------------------------------------------------------- */
  /* DELETE                                                            */
  /* ---------------------------------------------------------------- */

  async deleteCase(id: string, tenantId: string): Promise<{ deleted: boolean }> {
    const existing = await this.getCaseById(id, tenantId)

    await this.prisma.case.delete({ where: { id } })

    this.logger.log(`Case ${existing.caseNumber} deleted`)
    return { deleted: true }
  }

  /* ---------------------------------------------------------------- */
  /* LINK ALERT                                                        */
  /* ---------------------------------------------------------------- */

  async linkAlert(caseId: string, dto: LinkAlertDto, user: JwtPayload): Promise<CaseRecord> {
    const existing = await this.getCaseById(caseId, user.tenantId)

    if (existing.linkedAlerts.includes(dto.alertId)) {
      throw new BusinessException(
        409,
        `Alert ${dto.alertId} is already linked to this case`,
        'errors.cases.duplicateAlert'
      )
    }

    const result = await this.prisma.$transaction(async tx => {
      await tx.case.update({
        where: { id: caseId },
        data: {
          linkedAlerts: { push: dto.alertId },
        },
      })

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
        include: { notes: true, timeline: { orderBy: { timestamp: 'asc' } } },
      })
    })

    this.logger.log(`Alert ${dto.alertId} linked to case ${existing.caseNumber}`)
    const { ownerName, ownerEmail } = await this.resolveOwner(result.ownerUserId)
    return { ...result, ownerName, ownerEmail }
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
   * Generate the next case number in format SOC-YYYY-NNN.
   * Queries the maximum existing case number for the current year and increments.
   */
  private async generateCaseNumber(): Promise<string> {
    const year = new Date().getFullYear()
    const prefix = `SOC-${year}-`

    const latestCase = await this.prisma.case.findFirst({
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
