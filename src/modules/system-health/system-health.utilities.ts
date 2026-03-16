import { ServiceStatus } from '../../common/enums'
import type { HealthCheckRecord, MetricRecord, SystemHealthStats } from './system-health.types'
import type { Prisma } from '@prisma/client'

/* ---------------------------------------------------------------- */
/* QUERY BUILDING                                                    */
/* ---------------------------------------------------------------- */

export function buildHealthCheckListWhere(
  tenantId: string,
  serviceType?: string,
  status?: string
): Prisma.SystemHealthCheckWhereInput {
  const where: Prisma.SystemHealthCheckWhereInput = { tenantId }

  if (serviceType) {
    where.serviceType = serviceType as Prisma.EnumServiceTypeFilter
  }

  if (status) {
    where.status = status as Prisma.EnumServiceStatusFilter
  }

  return where
}

export function buildHealthCheckOrderBy(
  sortBy?: string,
  sortOrder?: string
): Prisma.SystemHealthCheckOrderByWithRelationInput {
  const order = sortOrder === 'asc' ? 'asc' : 'desc'
  switch (sortBy) {
    case 'serviceName':
      return { serviceName: order }
    case 'status':
      return { status: order }
    case 'responseTimeMs':
      return { responseTimeMs: order }
    case 'checkedAt':
    default:
      return { lastCheckedAt: order }
  }
}

export function buildMetricListWhere(
  tenantId: string,
  metricType?: string,
  metricName?: string
): Prisma.SystemMetricWhereInput {
  const where: Prisma.SystemMetricWhereInput = { tenantId }

  if (metricType) {
    where.metricType = metricType as Prisma.EnumMetricTypeFilter
  }

  if (metricName) {
    where.metricName = { contains: metricName, mode: 'insensitive' }
  }

  return where
}

export function buildMetricOrderBy(
  sortBy?: string,
  sortOrder?: string
): Prisma.SystemMetricOrderByWithRelationInput {
  const order = sortOrder === 'asc' ? 'asc' : 'desc'
  switch (sortBy) {
    case 'metricName':
      return { metricName: order }
    case 'value':
      return { value: order }
    case 'recordedAt':
    default:
      return { recordedAt: order }
  }
}

/* ---------------------------------------------------------------- */
/* RECORD MAPPING                                                    */
/* ---------------------------------------------------------------- */

interface HealthCheckEntity {
  id: string
  tenantId: string
  serviceName: string
  serviceType: string
  status: string
  responseTimeMs: number | null
  errorMessage: string | null
  metadata: unknown
  lastCheckedAt: Date
  createdAt: Date
}

export function buildHealthCheckRecord(hc: HealthCheckEntity): HealthCheckRecord {
  return {
    id: hc.id,
    tenantId: hc.tenantId,
    serviceName: hc.serviceName,
    serviceType: hc.serviceType,
    status: hc.status,
    responseTimeMs: hc.responseTimeMs,
    message: hc.errorMessage,
    metadata: hc.metadata as Record<string, unknown> | null,
    checkedAt: hc.lastCheckedAt,
    createdAt: hc.createdAt,
  }
}

interface MetricEntity {
  id: string
  tenantId: string
  metricName: string
  metricType: string
  value: number
  unit: string | null
  tags: unknown
  recordedAt: Date
  createdAt: Date
}

export function buildMetricRecord(m: MetricEntity): MetricRecord {
  return {
    id: m.id,
    tenantId: m.tenantId,
    metricName: m.metricName,
    metricType: m.metricType,
    value: m.value,
    unit: m.unit,
    tags: m.tags as Record<string, unknown> | null,
    recordedAt: m.recordedAt,
    createdAt: m.createdAt,
  }
}

/* ---------------------------------------------------------------- */
/* STATS BUILDING                                                    */
/* ---------------------------------------------------------------- */

export function buildSystemHealthStats(latestChecks: HealthCheckRecord[]): SystemHealthStats {
  const totalServices = latestChecks.length
  const healthyServices = latestChecks.filter(hc => hc.status === ServiceStatus.HEALTHY).length
  const degradedServices = latestChecks.filter(hc => hc.status === ServiceStatus.DEGRADED).length
  const downServices = latestChecks.filter(hc => hc.status === ServiceStatus.DOWN).length

  const responseTimes = latestChecks
    .map(hc => hc.responseTimeMs)
    .filter((ms): ms is number => ms !== null)

  let avgResponseTimeMs: number | null = null
  if (responseTimes.length > 0) {
    let totalResponseMs = 0
    for (const ms of responseTimes) {
      totalResponseMs += ms
    }
    avgResponseTimeMs = Math.round((totalResponseMs / responseTimes.length) * 100) / 100
  }

  let lastCheckedAt: Date | null = null
  if (latestChecks.length > 0) {
    lastCheckedAt = latestChecks[0]?.checkedAt ?? new Date()
    for (const hc of latestChecks) {
      if (hc.checkedAt > lastCheckedAt) {
        lastCheckedAt = hc.checkedAt
      }
    }
  }

  return {
    totalServices,
    healthyServices,
    degradedServices,
    downServices,
    avgResponseTimeMs,
    lastCheckedAt,
  }
}
