import { z } from 'zod'
import { SupportedLanguage, Theme } from '../../../common/enums'

export const UpdatePreferencesSchema = z.object({
  theme: z.nativeEnum(Theme).optional(),
  language: z.nativeEnum(SupportedLanguage).optional(),
  notificationsEmail: z.boolean().optional(),
  notificationsInApp: z.boolean().optional(),
})

export type UpdatePreferencesDto = z.infer<typeof UpdatePreferencesSchema>
