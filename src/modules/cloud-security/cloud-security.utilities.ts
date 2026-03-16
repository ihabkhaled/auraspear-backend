import type { CloudAccountRecord, CloudFindingRecord } from './cloud-security.types'
import type { UpdateAccountDto } from './dto/update-account.dto'

/* ---------------------------------------------------------------- */
/* QUERY BUILDING                                                    */
/* ---------------------------------------------------------------- */

export function buildAccountListWhere(
  tenantId: string,
  provider?: string,
  status?: string
): Record<string, unknown> {
  const where: Record<string, unknown> = { tenantId }

  if (provider) {
    where['provider'] = provider
  }

  if (status) {
    where['status'] = status
  }

  return where
}

export function buildAccountOrderBy(sortBy?: string, sortOrder?: string): Record<string, string> {
  const order = sortOrder === 'asc' ? 'asc' : 'desc'
  switch (sortBy) {
    case 'provider':
      return { provider: order }
    case 'status':
      return { status: order }
    case 'accountId':
      return { accountId: order }
    case 'alias':
      return { alias: order }
    case 'findingsCount':
      return { findingsCount: order }
    case 'complianceScore':
      return { complianceScore: order }
    case 'lastScanAt':
      return { lastScanAt: order }
    case 'updatedAt':
      return { updatedAt: order }
    case 'createdAt':
    default:
      return { createdAt: order }
  }
}

export function buildFindingListWhere(
  tenantId: string,
  severity?: string,
  status?: string,
  cloudAccountId?: string
): Record<string, unknown> {
  const where: Record<string, unknown> = { tenantId }

  if (severity) {
    where['severity'] = severity
  }

  if (status) {
    where['status'] = status
  }

  if (cloudAccountId) {
    where['cloudAccountId'] = cloudAccountId
  }

  return where
}

export function buildFindingOrderBy(sortBy?: string, sortOrder?: string): Record<string, string> {
  const order = sortOrder === 'asc' ? 'asc' : 'desc'
  switch (sortBy) {
    case 'severity':
      return { severity: order }
    case 'status':
      return { status: order }
    case 'title':
      return { title: order }
    case 'createdAt':
      return { createdAt: order }
    case 'detectedAt':
    default:
      return { detectedAt: order }
  }
}

/* ---------------------------------------------------------------- */
/* UPDATE DATA BUILDING                                              */
/* ---------------------------------------------------------------- */

export function buildAccountUpdateData(dto: UpdateAccountDto): Record<string, unknown> {
  const data: Record<string, unknown> = {}

  if (dto.provider !== undefined) data['provider'] = dto.provider
  if (dto.accountId !== undefined) data['accountId'] = dto.accountId
  if (dto.alias !== undefined) data['alias'] = dto.alias
  if (dto.region !== undefined) data['region'] = dto.region
  if (dto.status !== undefined) data['status'] = dto.status

  return data
}

/* ---------------------------------------------------------------- */
/* RECORD MAPPING                                                    */
/* ---------------------------------------------------------------- */

interface AccountEntity {
  id: string
  tenantId: string
  provider: string
  accountId: string
  alias: string | null
  region: string | null
  status: string
  lastScanAt: Date | null
  findingsCount: number
  complianceScore: number
  createdAt: Date
  updatedAt: Date
}

export function buildAccountRecord(account: AccountEntity): CloudAccountRecord {
  return {
    id: account.id,
    tenantId: account.tenantId,
    provider: account.provider,
    accountId: account.accountId,
    alias: account.alias,
    region: account.region,
    status: account.status,
    lastScanAt: account.lastScanAt,
    findingsCount: account.findingsCount,
    complianceScore: account.complianceScore,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  }
}

interface FindingEntity {
  id: string
  tenantId: string
  cloudAccountId: string
  title: string
  description: string | null
  severity: string
  status: string
  resourceId: string
  resourceType: string
  remediationSteps: string | null
  detectedAt: Date
  resolvedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export function buildFindingRecord(finding: FindingEntity): CloudFindingRecord {
  return {
    id: finding.id,
    tenantId: finding.tenantId,
    cloudAccountId: finding.cloudAccountId,
    title: finding.title,
    description: finding.description,
    severity: finding.severity,
    status: finding.status,
    resourceId: finding.resourceId,
    resourceType: finding.resourceType,
    remediationSteps: finding.remediationSteps,
    detectedAt: finding.detectedAt,
    resolvedAt: finding.resolvedAt,
    createdAt: finding.createdAt,
    updatedAt: finding.updatedAt,
  }
}
