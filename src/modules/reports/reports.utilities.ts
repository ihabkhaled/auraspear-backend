import type { UpdateReportDto } from './dto/update-report.dto'
import type { ReportRecord, ReportStats } from './reports.types'
import type { Prisma } from '@prisma/client'

/* ---------------------------------------------------------------- */
/* QUERY BUILDING                                                    */
/* ---------------------------------------------------------------- */

export function buildReportListWhere(
  tenantId: string,
  type?: string,
  status?: string,
  query?: string
): Prisma.ReportWhereInput {
  const where: Prisma.ReportWhereInput = { tenantId }

  if (type) {
    where.type = type as Prisma.ReportWhereInput['type']
  }

  if (status) {
    where.status = status as Prisma.ReportWhereInput['status']
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
  const order: 'asc' | 'desc' = sortOrder === 'asc' ? 'asc' : 'desc'
  switch (sortBy) {
    case 'createdAt':
      return { createdAt: order }
    case 'generatedAt':
      return { generatedAt: order }
    case 'name':
      return { name: order }
    case 'type':
      return { type: order }
    case 'status':
      return { status: order }
    default:
      return { createdAt: 'desc' }
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
  if (dto.format !== undefined) data['format'] = dto.format
  if (dto.status !== undefined) data['status'] = dto.status
  if (dto.parameters !== undefined) data['parameters'] = dto.parameters

  return data
}

/* ---------------------------------------------------------------- */
/* RECORD MAPPING                                                    */
/* ---------------------------------------------------------------- */

interface ReportWithTenant {
  id: string
  tenantId: string
  name: string
  description: string | null
  type: string
  format: string
  status: string
  parameters: unknown
  fileUrl: string | null
  fileSize: bigint | number | null
  generatedAt: Date | null
  generatedBy: string
  createdAt: Date
  tenant: { name: string }
}

export function buildReportRecord(
  report: ReportWithTenant,
  generatedByName: string | null
): ReportRecord {
  return {
    id: report.id,
    tenantId: report.tenantId,
    name: report.name,
    description: report.description,
    type: report.type,
    format: report.format,
    status: report.status,
    parameters: report.parameters as Record<string, unknown> | null,
    fileUrl: report.fileUrl,
    fileSize: report.fileSize ? Number(report.fileSize) : null,
    generatedAt: report.generatedAt,
    generatedBy: report.generatedBy,
    generatedByName,
    tenantName: report.tenant.name,
    createdAt: report.createdAt,
  }
}

/* ---------------------------------------------------------------- */
/* STATS BUILDING                                                    */
/* ---------------------------------------------------------------- */

export function buildReportStats(
  totalReports: number,
  completedReports: number,
  failedReports: number,
  generatingReports: number
): ReportStats {
  return {
    totalReports,
    completedReports,
    failedReports,
    generatingReports,
  }
}
