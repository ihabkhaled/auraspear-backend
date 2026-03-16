import { Injectable, Logger } from '@nestjs/common'
import { VulnerabilitiesRepository } from './vulnerabilities.repository'
import {
  buildVulnerabilityListWhere,
  buildVulnerabilityOrderBy,
  buildVulnerabilityUpdateData,
  buildVulnerabilityStats,
} from './vulnerabilities.utilities'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../common/enums'
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
    const where = buildVulnerabilityListWhere(
      tenantId,
      severity,
      patchStatus,
      exploitAvailable,
      query
    )

    try {
      const [data, total] = await Promise.all([
        this.repository.findManyWithTenant(
          where,
          buildVulnerabilityOrderBy(sortBy, sortOrder),
          (page - 1) * limit,
          limit
        ),
        this.repository.count(where),
      ])

      const records: VulnerabilityRecord[] = data.map(({ tenant, ...rest }) => ({
        ...rest,
        tenantName: tenant.name,
      }))

      this.appLogger.info(`Listed vulnerabilities page=${page} limit=${limit} total=${total}`, {
        feature: AppLogFeature.VULNERABILITIES,
        action: 'listVulnerabilities',
        outcome: AppLogOutcome.SUCCESS,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'VulnerabilitiesService',
        functionName: 'listVulnerabilities',
        metadata: {
          page,
          limit,
          total,
          severity: severity ?? null,
          patchStatus: patchStatus ?? null,
        },
      })

      return {
        data: records,
        pagination: buildPaginationMeta(page, limit, total),
      }
    } catch (error: unknown) {
      this.appLogger.error('Failed to list vulnerabilities', {
        feature: AppLogFeature.VULNERABILITIES,
        action: 'listVulnerabilities',
        outcome: AppLogOutcome.FAILURE,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'VulnerabilitiesService',
        functionName: 'listVulnerabilities',
        stackTrace: error instanceof Error ? error.stack : undefined,
      })
      throw error
    }
  }

  async getVulnerabilityById(id: string, tenantId: string): Promise<VulnerabilityRecord> {
    const vulnerability = await this.repository.findByIdAndTenant(id, tenantId)

    if (!vulnerability) {
      this.appLogger.warn(`Vulnerability not found id=${id}`, {
        feature: AppLogFeature.VULNERABILITIES,
        action: 'getVulnerabilityById',
        outcome: AppLogOutcome.FAILURE,
        tenantId,
        targetResource: 'Vulnerability',
        targetResourceId: id,
        sourceType: AppLogSourceType.SERVICE,
        className: 'VulnerabilitiesService',
        functionName: 'getVulnerabilityById',
      })
      throw new BusinessException(404, 'Vulnerability not found', 'errors.vulnerabilities.notFound')
    }

    this.appLogger.info(`Retrieved vulnerability id=${id}`, {
      feature: AppLogFeature.VULNERABILITIES,
      action: 'getVulnerabilityById',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      targetResource: 'Vulnerability',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'VulnerabilitiesService',
      functionName: 'getVulnerabilityById',
    })

    const { tenant, ...rest } = vulnerability
    return {
      ...rest,
      tenantName: tenant.name,
    }
  }

  async createVulnerability(
    dto: CreateVulnerabilityDto,
    user: JwtPayload
  ): Promise<VulnerabilityRecord> {
    const existing = await this.repository.findByCveIdAndTenant(user.tenantId, dto.cveId)

    if (existing) {
      this.appLogger.warn(`Duplicate CVE ID ${dto.cveId} for tenant ${user.tenantId}`, {
        feature: AppLogFeature.VULNERABILITIES,
        action: 'createVulnerability',
        outcome: AppLogOutcome.DENIED,
        tenantId: user.tenantId,
        actorEmail: user.email,
        targetResource: 'Vulnerability',
        sourceType: AppLogSourceType.SERVICE,
        className: 'VulnerabilitiesService',
        functionName: 'createVulnerability',
        metadata: { cveId: dto.cveId },
      })
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

    this.appLogger.info(`Created vulnerability ${dto.cveId}`, {
      feature: AppLogFeature.VULNERABILITIES,
      action: 'createVulnerability',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      targetResource: 'Vulnerability',
      targetResourceId: vulnerability.id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'VulnerabilitiesService',
      functionName: 'createVulnerability',
      metadata: { cveId: dto.cveId, severity: dto.severity },
    })

    const { tenant: createdTenant, ...createdRest } = vulnerability
    return {
      ...createdRest,
      tenantName: createdTenant.name,
    }
  }

  async updateVulnerability(
    id: string,
    dto: UpdateVulnerabilityDto,
    user: JwtPayload
  ): Promise<VulnerabilityRecord> {
    const existing = await this.repository.findExistingByIdAndTenant(id, user.tenantId)

    if (!existing) {
      this.appLogger.warn(`Vulnerability not found for update id=${id}`, {
        feature: AppLogFeature.VULNERABILITIES,
        action: 'updateVulnerability',
        outcome: AppLogOutcome.FAILURE,
        tenantId: user.tenantId,
        actorEmail: user.email,
        targetResource: 'Vulnerability',
        targetResourceId: id,
        sourceType: AppLogSourceType.SERVICE,
        className: 'VulnerabilitiesService',
        functionName: 'updateVulnerability',
      })
      throw new BusinessException(404, 'Vulnerability not found', 'errors.vulnerabilities.notFound')
    }

    // If cveId is being changed, check for duplicates
    if (dto.cveId && dto.cveId !== existing.cveId) {
      const duplicate = await this.repository.findByCveIdAndTenantExcludingId(
        user.tenantId,
        dto.cveId,
        id
      )
      if (duplicate) {
        throw new BusinessException(
          409,
          `Vulnerability with CVE ID ${dto.cveId} already exists`,
          'errors.vulnerabilities.duplicateCve'
        )
      }
    }

    const updateData = buildVulnerabilityUpdateData(dto, existing.patchStatus)

    const vulnerability = await this.repository.updateByIdAndTenant(id, user.tenantId, updateData)

    this.appLogger.info(`Updated vulnerability id=${id}`, {
      feature: AppLogFeature.VULNERABILITIES,
      action: 'updateVulnerability',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      targetResource: 'Vulnerability',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'VulnerabilitiesService',
      functionName: 'updateVulnerability',
      metadata: { updatedFields: Object.keys(dto) },
    })

    const { tenant: updatedTenant, ...updatedRest } = vulnerability
    return {
      ...updatedRest,
      tenantName: updatedTenant.name,
    }
  }

  async deleteVulnerability(
    id: string,
    tenantId: string,
    email: string
  ): Promise<{ deleted: boolean }> {
    const existing = await this.repository.findExistingByIdAndTenant(id, tenantId)

    if (!existing) {
      this.appLogger.warn(`Vulnerability not found for deletion id=${id}`, {
        feature: AppLogFeature.VULNERABILITIES,
        action: 'deleteVulnerability',
        outcome: AppLogOutcome.FAILURE,
        tenantId,
        actorEmail: email,
        targetResource: 'Vulnerability',
        targetResourceId: id,
        sourceType: AppLogSourceType.SERVICE,
        className: 'VulnerabilitiesService',
        functionName: 'deleteVulnerability',
      })
      throw new BusinessException(404, 'Vulnerability not found', 'errors.vulnerabilities.notFound')
    }

    await this.repository.deleteByIdAndTenant(id, tenantId)

    this.appLogger.info(`Deleted vulnerability id=${id} cveId=${existing.cveId}`, {
      feature: AppLogFeature.VULNERABILITIES,
      action: 'deleteVulnerability',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      actorEmail: email,
      targetResource: 'Vulnerability',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'VulnerabilitiesService',
      functionName: 'deleteVulnerability',
      metadata: { cveId: existing.cveId },
    })

    return { deleted: true }
  }

  async getVulnerabilityStats(tenantId: string): Promise<VulnerabilityStats> {
    try {
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

      const [criticalCount, highCount, mediumCount, patched30dCount, exploitCount] =
        await Promise.all([
          this.repository.count({ tenantId, severity: 'critical' }),
          this.repository.count({ tenantId, severity: 'high' }),
          this.repository.count({ tenantId, severity: 'medium' }),
          this.repository.count({
            tenantId,
            patchStatus: 'mitigated',
            patchedAt: { gte: thirtyDaysAgo },
          }),
          this.repository.count({ tenantId, exploitAvailable: true }),
        ])

      this.appLogger.info('Retrieved vulnerability stats', {
        feature: AppLogFeature.VULNERABILITIES,
        action: 'getVulnerabilityStats',
        outcome: AppLogOutcome.SUCCESS,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'VulnerabilitiesService',
        functionName: 'getVulnerabilityStats',
      })

      return buildVulnerabilityStats(
        criticalCount,
        highCount,
        mediumCount,
        patched30dCount,
        exploitCount
      )
    } catch (error: unknown) {
      this.appLogger.error('Failed to retrieve vulnerability stats', {
        feature: AppLogFeature.VULNERABILITIES,
        action: 'getVulnerabilityStats',
        outcome: AppLogOutcome.FAILURE,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'VulnerabilitiesService',
        functionName: 'getVulnerabilityStats',
        stackTrace: error instanceof Error ? error.stack : undefined,
      })
      throw error
    }
  }
}
