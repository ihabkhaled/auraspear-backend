import { z } from 'zod'

export const AuthCallbackSchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
  redirect_uri: z.string().min(1, 'Redirect URI is required'),
})

export type AuthCallbackDto = z.infer<typeof AuthCallbackSchema>
