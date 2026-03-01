import { z } from 'zod'

export const RunHuntSchema = z.object({
  query: z.string().min(1, 'Hunt query is required'),
  timeRange: z.string().min(1, 'Time range is required'),
  description: z.string().optional(),
})

export type RunHuntDto = z.infer<typeof RunHuntSchema>
