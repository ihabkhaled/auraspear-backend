import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UsePipes } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { ListUsersQuerySchema } from './dto/list-users-query.dto'
import {
  CreateTenantSchema,
  type CreateTenantDto,
  UpdateTenantSchema,
  type UpdateTenantDto,
  AddUserSchema,
  type AddUserDto,
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
import type { TenantMember, TenantRecord, TenantWithCounts, UserRecord } from './tenants.types'

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
  async listTenants(): Promise<TenantWithCounts[]> {
    return this.tenantsService.findAll()
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
  ): Promise<UserRecord[]> {
    assertTenantAccess(user, tenantId)
    const { sortBy, sortOrder, role, status } = ListUsersQuerySchema.parse(rawQuery)
    return this.tenantsService.findUsers(tenantId, sortBy, sortOrder, role, status)
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
    return this.tenantsService.updateUser(tenantId, userId, dto, user.role, user.sub)
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
    return this.tenantsService.removeUser(tenantId, userId, user.role, user.sub)
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
    return this.tenantsService.restoreUser(tenantId, userId, user.role)
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
    return this.tenantsService.blockUser(tenantId, userId, user.role, user.sub)
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
    return this.tenantsService.unblockUser(tenantId, userId, user.role)
  }
}
