import { SortOrder } from '../../common/enums'
import { toSortOrder } from '../../common/utils/query.utility'
import type { UpdateReportDto } from './dto/update-report.dto'
import type {
  ReportRecord,
  ReportStats,
  ReportTemplateRecord,
  ReportTemplateWithTenant,
  ReportWithRelations,
} from './reports.types'
import type { Prisma } from '@prisma/client'

/* ---------------------------------------------------------------- */
/* QUERY BUILDING                                                    */
/* ---------------------------------------------------------------- */

export function buildReportListWhere(
  tenantId: string,
  type?: string,
  module?: string,
  status?: string,
  query?: string,
  format?: string
): Prisma.ReportWhereInput {
  const where: Prisma.ReportWhereInput = { tenantId }

  if (type) {
    where.type = type as Prisma.ReportWhereInput['type']
  }

  if (module) {
    where.module = module as Prisma.ReportWhereInput['module']
  }

  if (status) {
    where.status = status as Prisma.ReportWhereInput['status']
  }

  if (format) {
    where.format = format as Prisma.ReportWhereInput['format']
  }

  if (query && query.trim().length > 0) {
    where.OR = [
      { name: { contains: query, mode: 'insensitive' } },
      { description: { contains: query, mode: 'insensitive' } },
    ]
  }

  return where
}

export function buildReportOrderBy(
  sortBy?: string,
  sortOrder?: string
): Prisma.ReportOrderByWithRelationInput {
  const order = toSortOrder(sortOrder)
  switch (sortBy) {
    case 'createdAt':
      return { createdAt: order }
    case 'generatedAt':
      return { generatedAt: order }
    case 'module':
      return { module: order }
    case 'name':
      return { name: order }
    case 'type':
      return { type: order }
    case 'status':
      return { status: order }
    case 'format':
      return { format: order }
    default:
      return { createdAt: SortOrder.DESC }
  }
}

/* ---------------------------------------------------------------- */
/* UPDATE DATA BUILDING                                              */
/* ---------------------------------------------------------------- */

export function buildReportUpdateData(dto: UpdateReportDto): Record<string, unknown> {
  const data: Record<string, unknown> = {}

  if (dto.name !== undefined) data['name'] = dto.name
  if (dto.description !== undefined) data['description'] = dto.description
  if (dto.type !== undefined) data['type'] = dto.type
  if (dto.module !== undefined) data['module'] = dto.module
  if (dto.templateKey !== undefined) data['templateKey'] = dto.templateKey
  if (dto.format !== undefined) data['format'] = dto.format
  if (dto.status !== undefined) data['status'] = dto.status
  if (dto.parameters !== undefined) data['parameters'] = dto.parameters
  if (dto.filterSnapshot !== undefined) data['filterSnapshot'] = dto.filterSnapshot

  return data
}

export function mergeReportParameters(
  templateParameters: Record<string, unknown> | null,
  overrideParameters?: Record<string, unknown>
): Record<string, unknown> | null {
  if (!templateParameters && !overrideParameters) {
    return null
  }

  return {
    ...(templateParameters ?? {}),
    ...(overrideParameters ?? {}),
  }
}

/* ---------------------------------------------------------------- */
/* RECORD MAPPING                                                    */
/* ---------------------------------------------------------------- */

export function buildReportRecord(
  report: ReportWithRelations,
  generatedByName: string | null
): ReportRecord {
  return {
    id: report.id,
    tenantId: report.tenantId,
    templateId: report.templateId ?? null,
    name: report.name,
    description: report.description,
    type: report.type,
    module: report.module ?? null,
    templateKey: report.templateKey ?? null,
    templateName: report.template?.name ?? null,
    format: report.format,
    status: report.status,
    parameters: report.parameters as Record<string, unknown> | null,
    filterSnapshot: report.filterSnapshot as Record<string, unknown> | null,
    fileUrl: report.fileUrl,
    fileSize: report.fileSize ? String(report.fileSize) : null,
    generatedAt: report.generatedAt,
    generatedBy: report.generatedBy,
    generatedByName,
    tenantName: report.tenant.name,
    createdAt: report.createdAt,
  }
}

export function buildReportTemplateRecord(
  template: ReportTemplateWithTenant
): ReportTemplateRecord {
  return {
    id: template.id,
    tenantId: template.tenantId ?? null,
    key: template.key,
    module: template.module,
    name: template.name,
    description: template.description,
    type: template.type,
    defaultFormat: template.defaultFormat,
    parameters: template.parameters as Record<string, unknown> | null,
    isSystem: template.isSystem,
    tenantName: template.tenant?.name ?? null,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  }
}

/* ---------------------------------------------------------------- */
/* STATS BUILDING                                                    */
/* ---------------------------------------------------------------- */

export function buildReportStats(
  totalReports: number,
  completedReports: number,
  failedReports: number,
  generatingReports: number,
  availableTemplates: number
): ReportStats {
  return {
    totalReports,
    completedReports,
    failedReports,
    generatingReports,
    availableTemplates,
  }
}
