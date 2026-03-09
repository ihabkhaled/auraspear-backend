import { z } from 'zod'

export const SearchAuditLogsSchema = z.object({
  actor: z.string().max(320).optional(),
  action: z.string().max(100).optional(),
  resource: z.string().max(255).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  sortBy: z.string().max(50).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type SearchAuditLogsDto = z.infer<typeof SearchAuditLogsSchema>
