import { z } from 'zod'

export const ExplainAnomalySchema = z.object({
  metric: z.string().min(1).max(200),
  value: z.number(),
  previousValue: z.number(),
  timeRange: z.string().min(1).max(50),
})

export type ExplainAnomalyDto = z.infer<typeof ExplainAnomalySchema>
