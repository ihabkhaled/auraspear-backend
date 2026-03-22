import { VALID_SEVERITIES, VALID_STATUSES } from './alerts.constants'
import { AlertStatus, SortOrder } from '../../common/enums'
import type { WazuhUpsertOp } from './alerts.types'
import type { SearchAlertsDto } from './dto/search-alerts.dto'
import type { AlertSeverity, AlertStatus as PrismaAlertStatus, Prisma } from '@prisma/client'

/* ---------------------------------------------------------------- */
/* SEARCH WHERE CLAUSE                                               */
/* ---------------------------------------------------------------- */

export function buildAlertSearchWhere(
  tenantId: string,
  query: SearchAlertsDto
): Prisma.AlertWhereInput {
  const where: Prisma.AlertWhereInput = { tenantId }

  if (query.severity) {
    const severities = query.severity
      .split(',')
      .map(s => s.trim())
      .filter(s => VALID_SEVERITIES.has(s))
    if (severities.length === 1) {
      where.severity = severities[0] as AlertSeverity
    } else if (severities.length > 1) {
      where.severity = { in: severities as AlertSeverity[] }
    }
  }

  if (query.status && VALID_STATUSES.has(query.status)) {
    where.status = query.status as unknown as PrismaAlertStatus
  }

  if (query.source) {
    where.source = query.source
  }

  if (query.agentName) {
    where.agentName = { contains: query.agentName, mode: 'insensitive' }
  }

  if (query.ruleGroup) {
    where.ruleName = { contains: query.ruleGroup, mode: 'insensitive' }
  }

  applyTimeFilter(where, query)

  if (query.query && query.query !== '*') {
    applyKqlQuery(query.query, where)
  }

  return where
}

/* ---------------------------------------------------------------- */
/* TIME FILTER                                                       */
/* ---------------------------------------------------------------- */

function applyTimeFilter(where: Prisma.AlertWhereInput, query: SearchAlertsDto): void {
  if (query.timeRange) {
    const now = new Date()
    const from = new Date(now)
    switch (query.timeRange) {
      case '24h':
        from.setHours(from.getHours() - 24)
        break
      case '7d':
        from.setDate(from.getDate() - 7)
        break
      case '30d':
        from.setDate(from.getDate() - 30)
        break
    }
    where.timestamp = { gte: from }
  } else if (query.from ?? query.to) {
    where.timestamp = {}
    if (query.from) {
      where.timestamp.gte = new Date(query.from)
    }
    if (query.to) {
      where.timestamp.lte = new Date(query.to)
    }
  }
}

/* ---------------------------------------------------------------- */
/* ORDER BY                                                          */
/* ---------------------------------------------------------------- */

export function buildAlertOrderBy(
  sortBy: string,
  sortOrder: 'asc' | 'desc'
): Prisma.AlertOrderByWithRelationInput {
  switch (sortBy) {
    case 'timestamp':
      return { timestamp: sortOrder }
    case 'severity':
      return { severity: sortOrder }
    case 'status':
      return { status: sortOrder }
    case 'source':
      return { source: sortOrder }
    case 'agentName':
      return { agentName: sortOrder }
    case 'sourceIp':
      return { sourceIp: sortOrder }
    case 'title':
      return { title: sortOrder }
    case 'createdAt':
      return { createdAt: sortOrder }
    default:
      return { timestamp: SortOrder.DESC }
  }
}

/* ---------------------------------------------------------------- */
/* WAZUH LEVEL → SEVERITY MAPPING                                    */
/* ---------------------------------------------------------------- */

export function mapWazuhLevel(
  level: number | undefined
): 'critical' | 'high' | 'medium' | 'low' | 'info' {
  if (!level) return 'info'
  if (level >= 12) return 'critical'
  if (level >= 8) return 'high'
  if (level >= 5) return 'medium'
  if (level >= 3) return 'low'
  return 'info'
}

/* ---------------------------------------------------------------- */
/* WAZUH HIT → UPSERT OP MAPPING                                    */
/* ---------------------------------------------------------------- */

export function buildWazuhUpsertOps(hits: unknown[]): WazuhUpsertOp[] {
  const now = new Date()

  return hits.map(rawHit => {
    const hit = rawHit as Record<string, unknown>
    const source = (hit._source ?? hit) as Record<string, unknown>
    const externalId = (hit._id ?? source.id) as string

    const rule = source.rule as Record<string, unknown> | undefined
    const agent = source.agent as Record<string, unknown> | undefined
    const data = source.data as Record<string, unknown> | undefined

    const mitreTechniques: string[] = []
    const mitreTactics: string[] = []
    const mitreInfo = rule?.mitre as Record<string, unknown> | undefined
    if (mitreInfo) {
      const ids = mitreInfo.id as string[] | undefined
      const tactics = mitreInfo.tactic as string[] | undefined
      if (ids) mitreTechniques.push(...ids)
      if (tactics) mitreTactics.push(...tactics)
    }

    const severity = mapWazuhLevel(rule?.level as number | undefined)

    return {
      externalId,
      rule,
      agent: agent ?? null,
      data: data ?? null,
      source,
      severity,
      mitreTactics,
      mitreTechniques,
      timestamp: new Date((source.timestamp ?? now) as string),
    }
  })
}

/* ---------------------------------------------------------------- */
/* WAZUH ALERT CREATE / UPDATE INPUT                                 */
/* ---------------------------------------------------------------- */

export function buildWazuhAlertCreateInput(
  tenantId: string,
  op: WazuhUpsertOp
): {
  create: Prisma.AlertCreateInput
  update: Prisma.AlertUpdateInput
} {
  return {
    create: {
      externalId: op.externalId,
      title: (op.rule?.description ?? op.source.rule_description ?? 'Wazuh Alert') as string,
      description: JSON.stringify(op.source),
      severity: op.severity as AlertSeverity,
      status: AlertStatus.NEW_ALERT,
      source: 'wazuh',
      ruleName: (op.rule?.description ?? null) as string | null,
      ruleId: (op.rule?.id ?? null) as string | null,
      agentName: ((op.agent as Record<string, unknown> | null)?.name as string | null) ?? null,
      sourceIp: ((op.data as Record<string, unknown> | null)?.srcip ?? op.source.src_ip ?? null) as
        | string
        | null,
      destinationIp: ((op.data as Record<string, unknown> | null)?.dstip ??
        op.source.dst_ip ??
        null) as string | null,
      mitreTactics: op.mitreTactics,
      mitreTechniques: op.mitreTechniques,
      rawEvent: op.source as Prisma.InputJsonValue,
      timestamp: op.timestamp,
      tenant: { connect: { id: tenantId } },
    },
    update: {
      rawEvent: op.source as Prisma.InputJsonValue,
    },
  }
}

/* ---------------------------------------------------------------- */
/* INGESTION RESULT COUNTING                                         */
/* ---------------------------------------------------------------- */

export function countIngestedResults(results: Array<PromiseSettledResult<unknown>>): {
  ingested: number
  failures: string[]
} {
  let ingested = 0
  const failures: string[] = []

  for (const result of results) {
    if (result.status === 'fulfilled') {
      ingested++
    } else {
      failures.push((result.reason as Error).message)
    }
  }

  return { ingested, failures }
}

/* ---------------------------------------------------------------- */
/* WAZUH ES QUERY BUILDER                                            */
/* ---------------------------------------------------------------- */

export function buildWazuhIngestionQuery(): Record<string, unknown> {
  const now = new Date()
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  return {
    size: 500,
    query: {
      bool: {
        must: [{ range: { timestamp: { gte: oneDayAgo.toISOString(), lte: now.toISOString() } } }],
      },
    },
    sort: [{ timestamp: { order: SortOrder.DESC } }],
  }
}

/* ---------------------------------------------------------------- */
/* KQL QUERY PARSING                                                 */
/* ---------------------------------------------------------------- */

function applyKqlQuery(rawQuery: string, where: Prisma.AlertWhereInput): void {
  const kqlPattern = /(\w[\w.]*):(?:"([^"]+)"|(\S+))/g
  const freeTextParts: string[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = kqlPattern.exec(rawQuery)) !== null) {
    const textBefore = rawQuery
      .slice(lastIndex, match.index)
      .replaceAll(/\b(?:AND|OR|NOT)\b/gi, '')
      .trim()
    if (textBefore) freeTextParts.push(textBefore)
    lastIndex = match.index + match[0].length

    const field = (match[1] ?? match[3] ?? '').toLowerCase()
    const value = match[2] ?? match[4] ?? ''
    applyKqlField(field, value, where)
  }

  const remaining = rawQuery
    .slice(lastIndex)
    .replaceAll(/\b(?:AND|OR|NOT)\b/gi, '')
    .trim()
  if (remaining) freeTextParts.push(remaining)

  const freeText = freeTextParts.join(' ').trim()
  if (freeText) {
    where.OR = [
      { title: { contains: freeText, mode: 'insensitive' } },
      { description: { contains: freeText, mode: 'insensitive' } },
      { sourceIp: { contains: freeText } },
      { destinationIp: { contains: freeText } },
      { agentName: { contains: freeText, mode: 'insensitive' } },
      { ruleName: { contains: freeText, mode: 'insensitive' } },
    ]
  }
}

function applyKqlField(field: string, value: string, where: Prisma.AlertWhereInput): void {
  switch (field) {
    case 'severity':
      if (VALID_SEVERITIES.has(value)) {
        where.severity = value as AlertSeverity
      }
      break
    case 'status':
      if (VALID_STATUSES.has(value)) {
        where.status = value as PrismaAlertStatus
      }
      break
    case 'source':
      where.source = value
      break
    case 'agent':
    case 'agent.name':
      where.agentName = { contains: value, mode: 'insensitive' }
      break
    case 'sourceip':
    case 'source.ip':
      where.sourceIp = { contains: value }
      break
    case 'destip':
    case 'dest.ip':
    case 'destination.ip':
      where.destinationIp = { contains: value }
      break
    case 'rule':
    case 'rule.name':
    case 'rulename':
      where.ruleName = { contains: value, mode: 'insensitive' }
      break
    default:
      break
  }
}
