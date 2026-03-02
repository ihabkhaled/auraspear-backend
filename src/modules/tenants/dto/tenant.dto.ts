import { z } from 'zod'

export const CreateTenantSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[\da-z-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
})

export type CreateTenantDto = z.infer<typeof CreateTenantSchema>

export const UpdateTenantSchema = z.object({
  name: z.string().min(1).max(255).optional(),
})

export type UpdateTenantDto = z.infer<typeof UpdateTenantSchema>

export const AddUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(255),
  password: z.string().min(8).max(128),
  role: z.enum([
    'GLOBAL_ADMIN',
    'TENANT_ADMIN',
    'SOC_ANALYST_L2',
    'SOC_ANALYST_L1',
    'THREAT_HUNTER',
    'EXECUTIVE_READONLY',
  ]),
})

export type AddUserDto = z.infer<typeof AddUserSchema>

export const UpdateUserSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  role: z
    .enum([
      'GLOBAL_ADMIN',
      'TENANT_ADMIN',
      'SOC_ANALYST_L2',
      'SOC_ANALYST_L1',
      'THREAT_HUNTER',
      'EXECUTIVE_READONLY',
    ])
    .optional(),
  password: z.string().min(8).max(128).optional(),
})

export type UpdateUserDto = z.infer<typeof UpdateUserSchema>
