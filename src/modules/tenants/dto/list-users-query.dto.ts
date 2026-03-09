import { z } from 'zod'

export const ListUsersQuerySchema = z.object({
  sortBy: z.enum(['name', 'email', 'role', 'lastLoginAt', 'status', 'createdAt']).default('name'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
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
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
})

export type ListUsersQueryDto = z.infer<typeof ListUsersQuerySchema>
