import { z } from 'zod'
import { MembershipStatus } from '../../../common/interfaces/authenticated-request.interface'

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
  status: z
    .enum([MembershipStatus.ACTIVE, MembershipStatus.INACTIVE, MembershipStatus.SUSPENDED])
    .optional(),
})

export type ListUsersQueryDto = z.infer<typeof ListUsersQuerySchema>
