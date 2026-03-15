import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { ReportsRepository } from './reports.repository'
import {
  buildReportListWhere,
  buildReportOrderBy,
  buildReportRecord,
  buildReportStats,
} from './reports.utils'
import { AppLogFeature, AppLogOutcome, AppLogSourceType, ReportStatus } from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import type { CreateReportDto } from './dto/create-report.dto'
import type { ReportRecord, PaginatedReports, ReportStats } from './reports.types'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name)

  constructor(
    private readonly repository: ReportsRepository,
    private readonly appLogger: AppLoggerService
  ) {}

  /* ---------------------------------------------------------------- */
  /* RESOLVE HELPERS                                                    */
  /* ---------------------------------------------------------------- */

  private async resolveGeneratorName(email: string | null): Promise<string | null> {
    if (!email) return null
    const user = await this.repository.findUserByEmail(email)
    return user?.name ?? null
  }

  private async resolveGeneratorNamesBatch(
    emails: (string | null)[]
  ): Promise<Map<string, string>> {
    const uniqueEmails = [...new Set(emails.filter((e): e is string => e !== null))]
    if (uniqueEmails.length === 0) return new Map()
    const users = await this.repository.findUsersByEmails(uniqueEmails)
    const map = new Map<string, string>()
    for (const u of users) {
      map.set(u.email, u.name)
    }
    return map
  }

  /* ---------------------------------------------------------------- */
  /* LIST REPORTS (paginated, tenant-scoped)                           */
  /* ---------------------------------------------------------------- */

  async listReports(
    tenantId: string,
    page = 1,
    limit = 20,
    sortBy?: string,
    sortOrder?: string,
    type?: string,
    status?: string,
    query?: string
  ): Promise<PaginatedReports> {
    const where = buildReportListWhere(tenantId, type, status, query)

    const [reports, total] = await Promise.all([
      this.repository.findManyReports({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: buildReportOrderBy(sortBy, sortOrder),
        include: { tenant: { select: { name: true } } },
      }),
      this.repository.countReports(where),
    ])

    const generatorsMap = await this.resolveGeneratorNamesBatch(reports.map(r => r.generatedBy))

    const data: ReportRecord[] = reports.map(r =>
      buildReportRecord(r, generatorsMap.get(r.generatedBy) ?? null)
    )

    return {
      data,
      pagination: buildPaginationMeta(page, limit, total),
    }
  }

  /* ---------------------------------------------------------------- */
  /* GET REPORT BY ID                                                  */
  /* ---------------------------------------------------------------- */

  async getReportById(id: string, tenantId: string): Promise<ReportRecord> {
    const report = await this.repository.findFirstReport({
      where: { id, tenantId },
      include: { tenant: { select: { name: true } } },
    })

    if (!report) {
      this.appLogger.warn('Report not found', {
        feature: AppLogFeature.REPORTS,
        action: 'getReportById',
        className: 'ReportsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { reportId: id, tenantId },
      })
      throw new BusinessException(404, `Report ${id} not found`, 'errors.reports.notFound')
    }

    const generatedByName = await this.resolveGeneratorName(report.generatedBy)

    return buildReportRecord(report, generatedByName)
  }

  /* ---------------------------------------------------------------- */
  /* CREATE REPORT                                                     */
  /* ---------------------------------------------------------------- */

  async createReport(dto: CreateReportDto, user: JwtPayload): Promise<ReportRecord> {
    const report = await this.repository.createReport({
      data: {
        tenantId: user.tenantId,
        name: dto.name,
        description: dto.description ?? null,
        type: dto.type,
        format: dto.format,
        status: ReportStatus.GENERATING,
        parameters: dto.parameters ? (dto.parameters as Prisma.InputJsonValue) : Prisma.DbNull,
        generatedBy: user.email,
      },
      include: { tenant: { select: { name: true } } },
    })

    this.appLogger.info('Report created', {
      feature: AppLogFeature.REPORTS,
      action: 'createReport',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'Report',
      targetResourceId: report.id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'ReportsService',
      functionName: 'createReport',
      metadata: { name: report.name, type: report.type, format: report.format },
    })

    const generatedByName = await this.resolveGeneratorName(report.generatedBy)

    return buildReportRecord(report, generatedByName)
  }

  /* ---------------------------------------------------------------- */
  /* DELETE REPORT                                                     */
  /* ---------------------------------------------------------------- */

  async deleteReport(id: string, tenantId: string, actor: string): Promise<{ deleted: boolean }> {
    const existing = await this.getReportById(id, tenantId)

    await this.repository.deleteManyReports({
      where: { id, tenantId },
    })

    this.appLogger.info(`Report ${existing.name} deleted`, {
      feature: AppLogFeature.REPORTS,
      action: 'deleteReport',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      actorEmail: actor,
      targetResource: 'Report',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'ReportsService',
      functionName: 'deleteReport',
      metadata: { name: existing.name },
    })

    return { deleted: true }
  }

  /* ---------------------------------------------------------------- */
  /* STATS                                                             */
  /* ---------------------------------------------------------------- */

  async getReportStats(tenantId: string): Promise<ReportStats> {
    const [totalReports, completedReports, failedReports, generatingReports] = await Promise.all([
      this.repository.countReports({ tenantId }),
      this.repository.countReports({
        tenantId,
        status: ReportStatus.COMPLETED,
      }),
      this.repository.countReports({
        tenantId,
        status: ReportStatus.FAILED,
      }),
      this.repository.countReports({
        tenantId,
        status: ReportStatus.GENERATING,
      }),
    ])

    return buildReportStats(totalReports, completedReports, failedReports, generatingReports)
  }
}
