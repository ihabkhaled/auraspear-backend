import { Injectable, Logger } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { BusinessException } from '../../common/exceptions/business.exception'
import { UserRole } from '../../common/interfaces/authenticated-request.interface'
import { PrismaService } from '../../prisma/prisma.service'
import type { CreateTenantDto, UpdateTenantDto, AddUserDto, UpdateUserDto } from './dto/tenant.dto'
import type { TenantRecord, TenantWithCounts, UserRecord } from './tenants.types'
import type { Prisma, UserStatus } from '@prisma/client'

const BCRYPT_SALT_ROUNDS = 12

// Mock data fallback
const MOCK_TENANTS: TenantRecord[] = [
  { id: 'tid-001', name: 'Aura Finance', slug: 'aura-finance', createdAt: new Date('2024-01-15') },
  { id: 'tid-002', name: 'Aura Health', slug: 'aura-health', createdAt: new Date('2024-02-01') },
  {
    id: 'tid-003',
    name: 'Aura Enterprise',
    slug: 'aura-enterprise',
    createdAt: new Date('2024-03-10'),
  },
]

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name)

  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<TenantWithCounts[]> {
    try {
      const tenants = await this.prisma.tenant.findMany({
        orderBy: { name: 'asc' },
        include: {
          _count: {
            select: {
              memberships: true,
              alerts: true,
              cases: true,
            },
          },
        },
      })
      return tenants.map(t => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        createdAt: t.createdAt,
        userCount: t._count.memberships,
        alertCount: t._count.alerts,
        caseCount: t._count.cases,
      }))
    } catch {
      this.logger.warn('Prisma unavailable, returning mock tenants')
      return MOCK_TENANTS.map(t => ({
        ...t,
        userCount: 0,
        alertCount: 0,
        caseCount: 0,
      }))
    }
  }

  async findById(id: string): Promise<TenantWithCounts> {
    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id },
        include: {
          _count: {
            select: { memberships: true, alerts: true, cases: true },
          },
        },
      })
      if (!tenant) {
        throw new BusinessException(404, 'Tenant not found', 'errors.tenants.notFound')
      }
      return {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        createdAt: tenant.createdAt,
        userCount: tenant._count.memberships,
        alertCount: tenant._count.alerts,
        caseCount: tenant._count.cases,
      }
    } catch (error) {
      if (error instanceof BusinessException) throw error
      const mock = MOCK_TENANTS.find(t => t.id === id || t.slug === id)
      if (!mock) {
        throw new BusinessException(404, 'Tenant not found', 'errors.tenants.notFound')
      }
      return {
        ...mock,
        userCount: 0,
        alertCount: 0,
        caseCount: 0,
      }
    }
  }

  async create(dto: CreateTenantDto): Promise<TenantRecord> {
    try {
      return await this.prisma.tenant.create({
        data: { name: dto.name, slug: dto.slug },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message.includes('Unique constraint')) {
        throw new BusinessException(
          409,
          'Tenant slug already exists',
          'errors.tenants.slugConflict'
        )
      }
      throw error
    }
  }

  async update(id: string, dto: UpdateTenantDto): Promise<TenantRecord> {
    return this.prisma.tenant.update({ where: { id }, data: dto })
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    await this.prisma.tenant.delete({ where: { id } })
    return { deleted: true }
  }

  async findUsers(
    tenantId: string,
    sortBy?: string,
    sortOrder?: string,
    role?: string,
    status?: string
  ): Promise<UserRecord[]> {
    try {
      const where: Prisma.TenantMembershipWhereInput = { tenantId }

      if (role) {
        where.role = role as UserRole
      }

      if (status) {
        where.status = status as UserStatus
      }

      const memberships = await this.prisma.tenantMembership.findMany({
        where,
        include: { user: true },
        orderBy: this.buildUserOrderBy(sortBy, sortOrder),
      })
      return memberships.map(m => ({
        id: m.user.id,
        email: m.user.email,
        name: m.user.name,
        role: m.role,
        status: m.status,
        lastLoginAt: m.user.lastLoginAt,
        mfaEnabled: m.user.mfaEnabled,
        isProtected: m.user.isProtected,
        createdAt: m.createdAt,
      }))
    } catch {
      return []
    }
  }

  /** Lightweight user list for assignee pickers — available to any authenticated user. */
  async findMembers(tenantId: string): Promise<Array<{ id: string; name: string; email: string }>> {
    try {
      const memberships = await this.prisma.tenantMembership.findMany({
        where: { tenantId, status: 'active' },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { user: { name: 'asc' } },
      })
      return memberships.map(m => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
      }))
    } catch {
      return []
    }
  }

  private buildUserOrderBy(
    sortBy?: string,
    sortOrder?: string
  ): Prisma.TenantMembershipOrderByWithRelationInput {
    const order: 'asc' | 'desc' = sortOrder === 'asc' ? 'asc' : 'desc'
    switch (sortBy) {
      case 'name':
        return { user: { name: order } }
      case 'role':
        return { role: order }
      case 'status':
        return { status: order }
      case 'lastLoginAt':
        return { user: { lastLoginAt: order } }
      case 'createdAt':
        return { createdAt: order }
      default:
        return { user: { name: 'asc' } }
    }
  }

  async addUser(tenantId: string, dto: AddUserDto, callerRole: UserRole): Promise<UserRecord> {
    if (dto.role === UserRole.GLOBAL_ADMIN && callerRole !== UserRole.GLOBAL_ADMIN) {
      throw new BusinessException(
        403,
        'Only Global Admin can create Global Admin users',
        'errors.tenants.cannotAssignGlobalAdmin'
      )
    }

    // Check if a membership already exists for this email in this tenant
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    })
    if (existingUser) {
      const existingMembership = await this.prisma.tenantMembership.findUnique({
        where: { userId_tenantId: { userId: existingUser.id, tenantId } },
      })
      if (existingMembership) {
        throw new BusinessException(
          409,
          'Email already exists in this tenant',
          'errors.tenants.emailExists'
        )
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS)

    // Upsert global user + create membership
    const user = await this.prisma.user.upsert({
      where: { email: dto.email },
      update: { passwordHash },
      create: {
        email: dto.email,
        name: dto.name,
        passwordHash,
      },
    })

    const membership = await this.prisma.tenantMembership.create({
      data: {
        userId: user.id,
        tenantId,
        role: dto.role as UserRole,
      },
    })

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: membership.role,
      status: membership.status,
      lastLoginAt: user.lastLoginAt,
      mfaEnabled: user.mfaEnabled,
      isProtected: user.isProtected,
      createdAt: membership.createdAt,
    }
  }

  async updateUser(
    tenantId: string,
    userId: string,
    dto: UpdateUserDto,
    callerRole: UserRole,
    callerId: string
  ): Promise<UserRecord> {
    if (callerId === userId && dto.role !== undefined) {
      throw new BusinessException(
        403,
        'Cannot change your own role',
        'errors.tenants.cannotModifySelf'
      )
    }

    const membership = await this.prisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      include: { user: true },
    })
    if (!membership) {
      throw new BusinessException(
        404,
        'User not found in this tenant',
        'errors.tenants.userNotFound'
      )
    }

    if (membership.user.isProtected && dto.role !== undefined && dto.role !== membership.role) {
      throw new BusinessException(
        403,
        'Cannot change the role of a protected user',
        'errors.tenants.userProtected'
      )
    }

    if (membership.role === UserRole.GLOBAL_ADMIN && callerRole !== UserRole.GLOBAL_ADMIN) {
      throw new BusinessException(
        403,
        'Only Global Admin can modify Global Admin users',
        'errors.tenants.cannotModifyGlobalAdmin'
      )
    }

    if (dto.role === UserRole.GLOBAL_ADMIN && callerRole !== UserRole.GLOBAL_ADMIN) {
      throw new BusinessException(
        403,
        'Only Global Admin can assign the Global Admin role',
        'errors.tenants.cannotAssignGlobalAdmin'
      )
    }

    // Update membership role
    if (dto.role !== undefined) {
      await this.prisma.tenantMembership.update({
        where: { userId_tenantId: { userId, tenantId } },
        data: { role: dto.role as UserRole },
      })
    }

    // Update user-level fields
    const userUpdateData: Record<string, unknown> = {}
    if (dto.name !== undefined) {
      userUpdateData.name = dto.name
    }
    if (dto.password !== undefined) {
      userUpdateData.passwordHash = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS)
    }
    if (Object.keys(userUpdateData).length > 0) {
      await this.prisma.user.update({
        where: { id: userId },
        data: userUpdateData,
      })
    }

    // Fetch updated state
    const updated = await this.prisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      include: { user: true },
    })

    if (!updated) {
      throw new BusinessException(
        404,
        'User not found in this tenant',
        'errors.tenants.userNotFound'
      )
    }

    return {
      id: updated.user.id,
      email: updated.user.email,
      name: updated.user.name,
      role: updated.role,
      status: updated.status,
      lastLoginAt: updated.user.lastLoginAt,
      mfaEnabled: updated.user.mfaEnabled,
      isProtected: updated.user.isProtected,
      createdAt: updated.createdAt,
    }
  }

  async removeUser(
    tenantId: string,
    userId: string,
    callerRole: UserRole,
    callerId: string
  ): Promise<{ deleted: boolean }> {
    if (callerId === userId) {
      throw new BusinessException(
        403,
        'Cannot delete your own account',
        'errors.tenants.cannotDeleteSelf'
      )
    }

    const membership = await this.prisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      include: { user: true },
    })
    if (!membership) {
      throw new BusinessException(
        404,
        'User not found in this tenant',
        'errors.tenants.userNotFound'
      )
    }

    if (membership.user.isProtected) {
      throw new BusinessException(
        403,
        'This user is protected and cannot be deleted',
        'errors.tenants.userProtected'
      )
    }

    if (membership.role === UserRole.GLOBAL_ADMIN && callerRole !== UserRole.GLOBAL_ADMIN) {
      throw new BusinessException(
        403,
        'Only Global Admin can remove Global Admin users',
        'errors.tenants.cannotModifyGlobalAdmin'
      )
    }

    // Soft delete: set membership status to inactive
    await this.prisma.tenantMembership.update({
      where: { userId_tenantId: { userId, tenantId } },
      data: { status: 'inactive' },
    })
    return { deleted: true }
  }

  async restoreUser(tenantId: string, userId: string, callerRole: UserRole): Promise<UserRecord> {
    const membership = await this.prisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      include: { user: true },
    })
    if (!membership) {
      throw new BusinessException(
        404,
        'User not found in this tenant',
        'errors.tenants.userNotFound'
      )
    }

    if (membership.status !== 'inactive') {
      throw new BusinessException(400, 'User is not deleted', 'errors.tenants.userNotDeleted')
    }

    if (membership.role === UserRole.GLOBAL_ADMIN && callerRole !== UserRole.GLOBAL_ADMIN) {
      throw new BusinessException(
        403,
        'Only Global Admin can restore Global Admin users',
        'errors.tenants.cannotModifyGlobalAdmin'
      )
    }

    const updated = await this.prisma.tenantMembership.update({
      where: { userId_tenantId: { userId, tenantId } },
      data: { status: 'active' },
      include: { user: true },
    })
    return {
      id: updated.user.id,
      email: updated.user.email,
      name: updated.user.name,
      role: updated.role,
      status: updated.status,
      lastLoginAt: updated.user.lastLoginAt,
      mfaEnabled: updated.user.mfaEnabled,
      isProtected: updated.user.isProtected,
      createdAt: updated.createdAt,
    }
  }

  async blockUser(
    tenantId: string,
    userId: string,
    callerRole: UserRole,
    callerId: string
  ): Promise<UserRecord> {
    if (callerId === userId) {
      throw new BusinessException(
        403,
        'Cannot block your own account',
        'errors.tenants.cannotBlockSelf'
      )
    }

    const membership = await this.prisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      include: { user: true },
    })
    if (!membership) {
      throw new BusinessException(
        404,
        'User not found in this tenant',
        'errors.tenants.userNotFound'
      )
    }

    if (membership.user.isProtected) {
      throw new BusinessException(
        403,
        'This user is protected and cannot be blocked',
        'errors.tenants.userProtected'
      )
    }

    if (membership.role === UserRole.GLOBAL_ADMIN && callerRole !== UserRole.GLOBAL_ADMIN) {
      throw new BusinessException(
        403,
        'Only Global Admin can block Global Admin users',
        'errors.tenants.cannotModifyGlobalAdmin'
      )
    }

    if (membership.status === 'suspended') {
      throw new BusinessException(
        400,
        'User is already blocked',
        'errors.tenants.userAlreadyBlocked'
      )
    }

    const updated = await this.prisma.tenantMembership.update({
      where: { userId_tenantId: { userId, tenantId } },
      data: { status: 'suspended' },
      include: { user: true },
    })
    return {
      id: updated.user.id,
      email: updated.user.email,
      name: updated.user.name,
      role: updated.role,
      status: updated.status,
      lastLoginAt: updated.user.lastLoginAt,
      mfaEnabled: updated.user.mfaEnabled,
      isProtected: updated.user.isProtected,
      createdAt: updated.createdAt,
    }
  }

  async unblockUser(tenantId: string, userId: string, callerRole: UserRole): Promise<UserRecord> {
    const membership = await this.prisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      include: { user: true },
    })
    if (!membership) {
      throw new BusinessException(
        404,
        'User not found in this tenant',
        'errors.tenants.userNotFound'
      )
    }

    if (membership.status !== 'suspended') {
      throw new BusinessException(400, 'User is not blocked', 'errors.tenants.userNotBlocked')
    }

    if (membership.role === UserRole.GLOBAL_ADMIN && callerRole !== UserRole.GLOBAL_ADMIN) {
      throw new BusinessException(
        403,
        'Only Global Admin can unblock Global Admin users',
        'errors.tenants.cannotModifyGlobalAdmin'
      )
    }

    const updated = await this.prisma.tenantMembership.update({
      where: { userId_tenantId: { userId, tenantId } },
      data: { status: 'active' },
      include: { user: true },
    })
    return {
      id: updated.user.id,
      email: updated.user.email,
      name: updated.user.name,
      role: updated.role,
      status: updated.status,
      lastLoginAt: updated.user.lastLoginAt,
      mfaEnabled: updated.user.mfaEnabled,
      isProtected: updated.user.isProtected,
      createdAt: updated.createdAt,
    }
  }
}
