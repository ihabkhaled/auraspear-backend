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
              users: true,
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
        userCount: t._count.users,
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
            select: { users: true, alerts: true, cases: true },
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
        userCount: tenant._count.users,
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
      const where: Prisma.TenantUserWhereInput = { tenantId }

      if (role) {
        where.role = role as UserRole
      }

      if (status) {
        where.status = status as UserStatus
      }

      const users = await this.prisma.tenantUser.findMany({
        where,
        orderBy: this.buildUserOrderBy(sortBy, sortOrder),
      })
      return users.map(u => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        status: u.status,
        lastLoginAt: u.lastLoginAt,
        mfaEnabled: u.mfaEnabled,
        isProtected: u.isProtected,
        createdAt: u.createdAt,
      }))
    } catch {
      return []
    }
  }

  /** Lightweight user list for assignee pickers — available to any authenticated user. */
  async findMembers(tenantId: string): Promise<Array<{ id: string; name: string; email: string }>> {
    try {
      return await this.prisma.tenantUser.findMany({
        where: { tenantId, status: 'active' },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' },
      })
    } catch {
      return []
    }
  }

  private buildUserOrderBy(
    sortBy?: string,
    sortOrder?: string
  ): Prisma.TenantUserOrderByWithRelationInput {
    const order: 'asc' | 'desc' = sortOrder === 'asc' ? 'asc' : 'desc'
    switch (sortBy) {
      case 'name':
        return { name: order }
      case 'role':
        return { role: order }
      case 'status':
        return { status: order }
      case 'lastLoginAt':
        return { lastLoginAt: order }
      case 'createdAt':
        return { createdAt: order }
      default:
        return { name: 'asc' }
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

    const existing = await this.prisma.tenantUser.findFirst({
      where: { tenantId, email: dto.email },
    })
    if (existing) {
      throw new BusinessException(
        409,
        'Email already exists in this tenant',
        'errors.tenants.emailExists'
      )
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS)

    const user = await this.prisma.tenantUser.create({
      data: {
        tenantId,
        email: dto.email,
        name: dto.name,
        role: dto.role as UserRole,
        passwordHash,
      },
    })
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      mfaEnabled: user.mfaEnabled,
      isProtected: user.isProtected,
      createdAt: user.createdAt,
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

    const existing = await this.prisma.tenantUser.findUnique({ where: { id: userId } })
    if (existing?.tenantId !== tenantId) {
      throw new BusinessException(
        404,
        'User not found in this tenant',
        'errors.tenants.userNotFound'
      )
    }

    if (existing.isProtected && dto.role !== undefined && dto.role !== existing.role) {
      throw new BusinessException(
        403,
        'Cannot change the role of a protected user',
        'errors.tenants.userProtected'
      )
    }

    if (existing.role === UserRole.GLOBAL_ADMIN && callerRole !== UserRole.GLOBAL_ADMIN) {
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

    const updateData: Record<string, unknown> = {}
    if (dto.name !== undefined) {
      updateData.name = dto.name
    }
    if (dto.role !== undefined) {
      updateData.role = dto.role
    }
    if (dto.password !== undefined) {
      updateData.passwordHash = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS)
    }

    const user = await this.prisma.tenantUser.update({
      where: { id: userId },
      data: updateData,
    })
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      mfaEnabled: user.mfaEnabled,
      isProtected: user.isProtected,
      createdAt: user.createdAt,
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

    const user = await this.prisma.tenantUser.findUnique({ where: { id: userId } })
    if (user?.tenantId !== tenantId) {
      throw new BusinessException(
        404,
        'User not found in this tenant',
        'errors.tenants.userNotFound'
      )
    }

    if (user.isProtected) {
      throw new BusinessException(
        403,
        'This user is protected and cannot be deleted',
        'errors.tenants.userProtected'
      )
    }

    if (user.role === UserRole.GLOBAL_ADMIN && callerRole !== UserRole.GLOBAL_ADMIN) {
      throw new BusinessException(
        403,
        'Only Global Admin can remove Global Admin users',
        'errors.tenants.cannotModifyGlobalAdmin'
      )
    }

    // Soft delete: set status to inactive
    await this.prisma.tenantUser.update({
      where: { id: userId },
      data: { status: 'inactive' },
    })
    return { deleted: true }
  }

  async restoreUser(tenantId: string, userId: string, callerRole: UserRole): Promise<UserRecord> {
    const user = await this.prisma.tenantUser.findUnique({ where: { id: userId } })
    if (user?.tenantId !== tenantId) {
      throw new BusinessException(
        404,
        'User not found in this tenant',
        'errors.tenants.userNotFound'
      )
    }

    if (user.status !== 'inactive') {
      throw new BusinessException(400, 'User is not deleted', 'errors.tenants.userNotDeleted')
    }

    if (user.role === UserRole.GLOBAL_ADMIN && callerRole !== UserRole.GLOBAL_ADMIN) {
      throw new BusinessException(
        403,
        'Only Global Admin can restore Global Admin users',
        'errors.tenants.cannotModifyGlobalAdmin'
      )
    }

    const updated = await this.prisma.tenantUser.update({
      where: { id: userId },
      data: { status: 'active' },
    })
    return {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      status: updated.status,
      lastLoginAt: updated.lastLoginAt,
      mfaEnabled: updated.mfaEnabled,
      isProtected: updated.isProtected,
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

    const user = await this.prisma.tenantUser.findUnique({ where: { id: userId } })
    if (user?.tenantId !== tenantId) {
      throw new BusinessException(
        404,
        'User not found in this tenant',
        'errors.tenants.userNotFound'
      )
    }

    if (user.isProtected) {
      throw new BusinessException(
        403,
        'This user is protected and cannot be blocked',
        'errors.tenants.userProtected'
      )
    }

    if (user.role === UserRole.GLOBAL_ADMIN && callerRole !== UserRole.GLOBAL_ADMIN) {
      throw new BusinessException(
        403,
        'Only Global Admin can block Global Admin users',
        'errors.tenants.cannotModifyGlobalAdmin'
      )
    }

    if (user.status === 'suspended') {
      throw new BusinessException(
        400,
        'User is already blocked',
        'errors.tenants.userAlreadyBlocked'
      )
    }

    const updated = await this.prisma.tenantUser.update({
      where: { id: userId },
      data: { status: 'suspended' },
    })
    return {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      status: updated.status,
      lastLoginAt: updated.lastLoginAt,
      mfaEnabled: updated.mfaEnabled,
      isProtected: updated.isProtected,
      createdAt: updated.createdAt,
    }
  }

  async unblockUser(tenantId: string, userId: string, callerRole: UserRole): Promise<UserRecord> {
    const user = await this.prisma.tenantUser.findUnique({ where: { id: userId } })
    if (user?.tenantId !== tenantId) {
      throw new BusinessException(
        404,
        'User not found in this tenant',
        'errors.tenants.userNotFound'
      )
    }

    if (user.status !== 'suspended') {
      throw new BusinessException(400, 'User is not blocked', 'errors.tenants.userNotBlocked')
    }

    if (user.role === UserRole.GLOBAL_ADMIN && callerRole !== UserRole.GLOBAL_ADMIN) {
      throw new BusinessException(
        403,
        'Only Global Admin can unblock Global Admin users',
        'errors.tenants.cannotModifyGlobalAdmin'
      )
    }

    const updated = await this.prisma.tenantUser.update({
      where: { id: userId },
      data: { status: 'active' },
    })
    return {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      status: updated.status,
      lastLoginAt: updated.lastLoginAt,
      mfaEnabled: updated.mfaEnabled,
      isProtected: updated.isProtected,
      createdAt: updated.createdAt,
    }
  }
}
