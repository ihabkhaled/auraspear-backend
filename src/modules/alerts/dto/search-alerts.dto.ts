import { z } from 'zod'

export const AlertTimeRange = {
  H24: '24h',
  D7: '7d',
  D30: '30d',
} as const

export type AlertTimeRangeValue = (typeof AlertTimeRange)[keyof typeof AlertTimeRange]

export const SearchAlertsSchema = z.object({
  query: z.string().max(1000).default('*'),
  /** Comma-separated severity values: e.g. "critical,high" */
  severity: z.string().max(200).optional(),
  status: z
    .enum(['new_alert', 'acknowledged', 'in_progress', 'resolved', 'closed', 'false_positive'])
    .optional(),
  source: z.string().max(100).optional(),
  agentName: z.string().max(255).optional(),
  ruleGroup: z.string().max(500).optional(),
  timeRange: z.enum(['24h', '7d', '30d']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z
    .enum([
      'timestamp',
      'severity',
      'status',
      'source',
      'agentName',
      'sourceIp',
      'title',
      'createdAt',
    ])
    .default('timestamp'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
})

export type SearchAlertsDto = z.infer<typeof SearchAlertsSchema>
