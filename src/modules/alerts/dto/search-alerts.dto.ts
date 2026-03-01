import { z } from 'zod'

export const SearchAlertsSchema = z.object({
  query: z.string().default('*'),
  severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  status: z.enum(['new', 'acknowledged', 'in_progress', 'resolved', 'closed']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().default('timestamp'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
})

export type SearchAlertsDto = z.infer<typeof SearchAlertsSchema>
