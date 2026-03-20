import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { ReportsRepository } from './reports.repository'
import {
  buildReportListWhere,
  buildReportOrderBy,
  buildReportRecord,
  buildReportTemplateRecord,
  buildReportUpdateData,
  buildReportStats,
  mergeReportParameters,
} from './reports.utilities'
import { AppLogFeature, AppLogOutcome, AppLogSourceType, ReportStatus } from '../../common/enums'
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

    const [reports, total] = await Promise.all([
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
    const report = await this.repository.createReport({
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

    await this.jobService.enqueue({
      tenantId: user.tenantId,
      type: JobType.REPORT_GENERATION,
      payload: { reportId: report.id },
      idempotencyKey: `report:${report.id}`,
      maxAttempts: 2,
      createdBy: user.email,
    })

    const generatedByName = await this.resolveGeneratorName(report.generatedBy)

    return buildReportRecord(report, generatedByName)
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
    const [tenantTemplate, systemTemplate] = await Promise.all([
      this.repository.findManyReportTemplates({
        where: {
          tenantId: user.tenantId,
          key: dto.templateKey,
          module: dto.module,
        },
        take: 1,
        include: {
          tenant: { select: { name: true } },
        },
      }),
      this.repository.findManyReportTemplates({
        where: {
          tenantId: null,
          isSystem: true,
          key: dto.templateKey,
          module: dto.module,
        },
        take: 1,
        include: {
          tenant: { select: { name: true } },
        },
      }),
    ])

    const template = tenantTemplate[0] ?? systemTemplate[0]

    if (!template) {
      throw new BusinessException(
        404,
        `Report template ${dto.templateKey} not found`,
        'errors.reports.templateNotFound'
      )
    }

    const mergedParameters = mergeReportParameters(
      template.parameters as Record<string, unknown> | null,
      dto.parameters
    )

    const report = await this.repository.createReport({
      data: {
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
      },
      include: {
        tenant: { select: { name: true } },
        template: { select: { id: true, key: true, module: true, name: true } },
      },
    })

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
      metadata: {
        templateId: template.id,
        templateKey: template.key,
        module: template.module,
      },
    })

    await this.jobService.enqueue({
      tenantId: user.tenantId,
      type: JobType.REPORT_GENERATION,
      payload: { reportId: report.id },
      idempotencyKey: `report:${report.id}`,
      maxAttempts: 2,
      createdBy: user.email,
    })

    const generatedByName = await this.resolveGeneratorName(report.generatedBy)

    return buildReportRecord(report, generatedByName)
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

    const content = JSON.parse(report.generatedContent) as GeneratedReportContent
    const safeName = report.name.replaceAll(/[^a-zA-Z0-9_-]/g, '_')

    switch (report.format) {
      case 'csv':
        return {
          filename: `${safeName}.csv`,
          contentType: 'text/csv; charset=utf-8',
          content: this.convertToCsv(content),
        }
      case 'html':
        return {
          filename: `${safeName}.html`,
          contentType: 'text/html; charset=utf-8',
          content: this.convertToHtml(content),
        }
      default:
        return {
          filename: `${safeName}.json`,
          contentType: 'application/json; charset=utf-8',
          content: JSON.stringify(content, null, 2),
        }
    }
  }

  private convertToCsv(content: GeneratedReportContent): string {
    const lines: string[] = []

    lines.push(`Report: ${content.reportName}`)
    lines.push(`Type: ${content.reportType}`)
    lines.push(`Generated: ${content.generatedAt}`)
    lines.push(`Date Range: ${content.dateRange.from} to ${content.dateRange.to}`)
    lines.push('')

    for (const section of content.sections) {
      lines.push(`# ${section.title}`)
      if (section.description) {
        lines.push(section.description)
      }

      if (section.metrics) {
        lines.push('Metric,Value')
        for (const metric of section.metrics) {
          lines.push(`"${String(metric.label)}","${String(metric.value)}"`)
        }
      }

      if (section.tables) {
        for (const table of section.tables) {
          lines.push('')
          lines.push(`## ${table.title}`)
          lines.push(table.columns.map(c => `"${c}"`).join(','))
          for (const row of table.rows) {
            const values = table.columns.map(col => {
              const cellValue = Reflect.get(row, col) as string | number | boolean | null
              return `"${String(cellValue ?? '')}"`
            })
            lines.push(values.join(','))
          }
        }
      }

      lines.push('')
    }

    return lines.join('\n')
  }

  private convertToHtml(content: GeneratedReportContent): string {
    const sectionHtml = content.sections
      .map(section => {
        let html = `<section><h2>${this.escapeHtml(section.title)}</h2>`

        if (section.description) {
          html += `<p>${this.escapeHtml(section.description)}</p>`
        }

        if (section.metrics) {
          html += '<div class="metrics">'
          for (const metric of section.metrics) {
            html += `<div class="metric"><span class="label">${this.escapeHtml(String(metric.label))}</span><span class="value">${this.escapeHtml(String(metric.value))}</span></div>`
          }
          html += '</div>'
        }

        if (section.tables) {
          for (const table of section.tables) {
            html += `<h3>${this.escapeHtml(table.title)}</h3><table><thead><tr>`
            for (const col of table.columns) {
              html += `<th>${this.escapeHtml(col)}</th>`
            }
            html += '</tr></thead><tbody>'
            for (const row of table.rows) {
              html += '<tr>'
              for (const col of table.columns) {
                const cellValue = Reflect.get(row, col) as string | number | boolean | null
                html += `<td>${this.escapeHtml(String(cellValue ?? ''))}</td>`
              }
              html += '</tr>'
            }
            html += '</tbody></table>'
          }
        }

        html += '</section>'
        return html
      })
      .join('\n')

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${this.escapeHtml(content.reportName)}</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 960px; margin: 0 auto; padding: 2rem; background: #0f172a; color: #e2e8f0; }
h1 { color: #22d3ee; border-bottom: 2px solid #22d3ee; padding-bottom: 0.5rem; }
h2 { color: #67e8f9; margin-top: 2rem; }
h3 { color: #a5f3fc; }
.meta { color: #94a3b8; margin-bottom: 2rem; }
.metrics { display: flex; flex-wrap: wrap; gap: 1rem; margin: 1rem 0; }
.metric { background: #1e293b; border: 1px solid #334155; border-radius: 0.5rem; padding: 1rem; min-width: 150px; }
.metric .label { display: block; color: #94a3b8; font-size: 0.875rem; text-transform: uppercase; }
.metric .value { display: block; font-size: 1.5rem; font-weight: 700; color: #f1f5f9; margin-top: 0.25rem; }
table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
th { background: #1e293b; color: #94a3b8; padding: 0.75rem; text-align: left; font-size: 0.875rem; text-transform: uppercase; border-bottom: 2px solid #334155; }
td { padding: 0.75rem; border-bottom: 1px solid #1e293b; }
tr:nth-child(even) { background: rgba(255,255,255,0.02); }
section { margin-bottom: 2rem; }
</style>
</head>
<body>
<h1>${this.escapeHtml(content.reportName)}</h1>
<div class="meta">
<p>Type: ${this.escapeHtml(content.reportType)} | Generated: ${this.escapeHtml(content.generatedAt)}</p>
<p>Period: ${this.escapeHtml(content.dateRange.from)} to ${this.escapeHtml(content.dateRange.to)}</p>
</div>
${sectionHtml}
</body>
</html>`
  }

  private escapeHtml(text: string): string {
    return text
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;')
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
