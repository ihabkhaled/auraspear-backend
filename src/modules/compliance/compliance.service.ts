import { Injectable, Logger } from '@nestjs/common'
import { ComplianceRepository } from './compliance.repository'
import {
  buildFrameworkListWhere,
  buildFrameworkOrderBy,
  buildFrameworkUpdateData,
  buildControlUpdateData,
  buildFrameworkRecord,
  buildControlRecord,
  buildComplianceStats,
  buildControlStatsBatchMap,
} from './compliance.utilities'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import type {
  ComplianceFrameworkRecord,
  PaginatedFrameworks,
  ComplianceControlRecord,
  ComplianceStats,
} from './compliance.types'
import type { CreateControlDto } from './dto/create-control.dto'
import type { CreateFrameworkDto } from './dto/create-framework.dto'
import type { UpdateControlDto } from './dto/update-control.dto'
import type { UpdateFrameworkDto } from './dto/update-framework.dto'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'

@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name)

  constructor(
    private readonly repository: ComplianceRepository,
    private readonly appLogger: AppLoggerService
  ) {}

  /* ---------------------------------------------------------------- */
  /* RESOLVE HELPERS                                                    */
  /* ---------------------------------------------------------------- */

  private async resolveNamesBatch(emails: (string | null)[]): Promise<Map<string, string>> {
    const uniqueEmails = [...new Set(emails.filter((e): e is string => e !== null))]
    if (uniqueEmails.length === 0) return new Map()
    const users = await this.repository.findUsersByEmails(uniqueEmails)
    const map = new Map<string, string>()
    for (const u of users) {
      map.set(u.email, u.name)
    }
    return map
  }

  private async resolveName(email: string | null): Promise<string | null> {
    if (!email) return null
    const user = await this.repository.findUserByEmail(email)
    return user?.name ?? null
  }

  /* ---------------------------------------------------------------- */
  /* CONTROL STATS BATCH (private)                                     */
  /* ---------------------------------------------------------------- */

  private async getControlStatsBatch(
    frameworkIds: string[]
  ): Promise<Map<string, { total: number; passed: number; failed: number }>> {
    if (frameworkIds.length === 0) return new Map()

    const controls = await this.repository.groupByControls({
      by: ['frameworkId', 'status'],
      where: { frameworkId: { in: frameworkIds } },
      _count: { id: true },
    })

    return buildControlStatsBatchMap(controls)
  }

  /* ---------------------------------------------------------------- */
  /* LIST FRAMEWORKS (paginated, tenant-scoped)                        */
  /* ---------------------------------------------------------------- */

  async listFrameworks(
    tenantId: string,
    page = 1,
    limit = 20,
    sortBy?: string,
    sortOrder?: string,
    standard?: string,
    query?: string
  ): Promise<PaginatedFrameworks> {
    const where = buildFrameworkListWhere(tenantId, standard, query)

    const [frameworks, total] = await Promise.all([
      this.repository.findManyFrameworksWithTenant({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: buildFrameworkOrderBy(sortBy, sortOrder),
      }),
      this.repository.countFrameworks(where),
    ])

    // Get control stats for each framework
    const frameworkIds = frameworks.map(f => f.id)
    const controlStats = await this.getControlStatsBatch(frameworkIds)

    const data: ComplianceFrameworkRecord[] = frameworks.map(f =>
      buildFrameworkRecord(f, controlStats.get(f.id))
    )

    return {
      data,
      pagination: buildPaginationMeta(page, limit, total),
    }
  }

  /* ---------------------------------------------------------------- */
  /* GET FRAMEWORK BY ID                                               */
  /* ---------------------------------------------------------------- */

  async getFrameworkById(id: string, tenantId: string): Promise<ComplianceFrameworkRecord> {
    const framework = await this.repository.findFirstFrameworkWithTenant({ id, tenantId })

    if (!framework) {
      this.appLogger.warn('Framework not found', {
        feature: AppLogFeature.COMPLIANCE,
        action: 'getFrameworkById',
        className: 'ComplianceService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { frameworkId: id, tenantId },
      })
      throw new BusinessException(
        404,
        `Framework ${id} not found`,
        'errors.compliance.frameworkNotFound'
      )
    }

    const stats = await this.getControlStatsBatch([framework.id])

    return buildFrameworkRecord(framework, stats.get(framework.id))
  }

  /* ---------------------------------------------------------------- */
  /* CREATE FRAMEWORK                                                  */
  /* ---------------------------------------------------------------- */

  async createFramework(
    dto: CreateFrameworkDto,
    user: JwtPayload
  ): Promise<ComplianceFrameworkRecord> {
    const existing = await this.repository.findFirstFramework({
      tenantId: user.tenantId,
      standard: dto.standard,
      version: dto.version,
    })

    if (existing) {
      throw new BusinessException(
        409,
        `Framework with standard ${dto.standard} version ${dto.version} already exists`,
        'errors.compliance.frameworkAlreadyExists'
      )
    }

    const framework = await this.repository.createFramework({
      tenantId: user.tenantId,
      name: dto.name,
      description: dto.description ?? null,
      standard: dto.standard,
      version: dto.version,
    })

    this.appLogger.info('Framework created', {
      feature: AppLogFeature.COMPLIANCE,
      action: 'createFramework',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'ComplianceFramework',
      targetResourceId: framework.id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'ComplianceService',
      functionName: 'createFramework',
      metadata: { name: framework.name, standard: framework.standard },
    })

    return buildFrameworkRecord(framework)
  }

  /* ---------------------------------------------------------------- */
  /* UPDATE FRAMEWORK                                                  */
  /* ---------------------------------------------------------------- */

  async updateFramework(
    id: string,
    dto: UpdateFrameworkDto,
    user: JwtPayload
  ): Promise<ComplianceFrameworkRecord> {
    await this.getFrameworkById(id, user.tenantId)

    const updated = await this.repository.updateManyFrameworks({
      where: { id, tenantId: user.tenantId },
      data: buildFrameworkUpdateData(dto),
    })

    if (updated.count === 0) {
      throw new BusinessException(
        404,
        `Framework ${id} not found`,
        'errors.compliance.frameworkNotFound'
      )
    }

    this.appLogger.info('Framework updated', {
      feature: AppLogFeature.COMPLIANCE,
      action: 'updateFramework',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'ComplianceFramework',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'ComplianceService',
      functionName: 'updateFramework',
    })

    return this.getFrameworkById(id, user.tenantId)
  }

  /* ---------------------------------------------------------------- */
  /* DELETE FRAMEWORK                                                  */
  /* ---------------------------------------------------------------- */

  async deleteFramework(
    id: string,
    tenantId: string,
    actor: string
  ): Promise<{ deleted: boolean }> {
    const existing = await this.getFrameworkById(id, tenantId)

    await this.repository.deleteFrameworkWithControls(id, tenantId)

    this.appLogger.info(`Framework ${existing.name} deleted`, {
      feature: AppLogFeature.COMPLIANCE,
      action: 'deleteFramework',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      actorEmail: actor,
      targetResource: 'ComplianceFramework',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'ComplianceService',
      functionName: 'deleteFramework',
      metadata: { name: existing.name },
    })

    return { deleted: true }
  }

  /* ---------------------------------------------------------------- */
  /* LIST CONTROLS                                                     */
  /* ---------------------------------------------------------------- */

  async listControls(frameworkId: string, tenantId: string): Promise<ComplianceControlRecord[]> {
    // Verify framework exists and belongs to tenant
    await this.getFrameworkById(frameworkId, tenantId)

    const controls = await this.repository.findManyControls({
      where: { frameworkId },
      orderBy: { controlNumber: 'asc' },
    })

    const assessorMap = await this.resolveNamesBatch(controls.map(c => c.assessedBy))

    return controls.map(c =>
      buildControlRecord(c, c.assessedBy ? (assessorMap.get(c.assessedBy) ?? null) : null)
    )
  }

  /* ---------------------------------------------------------------- */
  /* CREATE CONTROL                                                    */
  /* ---------------------------------------------------------------- */

  async createControl(
    frameworkId: string,
    dto: CreateControlDto,
    user: JwtPayload
  ): Promise<ComplianceControlRecord> {
    // Verify framework exists and belongs to tenant
    await this.getFrameworkById(frameworkId, user.tenantId)

    const control = await this.repository.createControl({
      frameworkId,
      controlNumber: dto.controlNumber,
      title: dto.title,
      description: dto.description ?? null,
      status: dto.status,
      evidence: dto.evidence ?? null,
      assessedAt: new Date(),
      assessedBy: user.email,
    })

    this.appLogger.info('Control created', {
      feature: AppLogFeature.COMPLIANCE,
      action: 'createControl',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'ComplianceControl',
      targetResourceId: control.id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'ComplianceService',
      functionName: 'createControl',
      metadata: { frameworkId, controlNumber: control.controlNumber },
    })

    const assessedByName = await this.resolveName(control.assessedBy)

    return buildControlRecord(control, assessedByName)
  }

  /* ---------------------------------------------------------------- */
  /* UPDATE CONTROL                                                    */
  /* ---------------------------------------------------------------- */

  async updateControl(
    frameworkId: string,
    controlId: string,
    dto: UpdateControlDto,
    user: JwtPayload
  ): Promise<ComplianceControlRecord> {
    // Verify framework exists and belongs to tenant
    await this.getFrameworkById(frameworkId, user.tenantId)

    const existing = await this.repository.findFirstControl({
      where: { id: controlId, frameworkId },
    })

    if (!existing) {
      throw new BusinessException(
        404,
        `Control ${controlId} not found`,
        'errors.compliance.controlNotFound'
      )
    }

    await this.repository.updateManyControls({
      where: { id: controlId, frameworkId },
      data: buildControlUpdateData(dto, user.email),
    })

    this.appLogger.info('Control updated', {
      feature: AppLogFeature.COMPLIANCE,
      action: 'updateControl',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'ComplianceControl',
      targetResourceId: controlId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'ComplianceService',
      functionName: 'updateControl',
      metadata: { frameworkId },
    })

    const updated = await this.repository.findControlByIdAndTenant(controlId, user.tenantId)

    if (!updated) {
      throw new BusinessException(
        404,
        `Control ${controlId} not found after update`,
        'errors.compliance.controlNotFound'
      )
    }

    const assessedByName = await this.resolveName(updated.assessedBy)

    return buildControlRecord(updated, assessedByName)
  }

  /* ---------------------------------------------------------------- */
  /* STATS                                                             */
  /* ---------------------------------------------------------------- */

  async getComplianceStats(tenantId: string): Promise<ComplianceStats> {
    const [totalFrameworks, controlCounts] = await Promise.all([
      this.repository.countFrameworks({ tenantId }),
      this.repository.groupByControlStatus({ framework: { tenantId } }),
    ])

    return buildComplianceStats(totalFrameworks, controlCounts)
  }
}
