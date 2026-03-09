import { z } from 'zod'

export const AlertTrendQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(7),
})

export type AlertTrendQueryDto = z.infer<typeof AlertTrendQuerySchema>
