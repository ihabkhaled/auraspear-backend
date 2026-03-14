import { z } from 'zod'

export const ListNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

export type ListNotificationsQueryDto = z.infer<typeof ListNotificationsQuerySchema>
