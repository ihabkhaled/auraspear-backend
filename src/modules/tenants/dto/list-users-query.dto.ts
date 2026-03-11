import { z } from 'zod'
import { SortOrder } from '../../../common/enums'
import {
  MembershipStatus,
  UserRole,
} from '../../../common/interfaces/authenticated-request.interface'

export const ListUsersQuerySchema = z.object({
  sortBy: z.enum(['name', 'email', 'role', 'lastLoginAt', 'status', 'createdAt']).default('name'),
  sortOrder: z.nativeEnum(SortOrder).default(SortOrder.ASC),
  role: z.nativeEnum(UserRole).optional(),
  status: z
    .enum([MembershipStatus.ACTIVE, MembershipStatus.INACTIVE, MembershipStatus.SUSPENDED])
    .optional(),
})

export type ListUsersQueryDto = z.infer<typeof ListUsersQuerySchema>
