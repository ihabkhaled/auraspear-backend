import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import {
  MembershipStatus,
  ROLE_HIERARCHY,
  UserRole,
} from '../../common/interfaces/authenticated-request.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import { PrismaService } from '../../prisma/prisma.service'
import { AuthService } from '../auth/auth.service'
import type {
  CreateTenantDto,
  UpdateTenantDto,
  AddUserDto,
  UpdateUserDto,
  AssignUserDto,
} from './dto/tenant.dto'
import type {
  TenantRecord,
  TenantWithCounts,
  UserRecord,
  PaginatedResult,
  CheckEmailResult,
  ImpersonateUserResponse,
} from './tenants.types'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'
import type { Prisma, UserStatus } from '@prisma/client'

const BCRYPT_SALT_ROUNDS = 12

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
    private readonly appLogger: AppLoggerService
  ) {}

  async findAll(
    page = 1,
    limit = 20,
    search?: string,
    sortBy = 'name',
    sortOrder = 'asc'
  ): Promise<PaginatedResult<TenantWithCounts>> {
    const where: Prisma.TenantWhereInput = {}

    if (search && search.length > 0) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ]
    }

    const order: 'asc' | 'desc' = sortOrder === 'asc' ? 'asc' : 'desc'
    let orderBy: Prisma.TenantOrderByWithRelationInput
    switch (sortBy) {
      case 'userCount':
        orderBy = { memberships: { _count: order } }
        break
      case 'alertCount':
        orderBy = { alerts: { _count: order } }
        break
      case 'caseCount':
        orderBy = { cases: { _count: order } }
        break
      case 'slug':
        orderBy = { slug: order }
        break
      case 'createdAt':
        orderBy = { createdAt: order }
        break
      default:
        orderBy = { name: order }
        break
    }

    const [tenants, total] = await this.prisma.$transaction([
      this.prisma.tenant.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          _count: {
            select: {
              memberships: true,
              alerts: true,
              cases: true,
            },
          },
        },
      }),
      this.prisma.tenant.count({ where }),
    ])

    this.appLogger.info('Tenants listed', {
      feature: AppLogFeature.TENANT_MEMBERS,
      action: 'findAll',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'TenantsService',
      functionName: 'findAll',
      metadata: { page, limit, total, hasSearch: Boolean(search) },
    })

    return {
      data: tenants.map(t => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        createdAt: t.createdAt,
        userCount: t._count.memberships,
        alertCount: t._count.alerts,
        caseCount: t._count.cases,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    }
  }

  async findById(id: string): Promise<TenantWithCounts> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        _count: {
          select: { memberships: true, alerts: true, cases: true },
        },
      },
    })
    if (!tenant) {
      this.appLogger.warn('Tenant not found', {
        feature: AppLogFeature.TENANTS,
        action: 'findById',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { tenantId: id },
      })
      throw new BusinessException(404, 'Tenant not found', 'errors.tenants.notFound')
    }
    this.appLogger.debug('Tenant retrieved by ID', {
      feature: AppLogFeature.TENANT_MEMBERS,
      action: 'findById',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'TenantsService',
      functionName: 'findById',
    })

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      createdAt: tenant.createdAt,
      userCount: tenant._count.memberships,
      alertCount: tenant._count.alerts,
      caseCount: tenant._count.cases,
    }
  }

  async create(dto: CreateTenantDto): Promise<TenantRecord> {
    try {
      const tenant = await this.prisma.tenant.create({
        data: { name: dto.name, slug: dto.slug },
      })

      this.appLogger.info('Tenant created', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'create',
        outcome: AppLogOutcome.SUCCESS,
        tenantId: tenant.id,
        sourceType: AppLogSourceType.SERVICE,
        className: 'TenantsService',
        functionName: 'create',
        metadata: { tenantName: dto.name, tenantSlug: dto.slug },
      })

      return tenant
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message.includes('Unique constraint')) {
        this.appLogger.warn('Tenant creation failed: slug already exists', {
          feature: AppLogFeature.TENANTS,
          action: 'create',
          className: 'TenantsService',
          sourceType: AppLogSourceType.SERVICE,
          outcome: AppLogOutcome.FAILURE,
          metadata: { slug: dto.slug },
        })
        throw new BusinessException(
          409,
          'Tenant slug already exists',
          'errors.tenants.slugConflict'
        )
      }
      this.appLogger.error('Unexpected error creating tenant', {
        feature: AppLogFeature.TENANTS,
        action: 'create',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: {
          error: error instanceof Error ? error.message : 'Unknown error',
          slug: dto.slug,
        },
      })
      throw error
    }
  }

  async update(id: string, dto: UpdateTenantDto): Promise<TenantRecord> {
    const tenant = await this.prisma.tenant.update({ where: { id }, data: dto })

    this.appLogger.info('Tenant updated', {
      feature: AppLogFeature.TENANT_MEMBERS,
      action: 'update',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'TenantsService',
      functionName: 'update',
      metadata: { updatedFields: Object.keys(dto) },
    })

    return tenant
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    // Soft-delete: deactivate all memberships instead of destroying tenant data
    await this.prisma.$transaction(async tx => {
      await tx.tenantMembership.updateMany({
        where: { tenantId: id },
        data: { status: MembershipStatus.INACTIVE },
      })
    })
    this.logger.log(`Tenant ${id} soft-deleted: all memberships deactivated`)

    this.appLogger.info('Tenant soft-deleted', {
      feature: AppLogFeature.TENANT_MEMBERS,
      action: 'remove',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'TenantsService',
      functionName: 'remove',
    })

    return { deleted: true }
  }

  async findUsers(
    tenantId: string,
    page = 1,
    limit = 20,
    search?: string,
    sortBy?: string,
    sortOrder?: string,
    role?: string,
    status?: string
  ): Promise<PaginatedResult<UserRecord>> {
    try {
      const where: Prisma.TenantMembershipWhereInput = { tenantId }

      if (role) {
        where.role = role as UserRole
      }

      if (status) {
        where.status = status as UserStatus
      }

      if (search && search.length > 0) {
        where.user = {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }
      }

      const [memberships, total] = await this.prisma.$transaction([
        this.prisma.tenantMembership.findMany({
          where,
          include: { user: true },
          orderBy: this.buildUserOrderBy(sortBy, sortOrder),
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.tenantMembership.count({ where }),
      ])

      this.appLogger.info('Tenant users listed', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'findUsers',
        outcome: AppLogOutcome.SUCCESS,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'TenantsService',
        functionName: 'findUsers',
        metadata: { page, limit, total, hasSearch: Boolean(search) },
      })

      return {
        data: memberships.map(m => ({
          id: m.user.id,
          email: m.user.email,
          name: m.user.name,
          role: m.role,
          status: m.status,
          lastLoginAt: m.user.lastLoginAt,
          mfaEnabled: m.user.mfaEnabled,
          isProtected: m.user.isProtected,
          createdAt: m.createdAt,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
      }
    } catch (error) {
      this.logger.error(`Failed to fetch users for tenant ${tenantId}`, error)
      this.appLogger.error('Failed to fetch users for tenant', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'findUsers',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { error: error instanceof Error ? error.message : 'Unknown error', tenantId },
      })
      throw error
    }
  }

  /** Lightweight user list for assignee pickers — available to any authenticated user. */
  async findMembers(tenantId: string): Promise<Array<{ id: string; name: string; email: string }>> {
    try {
      const memberships = await this.prisma.tenantMembership.findMany({
        where: { tenantId, status: MembershipStatus.ACTIVE },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { user: { name: 'asc' } },
      })
      this.appLogger.debug('Tenant members retrieved', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'findMembers',
        outcome: AppLogOutcome.SUCCESS,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'TenantsService',
        functionName: 'findMembers',
        metadata: { count: memberships.length },
      })

      return memberships.map(m => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
      }))
    } catch (error) {
      this.logger.error(`Failed to fetch members for tenant ${tenantId}`, error)
      this.appLogger.error('Failed to fetch members for tenant', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'findMembers',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { error: error instanceof Error ? error.message : 'Unknown error', tenantId },
      })
      throw error
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
      case 'email':
        return { user: { email: order } }
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

  async checkEmail(tenantId: string, email: string): Promise<CheckEmailResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      select: { id: true, name: true, email: true },
    })

    if (!user) {
      return { exists: false, user: null, alreadyInTenant: false }
    }

    const membership = await this.prisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId: user.id, tenantId } },
    })

    this.appLogger.debug('Email check performed', {
      feature: AppLogFeature.TENANT_MEMBERS,
      action: 'checkEmail',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'TenantsService',
      functionName: 'checkEmail',
      metadata: { exists: true, alreadyInTenant: membership !== null },
    })

    return {
      exists: true,
      user,
      alreadyInTenant: membership !== null,
    }
  }

  async assignUser(
    tenantId: string,
    dto: AssignUserDto,
    callerRole: UserRole
  ): Promise<UserRecord> {
    if (dto.role === UserRole.GLOBAL_ADMIN && callerRole !== UserRole.GLOBAL_ADMIN) {
      this.appLogger.warn('Assign user denied: non-admin tried to assign GLOBAL_ADMIN role', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'assignUser',
        outcome: AppLogOutcome.DENIED,
        tenantId,
        actorEmail: dto.email,
        sourceType: AppLogSourceType.SERVICE,
        className: 'TenantsService',
        functionName: 'assignUser',
      })
      throw new BusinessException(
        403,
        'Only Global Admin can assign Global Admin role',
        'errors.tenants.cannotAssignGlobalAdmin'
      )
    }

    const normalizedEmail = dto.email.toLowerCase().trim()

    try {
      const result = await this.prisma.$transaction(async tx => {
        const existing = await tx.user.findUnique({ where: { email: normalizedEmail } })

        let user: {
          id: string
          email: string
          name: string
          lastLoginAt: Date | null
          mfaEnabled: boolean
          isProtected: boolean
        }

        if (existing) {
          if (existing.isProtected) {
            this.appLogger.warn('Assign user failed: user is protected', {
              feature: AppLogFeature.TENANT_MEMBERS,
              action: 'assignUser',
              className: 'TenantsService',
              sourceType: AppLogSourceType.SERVICE,
              outcome: AppLogOutcome.DENIED,
              metadata: { tenantId, userId: existing.id, email: normalizedEmail },
            })
            throw new BusinessException(
              403,
              'Cannot assign a protected user to another tenant',
              'errors.tenants.userProtected'
            )
          }

          // Check if already in this tenant
          const existingMembership = await tx.tenantMembership.findUnique({
            where: { userId_tenantId: { userId: existing.id, tenantId } },
          })

          if (existingMembership) {
            this.appLogger.warn('Assign user failed: user already in tenant', {
              feature: AppLogFeature.TENANT_MEMBERS,
              action: 'assignUser',
              className: 'TenantsService',
              sourceType: AppLogSourceType.SERVICE,
              outcome: AppLogOutcome.FAILURE,
              metadata: { tenantId, userId: existing.id, email: normalizedEmail },
            })
            throw new BusinessException(
              409,
              'User is already a member of this tenant',
              'errors.tenants.userAlreadyInTenant'
            )
          }

          user = existing
        } else {
          // New user — name and password are required
          if (!dto.name || dto.name.trim().length === 0) {
            this.appLogger.warn('Assign user failed: name required for new user', {
              feature: AppLogFeature.TENANT_MEMBERS,
              action: 'assignUser',
              className: 'TenantsService',
              sourceType: AppLogSourceType.SERVICE,
              outcome: AppLogOutcome.FAILURE,
              metadata: { tenantId, email: normalizedEmail },
            })
            throw new BusinessException(
              400,
              'Name is required when creating a new user',
              'errors.validation.name.required'
            )
          }
          if (!dto.password || dto.password.length === 0) {
            this.appLogger.warn('Assign user failed: password required for new user', {
              feature: AppLogFeature.TENANT_MEMBERS,
              action: 'assignUser',
              className: 'TenantsService',
              sourceType: AppLogSourceType.SERVICE,
              outcome: AppLogOutcome.FAILURE,
              metadata: { tenantId, email: normalizedEmail },
            })
            throw new BusinessException(
              400,
              'Password is required when creating a new user',
              'errors.validation.password.required'
            )
          }

          const passwordHash = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS)
          user = await tx.user.create({
            data: {
              email: normalizedEmail,
              name: dto.name.trim(),
              passwordHash,
            },
          })
        }

        const membership = await tx.tenantMembership.create({
          data: {
            userId: user.id,
            tenantId,
            role: dto.role as UserRole,
          },
        })

        return { user, membership }
      })

      this.appLogger.info('User assigned to tenant', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'assignUser',
        outcome: AppLogOutcome.SUCCESS,
        tenantId,
        targetResource: 'User',
        targetResourceId: result.user.id,
        actorEmail: result.user.email,
        sourceType: AppLogSourceType.SERVICE,
        className: 'TenantsService',
        functionName: 'assignUser',
        metadata: { role: result.membership.role },
      })

      return {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        role: result.membership.role,
        status: result.membership.status,
        lastLoginAt: result.user.lastLoginAt,
        mfaEnabled: result.user.mfaEnabled,
        isProtected: result.user.isProtected,
        createdAt: result.membership.createdAt,
      }
    } catch (error) {
      if (error instanceof BusinessException) {
        throw error
      }
      const message = error instanceof Error ? error.message : ''
      if (message.includes('Unique constraint')) {
        this.appLogger.warn('Assign user failed: unique constraint violation', {
          feature: AppLogFeature.TENANT_MEMBERS,
          action: 'assignUser',
          className: 'TenantsService',
          sourceType: AppLogSourceType.SERVICE,
          outcome: AppLogOutcome.FAILURE,
          metadata: { tenantId, email: normalizedEmail },
        })
        throw new BusinessException(
          409,
          'User is already a member of this tenant',
          'errors.tenants.userAlreadyInTenant'
        )
      }
      this.appLogger.error('Unexpected error assigning user to tenant', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'assignUser',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: {
          error: error instanceof Error ? error.message : 'Unknown error',
          tenantId,
          email: normalizedEmail,
        },
      })
      throw error
    }
  }

  async addUser(tenantId: string, dto: AddUserDto, callerRole: UserRole): Promise<UserRecord> {
    if (dto.role === UserRole.GLOBAL_ADMIN && callerRole !== UserRole.GLOBAL_ADMIN) {
      this.appLogger.warn('Add user denied: non-admin tried to assign GLOBAL_ADMIN role', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'addUser',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.DENIED,
        metadata: { tenantId, email: dto.email, callerRole },
      })
      throw new BusinessException(
        403,
        'Only Global Admin can create Global Admin users',
        'errors.tenants.cannotAssignGlobalAdmin'
      )
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS)

    // Atomic: find-or-create user + create membership in a single transaction
    // SECURITY: Never overwrite an existing user's password hash
    try {
      const result = await this.prisma.$transaction(async tx => {
        const existing = await tx.user.findUnique({ where: { email: dto.email } })

        let user: {
          id: string
          email: string
          name: string
          lastLoginAt: Date | null
          mfaEnabled: boolean
          isProtected: boolean
        }

        if (existing) {
          if (existing.isProtected) {
            this.appLogger.warn('Add user failed: user is protected', {
              feature: AppLogFeature.TENANT_MEMBERS,
              action: 'addUser',
              className: 'TenantsService',
              sourceType: AppLogSourceType.SERVICE,
              outcome: AppLogOutcome.DENIED,
              metadata: { tenantId, userId: existing.id, email: dto.email },
            })
            throw new BusinessException(
              403,
              'Cannot add a protected user to another tenant',
              'errors.tenants.userProtected'
            )
          }
          if (dto.password) {
            this.appLogger.warn('Add user failed: user already exists with password conflict', {
              feature: AppLogFeature.TENANT_MEMBERS,
              action: 'addUser',
              className: 'TenantsService',
              sourceType: AppLogSourceType.SERVICE,
              outcome: AppLogOutcome.FAILURE,
              metadata: { tenantId, userId: existing.id, email: dto.email },
            })
            throw new BusinessException(
              409,
              'User already exists. Password cannot be changed via add user.',
              'errors.tenants.userAlreadyExists'
            )
          }
          user = existing
        } else {
          user = await tx.user.create({
            data: {
              email: dto.email,
              name: dto.name,
              passwordHash,
            },
          })
        }

        const membership = await tx.tenantMembership.create({
          data: {
            userId: user.id,
            tenantId,
            role: dto.role as UserRole,
          },
        })

        return { user, membership }
      })

      this.appLogger.info('User added to tenant', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'addUser',
        outcome: AppLogOutcome.SUCCESS,
        tenantId,
        targetResource: 'User',
        targetResourceId: result.user.id,
        actorEmail: result.user.email,
        sourceType: AppLogSourceType.SERVICE,
        className: 'TenantsService',
        functionName: 'addUser',
        metadata: { role: result.membership.role },
      })

      return {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        role: result.membership.role,
        status: result.membership.status,
        lastLoginAt: result.user.lastLoginAt,
        mfaEnabled: result.user.mfaEnabled,
        isProtected: result.user.isProtected,
        createdAt: result.membership.createdAt,
      }
    } catch (error) {
      if (error instanceof BusinessException) {
        throw error
      }
      const message = error instanceof Error ? error.message : ''
      if (message.includes('Unique constraint')) {
        this.appLogger.warn('Add user failed: email already exists in tenant', {
          feature: AppLogFeature.TENANT_MEMBERS,
          action: 'addUser',
          className: 'TenantsService',
          sourceType: AppLogSourceType.SERVICE,
          outcome: AppLogOutcome.FAILURE,
          metadata: { tenantId, email: dto.email },
        })
        throw new BusinessException(
          409,
          'Email already exists in this tenant',
          'errors.tenants.emailExists'
        )
      }
      this.appLogger.error('Unexpected error adding user to tenant', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'addUser',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: {
          error: error instanceof Error ? error.message : 'Unknown error',
          tenantId,
          email: dto.email,
        },
      })
      throw error
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
      this.appLogger.warn('Update user denied: cannot change own role', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'updateUser',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.DENIED,
        metadata: { tenantId, userId, callerId },
      })
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
      this.appLogger.warn('Update user failed: user not found in tenant', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'updateUser',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { tenantId, userId },
      })
      throw new BusinessException(
        404,
        'User not found in this tenant',
        'errors.tenants.userNotFound'
      )
    }

    if (membership.user.isProtected && dto.role !== undefined && dto.role !== membership.role) {
      this.appLogger.warn('Update user denied: protected user role change attempted', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'updateUser',
        outcome: AppLogOutcome.DENIED,
        tenantId,
        targetResource: 'User',
        targetResourceId: userId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'TenantsService',
        functionName: 'updateUser',
      })
      throw new BusinessException(
        403,
        'Cannot change the role of a protected user',
        'errors.tenants.userProtected'
      )
    }

    if (membership.role === UserRole.GLOBAL_ADMIN && callerRole !== UserRole.GLOBAL_ADMIN) {
      this.appLogger.warn('Update user denied: non-admin tried to modify GLOBAL_ADMIN user', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'updateUser',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.DENIED,
        metadata: { tenantId, userId, callerRole },
      })
      throw new BusinessException(
        403,
        'Only Global Admin can modify Global Admin users',
        'errors.tenants.cannotModifyGlobalAdmin'
      )
    }

    if (dto.role === UserRole.GLOBAL_ADMIN && callerRole !== UserRole.GLOBAL_ADMIN) {
      this.appLogger.warn('Update user denied: non-admin tried to assign GLOBAL_ADMIN role', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'updateUser',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.DENIED,
        metadata: { tenantId, userId, callerRole },
      })
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
      this.appLogger.warn('Update user failed: user not found after update', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'updateUser',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { tenantId, userId },
      })
      throw new BusinessException(
        404,
        'User not found in this tenant',
        'errors.tenants.userNotFound'
      )
    }

    this.appLogger.info('User updated in tenant', {
      feature: AppLogFeature.TENANT_MEMBERS,
      action: 'updateUser',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      targetResource: 'User',
      targetResourceId: userId,
      actorUserId: callerId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'TenantsService',
      functionName: 'updateUser',
      metadata: { updatedFields: Object.keys(dto) },
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

  async removeUser(
    tenantId: string,
    userId: string,
    callerRole: UserRole,
    callerId: string
  ): Promise<{ deleted: boolean }> {
    if (callerId === userId) {
      this.appLogger.warn('Remove user denied: cannot delete own account', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'removeUser',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.DENIED,
        metadata: { tenantId, userId, callerId },
      })
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
      this.appLogger.warn('Remove user failed: user not found in tenant', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'removeUser',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { tenantId, userId },
      })
      throw new BusinessException(
        404,
        'User not found in this tenant',
        'errors.tenants.userNotFound'
      )
    }

    if (membership.user.isProtected) {
      this.appLogger.warn('Remove user denied: user is protected', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'removeUser',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.DENIED,
        metadata: { tenantId, userId },
      })
      throw new BusinessException(
        403,
        'This user is protected and cannot be deleted',
        'errors.tenants.userProtected'
      )
    }

    if (membership.role === UserRole.GLOBAL_ADMIN && callerRole !== UserRole.GLOBAL_ADMIN) {
      this.appLogger.warn('Remove user denied: non-admin tried to remove GLOBAL_ADMIN user', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'removeUser',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.DENIED,
        metadata: { tenantId, userId, callerRole },
      })
      throw new BusinessException(
        403,
        'Only Global Admin can remove Global Admin users',
        'errors.tenants.cannotModifyGlobalAdmin'
      )
    }

    // Soft delete: set membership status to inactive
    await this.prisma.tenantMembership.update({
      where: { userId_tenantId: { userId, tenantId } },
      data: { status: MembershipStatus.INACTIVE },
    })

    this.appLogger.info('User soft-deleted from tenant', {
      feature: AppLogFeature.TENANT_MEMBERS,
      action: 'removeUser',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      targetResource: 'User',
      targetResourceId: userId,
      actorUserId: callerId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'TenantsService',
      functionName: 'removeUser',
    })

    return { deleted: true }
  }

  async restoreUser(tenantId: string, userId: string, callerRole: UserRole): Promise<UserRecord> {
    const membership = await this.prisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      include: { user: true },
    })
    if (!membership) {
      this.appLogger.warn('Restore user failed: user not found in tenant', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'restoreUser',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { tenantId, userId },
      })
      throw new BusinessException(
        404,
        'User not found in this tenant',
        'errors.tenants.userNotFound'
      )
    }

    if (membership.status !== MembershipStatus.INACTIVE) {
      this.appLogger.warn('Restore user failed: user is not deleted', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'restoreUser',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { tenantId, userId, currentStatus: membership.status },
      })
      throw new BusinessException(400, 'User is not deleted', 'errors.tenants.userNotDeleted')
    }

    if (membership.role === UserRole.GLOBAL_ADMIN && callerRole !== UserRole.GLOBAL_ADMIN) {
      this.appLogger.warn('Restore user denied: non-admin tried to restore GLOBAL_ADMIN user', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'restoreUser',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.DENIED,
        metadata: { tenantId, userId, callerRole },
      })
      throw new BusinessException(
        403,
        'Only Global Admin can restore Global Admin users',
        'errors.tenants.cannotModifyGlobalAdmin'
      )
    }

    const updated = await this.prisma.tenantMembership.update({
      where: { userId_tenantId: { userId, tenantId } },
      data: { status: MembershipStatus.ACTIVE },
      include: { user: true },
    })

    this.appLogger.info('User restored in tenant', {
      feature: AppLogFeature.TENANT_MEMBERS,
      action: 'restoreUser',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      targetResource: 'User',
      targetResourceId: userId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'TenantsService',
      functionName: 'restoreUser',
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
      this.appLogger.warn('Block user denied: cannot block own account', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'blockUser',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.DENIED,
        metadata: { tenantId, userId, callerId },
      })
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
      this.appLogger.warn('Block user failed: user not found in tenant', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'blockUser',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { tenantId, userId },
      })
      throw new BusinessException(
        404,
        'User not found in this tenant',
        'errors.tenants.userNotFound'
      )
    }

    if (membership.user.isProtected) {
      this.appLogger.warn('Block user denied: user is protected', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'blockUser',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.DENIED,
        metadata: { tenantId, userId },
      })
      throw new BusinessException(
        403,
        'This user is protected and cannot be blocked',
        'errors.tenants.userProtected'
      )
    }

    if (membership.role === UserRole.GLOBAL_ADMIN && callerRole !== UserRole.GLOBAL_ADMIN) {
      this.appLogger.warn('Block user denied: non-admin tried to block GLOBAL_ADMIN user', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'blockUser',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.DENIED,
        metadata: { tenantId, userId, callerRole },
      })
      throw new BusinessException(
        403,
        'Only Global Admin can block Global Admin users',
        'errors.tenants.cannotModifyGlobalAdmin'
      )
    }

    if (membership.status === MembershipStatus.SUSPENDED) {
      this.appLogger.warn('Block user failed: user is already blocked', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'blockUser',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { tenantId, userId },
      })
      throw new BusinessException(
        400,
        'User is already blocked',
        'errors.tenants.userAlreadyBlocked'
      )
    }

    const updated = await this.prisma.tenantMembership.update({
      where: { userId_tenantId: { userId, tenantId } },
      data: { status: MembershipStatus.SUSPENDED },
      include: { user: true },
    })

    this.appLogger.info('User blocked in tenant', {
      feature: AppLogFeature.TENANT_MEMBERS,
      action: 'blockUser',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      targetResource: 'User',
      targetResourceId: userId,
      actorUserId: callerId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'TenantsService',
      functionName: 'blockUser',
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
      this.appLogger.warn('Unblock user failed: user not found in tenant', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'unblockUser',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { tenantId, userId },
      })
      throw new BusinessException(
        404,
        'User not found in this tenant',
        'errors.tenants.userNotFound'
      )
    }

    if (membership.status !== MembershipStatus.SUSPENDED) {
      this.appLogger.warn('Unblock user failed: user is not blocked', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'unblockUser',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { tenantId, userId, currentStatus: membership.status },
      })
      throw new BusinessException(400, 'User is not blocked', 'errors.tenants.userNotBlocked')
    }

    if (membership.role === UserRole.GLOBAL_ADMIN && callerRole !== UserRole.GLOBAL_ADMIN) {
      this.appLogger.warn('Unblock user denied: non-admin tried to unblock GLOBAL_ADMIN user', {
        feature: AppLogFeature.TENANT_MEMBERS,
        action: 'unblockUser',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.DENIED,
        metadata: { tenantId, userId, callerRole },
      })
      throw new BusinessException(
        403,
        'Only Global Admin can unblock Global Admin users',
        'errors.tenants.cannotModifyGlobalAdmin'
      )
    }

    const updated = await this.prisma.tenantMembership.update({
      where: { userId_tenantId: { userId, tenantId } },
      data: { status: MembershipStatus.ACTIVE },
      include: { user: true },
    })

    this.appLogger.info('User unblocked in tenant', {
      feature: AppLogFeature.TENANT_MEMBERS,
      action: 'unblockUser',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      targetResource: 'User',
      targetResourceId: userId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'TenantsService',
      functionName: 'unblockUser',
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

  /**
   * Generates impersonation tokens for a target user, allowing an admin
   * to view the platform as that user. All validations are enforced here.
   */
  async impersonateUser(
    tenantId: string,
    userId: string,
    caller: JwtPayload
  ): Promise<ImpersonateUserResponse> {
    // 1. Reject nested impersonation
    if (caller.isImpersonated === true) {
      this.appLogger.warn('Impersonation denied: nested impersonation attempted', {
        feature: AppLogFeature.IMPERSONATION,
        action: 'impersonateUser',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.DENIED,
        metadata: { tenantId, userId, callerSub: caller.sub, callerEmail: caller.email },
      })
      throw new BusinessException(
        403,
        'Cannot impersonate while already impersonating',
        'errors.impersonation.nestedNotAllowed'
      )
    }

    // 2. Cannot impersonate self
    if (caller.sub === userId) {
      this.appLogger.warn('Impersonation denied: cannot impersonate self', {
        feature: AppLogFeature.IMPERSONATION,
        action: 'impersonateUser',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.DENIED,
        metadata: { tenantId, userId, callerSub: caller.sub },
      })
      throw new BusinessException(
        400,
        'Cannot impersonate yourself',
        'errors.impersonation.cannotImpersonateSelf'
      )
    }

    // 3. Validate target tenant exists
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true },
    })
    if (!tenant) {
      this.appLogger.warn('Impersonation failed: tenant not found', {
        feature: AppLogFeature.IMPERSONATION,
        action: 'impersonateUser',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { tenantId, userId },
      })
      throw new BusinessException(404, 'Tenant not found', 'errors.tenants.notFound')
    }

    // 4. Validate target user exists
    const targetUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, isProtected: true },
    })
    if (!targetUser) {
      this.appLogger.warn('Impersonation failed: target user not found', {
        feature: AppLogFeature.IMPERSONATION,
        action: 'impersonateUser',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { tenantId, userId },
      })
      throw new BusinessException(404, 'Target user not found', 'errors.impersonation.userNotFound')
    }

    // 5. Cannot impersonate protected users
    if (targetUser.isProtected) {
      this.appLogger.warn('Impersonation denied: target user is protected', {
        feature: AppLogFeature.IMPERSONATION,
        action: 'impersonateUser',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.DENIED,
        metadata: { tenantId, userId, targetEmail: targetUser.email },
      })
      throw new BusinessException(
        403,
        'Protected users cannot be impersonated',
        'errors.impersonation.protectedUser'
      )
    }

    // 6. Validate target has active membership in this tenant
    const targetMembership = await this.prisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
    })
    if (targetMembership?.status !== MembershipStatus.ACTIVE) {
      this.appLogger.warn('Impersonation denied: target user not active in tenant', {
        feature: AppLogFeature.IMPERSONATION,
        action: 'impersonateUser',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.DENIED,
        metadata: {
          tenantId,
          userId,
          targetEmail: targetUser.email,
          membershipStatus: targetMembership?.status,
        },
      })
      throw new BusinessException(
        403,
        'Target user is not active in this tenant',
        'errors.impersonation.userNotActive'
      )
    }

    // 7. Cannot impersonate a user with higher or equal privilege (unless GLOBAL_ADMIN)
    const callerRoleIndex = ROLE_HIERARCHY.indexOf(caller.role)
    const targetRoleIndex = ROLE_HIERARCHY.indexOf(targetMembership.role as UserRole)

    if (callerRoleIndex === -1 || targetRoleIndex === -1) {
      this.appLogger.warn('Impersonation denied: invalid role hierarchy', {
        feature: AppLogFeature.IMPERSONATION,
        action: 'impersonateUser',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.DENIED,
        metadata: { tenantId, userId, callerRole: caller.role, targetRole: targetMembership.role },
      })
      throw new BusinessException(
        403,
        'Invalid role hierarchy',
        'errors.impersonation.insufficientPrivilege'
      )
    }

    // Caller must be strictly more privileged (lower index) than target
    if (callerRoleIndex >= targetRoleIndex) {
      this.appLogger.warn('Impersonation denied: insufficient privilege', {
        feature: AppLogFeature.IMPERSONATION,
        action: 'impersonateUser',
        className: 'TenantsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.DENIED,
        metadata: { tenantId, userId, callerRole: caller.role, targetRole: targetMembership.role },
      })
      throw new BusinessException(
        403,
        'Cannot impersonate a user with equal or higher privileges',
        'errors.impersonation.insufficientPrivilege'
      )
    }

    // 8. Generate impersonation tokens for the target user
    const targetPayload: JwtPayload = {
      sub: targetUser.id,
      email: targetUser.email,
      tenantId,
      tenantSlug: tenant.slug,
      role: targetMembership.role as UserRole,
      isImpersonated: true,
      impersonatorSub: caller.sub,
      impersonatorEmail: caller.email,
    }

    const accessToken = this.authService.signAccessToken(targetPayload)
    const refreshToken = this.authService.signRefreshToken(targetPayload)

    this.appLogger.info('Impersonation started', {
      feature: AppLogFeature.IMPERSONATION,
      action: 'impersonateUser',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      actorEmail: caller.email,
      actorUserId: caller.sub,
      targetResource: 'User',
      targetResourceId: targetUser.id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'TenantsService',
      functionName: 'impersonateUser',
      metadata: {
        targetEmail: targetUser.email,
        targetRole: targetMembership.role,
        callerRole: caller.role,
      },
    })

    return {
      accessToken,
      refreshToken,
      user: {
        sub: targetUser.id,
        email: targetUser.email,
        tenantId,
        tenantSlug: tenant.slug,
        role: targetMembership.role,
      },
      impersonator: {
        sub: caller.sub,
        email: caller.email,
        role: caller.role,
        tenantId: caller.tenantId,
        tenantSlug: caller.tenantSlug,
      },
    }
  }
}
