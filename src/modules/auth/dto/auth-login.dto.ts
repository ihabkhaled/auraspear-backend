import { z } from 'zod'

export const AuthLoginSchema = z.object({
  email: z.string().email('Valid email is required'),
  password: z.string().min(1, 'Password is required'),
})

export type AuthLoginDto = z.infer<typeof AuthLoginSchema>
