import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { ReportsRepository } from './reports.repository'
import {
  buildReportDownloadResponse,
  buildReportListWhere,
  buildReportOrderBy,
  buildReportRecord,
  buildReportTemplateRecord,
  buildReportUpdateData,
  buildReportStats,
  mergeReportParameters,
} from './reports.utilities'
import {
  AppLogFeature,
  AppLogOutcome,
  AppLogSourceType,
  ReportModule,
  ReportStatus,
  ReportTemplateKey,
} from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import { JobType } from '../jobs/enums/job.enums'
import { JobService } from '../jobs/jobs.service'
import type { CreateReportFromTemplateDto } from './dto/create-report-from-template.dto'
import type { CreateReportDto } from './dto/create-report.dto'
import type { UpdateReportDto } from './dto/update-report.dto'
import type {
  GeneratedReportContent,
  PaginatedReports,
  ReportDownloadResponse,
  ReportRecord,
  ReportStats,
  ReportTemplateRecord,
  ReportTemplateWithTenant,
  ReportWithRelations,
} from './reports.types'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name)

  constructor(
    private readonly repository: ReportsRepository,
    private readonly appLogger: AppLoggerService,
    private readonly jobService: JobService
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

  private buildGeneratedReportName(templateName: string): string {
    const dateStamp = new Date().toISOString().slice(0, 10)
    return `${templateName} - ${dateStamp}`
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
    module?: string,
    status?: string,
    query?: string,
    format?: string
  ): Promise<PaginatedReports> {
    const where = buildReportListWhere(tenantId, type, module, status, query, format)

    const [reports, total] = await this.fetchReportsPage(where, page, limit, sortBy, sortOrder)
    const generatorsMap = await this.resolveGeneratorNamesBatch(reports.map(r => r.generatedBy))

    const data: ReportRecord[] = reports.map(r =>
      buildReportRecord(r, generatorsMap.get(r.generatedBy) ?? null)
    )

    return { data, pagination: buildPaginationMeta(page, limit, total) }
  }

  private async fetchReportsPage(
    where: Prisma.ReportWhereInput,
    page: number,
    limit: number,
    sortBy?: string,
    sortOrder?: string
  ): Promise<[ReportWithRelations[], number]> {
    return Promise.all([
      this.repository.findManyReports({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: buildReportOrderBy(sortBy, sortOrder),
        include: {
          tenant: { select: { name: true } },
          template: { select: { id: true, key: true, module: true, name: true } },
        },
      }),
      this.repository.countReports(where),
    ])
  }

  /* ---------------------------------------------------------------- */
  /* GET REPORT BY ID                                                  */
  /* ---------------------------------------------------------------- */

  async getReportById(id: string, tenantId: string): Promise<ReportRecord> {
    const report = await this.repository.findFirstReport({
      where: { id, tenantId },
      include: {
        tenant: { select: { name: true } },
        template: { select: { id: true, key: true, module: true, name: true } },
      },
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
    const report = await this.persistNewReport(dto, user)

    this.logReportCreated('createReport', user, report)
    await this.enqueueReportGeneration(user, report.id)

    const generatedByName = await this.resolveGeneratorName(report.generatedBy)
    return buildReportRecord(report, generatedByName)
  }

  private async persistNewReport(
    dto: CreateReportDto,
    user: JwtPayload
  ): Promise<ReportWithRelations> {
    return this.repository.createReport({
      data: {
        tenantId: user.tenantId,
        name: dto.name,
        description: dto.description ?? null,
        type: dto.type,
        module: dto.module,
        templateKey: dto.templateKey,
        format: dto.format,
        status: ReportStatus.GENERATING,
        parameters: dto.parameters ? (dto.parameters as Prisma.InputJsonValue) : Prisma.DbNull,
        filterSnapshot: dto.filterSnapshot
          ? (dto.filterSnapshot as Prisma.InputJsonValue)
          : Prisma.DbNull,
        generatedBy: user.email,
      },
      include: {
        tenant: { select: { name: true } },
        template: { select: { id: true, key: true, module: true, name: true } },
      },
    })
  }

  private logReportCreated(
    action: string,
    user: JwtPayload,
    report: ReportWithRelations
  ): void {
    this.appLogger.info('Report created', {
      feature: AppLogFeature.REPORTS,
      action,
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'Report',
      targetResourceId: report.id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'ReportsService',
      functionName: action,
      metadata: { name: report.name, type: report.type, format: report.format },
    })
  }

  private async enqueueReportGeneration(user: JwtPayload, reportId: string): Promise<void> {
    await this.jobService.enqueue({
      tenantId: user.tenantId,
      type: JobType.REPORT_GENERATION,
      payload: { reportId },
      idempotencyKey: `report:${reportId}`,
      maxAttempts: 2,
      createdBy: user.email,
    })
  }

  /* ---------------------------------------------------------------- */
  /* LIST REPORT TEMPLATES                                             */
  /* ---------------------------------------------------------------- */

  async listReportTemplates(tenantId: string, module?: string): Promise<ReportTemplateRecord[]> {
    const templates = await this.repository.findManyReportTemplates({
      where: {
        ...(module ? { module: module as Prisma.ReportTemplateWhereInput['module'] } : {}),
        OR: [{ tenantId }, { tenantId: null, isSystem: true }],
      },
      orderBy: [{ tenantId: 'desc' }, { createdAt: 'asc' }],
      include: {
        tenant: { select: { name: true } },
      },
    })

    return templates.map(template => buildReportTemplateRecord(template))
  }

  /* ---------------------------------------------------------------- */
  /* CREATE REPORT FROM TEMPLATE                                       */
  /* ---------------------------------------------------------------- */

  async createReportFromTemplate(
    dto: CreateReportFromTemplateDto,
    user: JwtPayload
  ): Promise<ReportRecord> {
    const template = await this.resolveTemplate(user.tenantId, dto.templateKey, dto.module)
    const report = await this.createReportFromResolvedTemplate(template, dto, user)

    this.logTemplateReportCreated(user, report, template)
    await this.enqueueReportGeneration(user, report.id)

    const generatedByName = await this.resolveGeneratorName(report.generatedBy)
    return buildReportRecord(report, generatedByName)
  }

  private logTemplateReportCreated(
    user: JwtPayload,
    report: ReportWithRelations,
    template: ReportTemplateWithTenant
  ): void {
    this.appLogger.info('Report created from template', {
      feature: AppLogFeature.REPORTS,
      action: 'createReportFromTemplate',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'Report',
      targetResourceId: report.id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'ReportsService',
      functionName: 'createReportFromTemplate',
      metadata: { templateId: template.id, templateKey: template.key, module: template.module },
    })
  }

  private async resolveTemplate(
    tenantId: string,
    templateKey: string,
    module: string
  ): Promise<ReportTemplateWithTenant> {
    const [tenantTemplate, systemTemplate] = await Promise.all([
      this.repository.findManyReportTemplates({
        where: { tenantId, key: templateKey as ReportTemplateKey, module: module as ReportModule },
        take: 1,
        include: { tenant: { select: { name: true } } },
      }),
      this.repository.findManyReportTemplates({
        where: { tenantId: null, isSystem: true, key: templateKey as ReportTemplateKey, module: module as ReportModule },
        take: 1,
        include: { tenant: { select: { name: true } } },
      }),
    ])

    const template = tenantTemplate[0] ?? systemTemplate[0]

    if (!template) {
      throw new BusinessException(
        404,
        `Report template ${templateKey} not found`,
        'errors.reports.templateNotFound'
      )
    }

    return template
  }

  private async createReportFromResolvedTemplate(
    template: ReportTemplateWithTenant,
    dto: CreateReportFromTemplateDto,
    user: JwtPayload
  ): Promise<ReportWithRelations> {
    const mergedParameters = mergeReportParameters(
      template.parameters as Record<string, unknown> | null,
      dto.parameters
    )

    return this.repository.createReport({
      data: this.buildTemplateReportData(template, dto, user, mergedParameters),
      include: {
        tenant: { select: { name: true } },
        template: { select: { id: true, key: true, module: true, name: true } },
      },
    })
  }

  private buildTemplateReportData(
    template: ReportTemplateWithTenant,
    dto: CreateReportFromTemplateDto,
    user: JwtPayload,
    mergedParameters: Record<string, unknown> | null
  ): Prisma.ReportUncheckedCreateInput {
    return {
      tenantId: user.tenantId,
      templateId: template.id,
      name: dto.name ?? this.buildGeneratedReportName(template.name),
      description: dto.description ?? template.description ?? null,
      type: template.type,
      module: template.module,
      templateKey: template.key,
      format: dto.format ?? template.defaultFormat,
      status: ReportStatus.GENERATING,
      parameters: mergedParameters ? (mergedParameters as Prisma.InputJsonValue) : Prisma.DbNull,
      filterSnapshot: dto.filterSnapshot
        ? (dto.filterSnapshot as Prisma.InputJsonValue)
        : Prisma.DbNull,
      generatedBy: user.email,
    }
  }

  /* ---------------------------------------------------------------- */
  /* UPDATE REPORT                                                     */
  /* ---------------------------------------------------------------- */

  async updateReport(id: string, dto: UpdateReportDto, user: JwtPayload): Promise<ReportRecord> {
    await this.getReportById(id, user.tenantId)

    const updated = await this.repository.updateManyReports({
      where: { id, tenantId: user.tenantId },
      data: buildReportUpdateData(dto),
    })

    if (updated.count === 0) {
      throw new BusinessException(404, `Report ${id} not found`, 'errors.reports.notFound')
    }

    this.appLogger.info('Report updated', {
      feature: AppLogFeature.REPORTS,
      action: 'updateReport',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'Report',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'ReportsService',
      functionName: 'updateReport',
      metadata: { updatedFields: Object.keys(dto) },
    })

    return this.getReportById(id, user.tenantId)
  }

  /* ---------------------------------------------------------------- */
  /* EXPORT REPORT                                                     */
  /* ---------------------------------------------------------------- */

  async exportReport(id: string, tenantId: string, user: JwtPayload): Promise<ReportRecord> {
    const report = await this.getReportById(id, tenantId)

    if (report.status !== ReportStatus.COMPLETED) {
      throw new BusinessException(
        400,
        'Only completed reports can be exported',
        'errors.reports.notCompleted'
      )
    }

    this.appLogger.info('Report exported', {
      feature: AppLogFeature.REPORTS,
      action: 'exportReport',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'Report',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'ReportsService',
      functionName: 'exportReport',
      metadata: { name: report.name, format: report.format },
    })

    return report
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
  /* DOWNLOAD REPORT                                                   */
  /* ---------------------------------------------------------------- */

  async downloadReport(id: string, tenantId: string): Promise<ReportDownloadResponse> {
    const report = await this.fetchAndValidateReportForDownload(id, tenantId)
    const content = JSON.parse(report.generatedContent) as GeneratedReportContent

    return buildReportDownloadResponse(report.name, report.format, content)
  }

  private async fetchAndValidateReportForDownload(
    id: string,
    tenantId: string
  ): Promise<{ name: string; format: string; generatedContent: string }> {
    const report = await this.repository.findFirstReport({
      where: { id, tenantId },
      include: {
        tenant: { select: { name: true } },
        template: { select: { id: true, key: true, module: true, name: true } },
      },
    })

    if (!report) {
      throw new BusinessException(404, `Report ${id} not found`, 'errors.reports.notFound')
    }

    if (report.status !== ReportStatus.COMPLETED) {
      throw new BusinessException(
        400,
        'Only completed reports can be downloaded',
        'errors.reports.notCompleted'
      )
    }

    if (!report.generatedContent) {
      throw new BusinessException(
        404,
        'Report content not available',
        'errors.reports.contentNotAvailable'
      )
    }

    return { name: report.name, format: report.format, generatedContent: report.generatedContent }
  }

  /* ---------------------------------------------------------------- */
  /* STATS                                                             */
  /* ---------------------------------------------------------------- */

  async getReportStats(tenantId: string): Promise<ReportStats> {
    const [totalReports, completedReports, failedReports, generatingReports, availableTemplates] =
      await Promise.all([
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
        this.repository.countReportTemplates({
          OR: [{ tenantId }, { tenantId: null, isSystem: true }],
        }),
      ])

    return buildReportStats(
      totalReports,
      completedReports,
      failedReports,
      generatingReports,
      availableTemplates
    )
  }
}
