import { Injectable, Logger } from '@nestjs/common'
import { VulnerabilitiesRepository } from './vulnerabilities.repository'
import {
  buildVulnerabilityListWhere,
  buildVulnerabilityOrderBy,
  buildVulnerabilityUpdateData,
  buildVulnerabilityStats,
  buildVulnerabilityRecord,
  buildVulnerabilityRecordList,
} from './vulnerabilities.utilities'
import {
  AppLogFeature,
  AppLogOutcome,
  AppLogSourceType,
  PatchStatus,
  VulnerabilitySeverity,
} from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import type { CreateVulnerabilityDto } from './dto/create-vulnerability.dto'
import type { UpdateVulnerabilityDto } from './dto/update-vulnerability.dto'
import type {
  PaginatedVulnerabilities,
  VulnerabilityRecord,
  VulnerabilityStats,
} from './vulnerabilities.types'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'
import type {
  VulnerabilitySeverity as PrismaVulnerabilitySeverity,
  PatchStatus as PrismaPatchStatus,
} from '@prisma/client'

@Injectable()
export class VulnerabilitiesService {
  private readonly logger = new Logger(VulnerabilitiesService.name)

  constructor(
    private readonly repository: VulnerabilitiesRepository,
    private readonly appLogger: AppLoggerService
  ) {}

  async listVulnerabilities(
    tenantId: string,
    page: number,
    limit: number,
    sortBy: string,
    sortOrder: 'asc' | 'desc',
    severity?: string,
    patchStatus?: string,
    exploitAvailable?: string,
    query?: string
  ): Promise<PaginatedVulnerabilities> {
    const where = buildVulnerabilityListWhere(tenantId, severity, patchStatus, exploitAvailable, query)

    const [data, total] = await Promise.all([
      this.repository.findManyWithTenant(
        where,
        buildVulnerabilityOrderBy(sortBy, sortOrder),
        (page - 1) * limit,
        limit
      ),
      this.repository.count(where),
    ])

    const records = buildVulnerabilityRecordList(data)
    this.logSuccess('listVulnerabilities', tenantId, { page, limit, total })

    return { data: records, pagination: buildPaginationMeta(page, limit, total) }
  }

  async getVulnerabilityById(id: string, tenantId: string): Promise<VulnerabilityRecord> {
    const vulnerability = await this.repository.findByIdAndTenant(id, tenantId)

    if (!vulnerability) {
      this.logWarn('getVulnerabilityById', tenantId, id)
      throw new BusinessException(404, 'Vulnerability not found', 'errors.vulnerabilities.notFound')
    }

    this.logSuccess('getVulnerabilityById', tenantId, { vulnerabilityId: id })
    return buildVulnerabilityRecord(vulnerability)
  }

  async createVulnerability(
    dto: CreateVulnerabilityDto,
    user: JwtPayload
  ): Promise<VulnerabilityRecord> {
    const existing = await this.repository.findByCveIdAndTenant(user.tenantId, dto.cveId)

    if (existing) {
      this.logWarn('createVulnerability', user.tenantId, dto.cveId)
      throw new BusinessException(
        409,
        `Vulnerability with CVE ID ${dto.cveId} already exists`,
        'errors.vulnerabilities.duplicateCve'
      )
    }

    const vulnerability = await this.repository.createWithTenant({
      tenantId: user.tenantId,
      cveId: dto.cveId,
      cvssScore: dto.cvssScore,
      severity: dto.severity as PrismaVulnerabilitySeverity,
      description: dto.description,
      affectedHosts: dto.affectedHosts,
      exploitAvailable: dto.exploitAvailable,
      patchStatus: dto.patchStatus as PrismaPatchStatus,
      affectedSoftware: dto.affectedSoftware ?? null,
      remediation: dto.remediation ?? null,
      discoveredAt: new Date(),
    })

    this.logSuccess('createVulnerability', user.tenantId, { cveId: dto.cveId, severity: dto.severity })
    return buildVulnerabilityRecord(vulnerability)
  }

  async updateVulnerability(
    id: string,
    dto: UpdateVulnerabilityDto,
    user: JwtPayload
  ): Promise<VulnerabilityRecord> {
    const existing = await this.repository.findExistingByIdAndTenant(id, user.tenantId)

    if (!existing) {
      this.logWarn('updateVulnerability', user.tenantId, id)
      throw new BusinessException(404, 'Vulnerability not found', 'errors.vulnerabilities.notFound')
    }

    await this.validateCveIdUniqueness(dto.cveId, existing.cveId, user.tenantId, id)

    const vulnerability = await this.repository.updateByIdAndTenant(
      id,
      user.tenantId,
      buildVulnerabilityUpdateData(dto, existing.patchStatus)
    )

    if (!vulnerability) {
      throw new BusinessException(
        404,
        `Vulnerability ${id} not found after update`,
        'errors.vulnerabilities.notFound'
      )
    }

    this.logSuccess('updateVulnerability', user.tenantId, { vulnerabilityId: id, updatedFields: Object.keys(dto) })
    return buildVulnerabilityRecord(vulnerability)
  }

  async deleteVulnerability(
    id: string,
    tenantId: string,
    email: string
  ): Promise<{ deleted: boolean }> {
    const existing = await this.repository.findExistingByIdAndTenant(id, tenantId)

    if (!existing) {
      this.logWarn('deleteVulnerability', tenantId, id)
      throw new BusinessException(404, 'Vulnerability not found', 'errors.vulnerabilities.notFound')
    }

    await this.repository.deleteByIdAndTenant(id, tenantId)
    this.logSuccess('deleteVulnerability', tenantId, { vulnerabilityId: id, cveId: existing.cveId, email })

    return { deleted: true }
  }

  async getVulnerabilityStats(tenantId: string): Promise<VulnerabilityStats> {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const [criticalCount, highCount, mediumCount, patched30dCount, exploitCount] =
      await Promise.all([
        this.repository.count({ tenantId, severity: VulnerabilitySeverity.CRITICAL }),
        this.repository.count({ tenantId, severity: VulnerabilitySeverity.HIGH }),
        this.repository.count({ tenantId, severity: VulnerabilitySeverity.MEDIUM }),
        this.repository.count({
          tenantId,
          patchStatus: PatchStatus.MITIGATED,
          patchedAt: { gte: thirtyDaysAgo },
        }),
        this.repository.count({ tenantId, exploitAvailable: true }),
      ])

    this.logSuccess('getVulnerabilityStats', tenantId, {})
    return buildVulnerabilityStats(criticalCount, highCount, mediumCount, patched30dCount, exploitCount)
  }

  private async validateCveIdUniqueness(
    newCveId: string | undefined,
    existingCveId: string,
    tenantId: string,
    excludeId: string
  ): Promise<void> {
    if (!newCveId || newCveId === existingCveId) return

    const duplicate = await this.repository.findByCveIdAndTenantExcludingId(tenantId, newCveId, excludeId)
    if (duplicate) {
      throw new BusinessException(
        409,
        `Vulnerability with CVE ID ${newCveId} already exists`,
        'errors.vulnerabilities.duplicateCve'
      )
    }
  }

  private logSuccess(action: string, tenantId: string, metadata: Record<string, unknown>): void {
    this.appLogger.info(`Vulnerability: ${action}`, {
      feature: AppLogFeature.VULNERABILITIES,
      action,
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'VulnerabilitiesService',
      functionName: action,
      targetResource: 'Vulnerability',
      metadata,
    })
  }

  private logWarn(action: string, tenantId: string, resourceId: string): void {
    this.appLogger.warn(`Vulnerability not found: ${action}`, {
      feature: AppLogFeature.VULNERABILITIES,
      action,
      outcome: AppLogOutcome.FAILURE,
      tenantId,
      targetResource: 'Vulnerability',
      targetResourceId: resourceId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'VulnerabilitiesService',
      functionName: action,
    })
  }
}
