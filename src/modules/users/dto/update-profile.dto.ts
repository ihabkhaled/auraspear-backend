import { z } from 'zod'

export const UpdateProfileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(255),
  currentPassword: z.string().min(1, 'Current password is required'),
})

export type UpdateProfileDto = z.infer<typeof UpdateProfileSchema>
