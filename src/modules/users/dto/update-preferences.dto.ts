import { z } from 'zod'

export const UpdatePreferencesSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  language: z.enum(['en', 'es', 'fr', 'ar', 'it', 'de']).optional(),
  notificationsEmail: z.boolean().optional(),
  notificationsInApp: z.boolean().optional(),
})

export type UpdatePreferencesDto = z.infer<typeof UpdatePreferencesSchema>
