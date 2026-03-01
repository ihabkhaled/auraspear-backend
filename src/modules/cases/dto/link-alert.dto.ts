import { z } from 'zod'

export const LinkAlertSchema = z.object({
  alertId: z.string().min(1, 'Alert ID is required'),
  indexName: z.string().min(1, 'Index name is required'),
})

export type LinkAlertDto = z.infer<typeof LinkAlertSchema>
