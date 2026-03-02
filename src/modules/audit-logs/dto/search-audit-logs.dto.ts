import { z } from 'zod'

export const SearchAuditLogsSchema = z.object({
  actor: z.string().optional(),
  action: z.string().optional(),
  resource: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type SearchAuditLogsDto = z.infer<typeof SearchAuditLogsSchema>
