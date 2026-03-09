import { z } from 'zod'

export const RunHuntSchema = z.object({
  query: z.string().min(1, 'Hunt query is required').max(2000),
  timeRange: z.enum(['1h', '6h', '12h', '24h', '7d', '30d', '90d']),
  description: z.string().max(4096).optional(),
})

export type RunHuntDto = z.infer<typeof RunHuntSchema>
