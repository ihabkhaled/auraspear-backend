import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UsePipes } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { ImpersonateUserSchema, type ImpersonateUserDto } from './dto/impersonate-user.dto'
import { ListTenantsQuerySchema } from './dto/list-tenants-query.dto'
import { ListUsersQuerySchema } from './dto/list-users-query.dto'
import {
  CreateTenantSchema,
  type CreateTenantDto,
  UpdateTenantSchema,
  type UpdateTenantDto,
  AddUserSchema,
  type AddUserDto,
  AssignUserSchema,
  type AssignUserDto,
  CheckEmailSchema,
  UpdateUserSchema,
  type UpdateUserDto,
} from './dto/tenant.dto'
import { TenantsService } from './tenants.service'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { BusinessException } from '../../common/exceptions/business.exception'
import { type JwtPayload, UserRole } from '../../common/interfaces/authenticated-request.interface'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type {
  TenantMember,
  TenantRecord,
  TenantWithCounts,
  UserRecord,
  PaginatedResult,
  CheckEmailResult,
  ImpersonateUserResponse,
} from './tenants.types'

/**
 * Validates that a TENANT_ADMIN is only operating on their own tenant.
 * GLOBAL_ADMIN can operate on any tenant.
 */
function assertTenantAccess(user: JwtPayload, parameterTenantId: string): void {
  if (user.role !== UserRole.GLOBAL_ADMIN && parameterTenantId !== user.tenantId) {
    throw new BusinessException(
      403,
      'Cannot operate on another tenant',
      'errors.tenants.crossTenantAccessDenied'
    )
  }
}

@ApiTags('tenants')
@ApiBearerAuth()
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get()
  @Roles(UserRole.GLOBAL_ADMIN)
  async listTenants(
    @Query() rawQuery: Record<string, string>
  ): Promise<PaginatedResult<TenantWithCounts>> {
    const { page, limit, search, sortBy, sortOrder } = ListTenantsQuerySchema.parse(rawQuery)
    return this.tenantsService.findAll(page, limit, search, sortBy, sortOrder)
  }

  @Post()
  @Roles(UserRole.GLOBAL_ADMIN)
  @UsePipes(new ZodValidationPipe(CreateTenantSchema))
  async createTenant(@Body() dto: CreateTenantDto): Promise<TenantRecord> {
    return this.tenantsService.create(dto)
  }

  @Get('current')
  async getCurrentTenant(@TenantId() tenantId: string): Promise<TenantWithCounts> {
    return this.tenantsService.findById(tenantId)
  }

  /** Lightweight member list for assignee pickers — any authenticated user. */
  @Get('current/members')
  async getCurrentTenantMembers(@TenantId() tenantId: string): Promise<TenantMember[]> {
    return this.tenantsService.findMembers(tenantId)
  }

  @Patch(':id')
  @Roles(UserRole.TENANT_ADMIN)
  async updateTenant(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateTenantSchema)) dto: UpdateTenantDto,
    @CurrentUser() user: JwtPayload
  ): Promise<TenantRecord> {
    assertTenantAccess(user, id)
    return this.tenantsService.update(id, dto)
  }

  @Delete(':id')
  @Roles(UserRole.GLOBAL_ADMIN)
  async deleteTenant(@Param('id') id: string): Promise<{ deleted: boolean }> {
    return this.tenantsService.remove(id)
  }

  // ─── User Management ────────────────────────────────

  @Get(':id/users')
  @Roles(UserRole.TENANT_ADMIN)
  async listUsers(
    @Param('id') tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Query() rawQuery: Record<string, string>
  ): Promise<PaginatedResult<UserRecord>> {
    assertTenantAccess(user, tenantId)
    const { page, limit, search, sortBy, sortOrder, role, status } =
      ListUsersQuerySchema.parse(rawQuery)
    return this.tenantsService.findUsers(
      tenantId,
      page,
      limit,
      search,
      sortBy,
      sortOrder,
      role,
      status
    )
  }

  @Get(':id/users/check-email')
  @Roles(UserRole.TENANT_ADMIN)
  async checkEmail(
    @Param('id') tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Query() rawQuery: Record<string, string>
  ): Promise<CheckEmailResult> {
    assertTenantAccess(user, tenantId)
    const { email } = CheckEmailSchema.parse(rawQuery)
    return this.tenantsService.checkEmail(tenantId, email)
  }

  @Post(':id/users')
  @Roles(UserRole.TENANT_ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async addUser(
    @Param('id') tenantId: string,
    @Body(new ZodValidationPipe(AddUserSchema)) dto: AddUserDto,
    @CurrentUser() user: JwtPayload
  ): Promise<UserRecord> {
    assertTenantAccess(user, tenantId)
    return this.tenantsService.addUser(tenantId, dto, user.role)
  }

  @Post(':id/users/assign')
  @Roles(UserRole.TENANT_ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async assignUser(
    @Param('id') tenantId: string,
    @Body(new ZodValidationPipe(AssignUserSchema)) dto: AssignUserDto,
    @CurrentUser() user: JwtPayload
  ): Promise<UserRecord> {
    assertTenantAccess(user, tenantId)
    return this.tenantsService.assignUser(tenantId, dto, user.role, user.sub, user.email)
  }

  @Patch(':tenantId/users/:userId')
  @Roles(UserRole.TENANT_ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async updateUser(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(UpdateUserSchema)) dto: UpdateUserDto,
    @CurrentUser() user: JwtPayload
  ): Promise<UserRecord> {
    assertTenantAccess(user, tenantId)
    return this.tenantsService.updateUser(tenantId, userId, dto, user.role, user.sub, user.email)
  }

  @Delete(':tenantId/users/:userId')
  @Roles(UserRole.TENANT_ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async removeUser(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<{ deleted: boolean }> {
    assertTenantAccess(user, tenantId)
    return this.tenantsService.removeUser(tenantId, userId, user.role, user.sub, user.email)
  }

  @Post(':tenantId/users/:userId/restore')
  @Roles(UserRole.TENANT_ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async restoreUser(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<UserRecord> {
    assertTenantAccess(user, tenantId)
    return this.tenantsService.restoreUser(tenantId, userId, user.role, user.sub, user.email)
  }

  @Post(':tenantId/users/:userId/block')
  @Roles(UserRole.TENANT_ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async blockUser(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<UserRecord> {
    assertTenantAccess(user, tenantId)
    return this.tenantsService.blockUser(tenantId, userId, user.role, user.sub, user.email)
  }

  @Post(':tenantId/users/:userId/unblock')
  @Roles(UserRole.TENANT_ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async unblockUser(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<UserRecord> {
    assertTenantAccess(user, tenantId)
    return this.tenantsService.unblockUser(tenantId, userId, user.role, user.sub, user.email)
  }

  // ─── Impersonation ────────────────────────────────

  @Post(':tenantId/users/:userId/impersonate')
  @Roles(UserRole.TENANT_ADMIN)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async impersonateUser(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(ImpersonateUserSchema)) _dto: ImpersonateUserDto,
    @CurrentUser() user: JwtPayload
  ): Promise<ImpersonateUserResponse> {
    assertTenantAccess(user, tenantId)
    return this.tenantsService.impersonateUser(tenantId, userId, user)
  }
}
