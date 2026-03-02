import { Controller, Get, Post, Patch, Delete, Param, Body, UsePipes } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
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
import { type JwtPayload, UserRole } from '../../common/interfaces/authenticated-request.interface'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { TenantRecord, TenantWithCounts, UserRecord } from './tenants.types'

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

  @Patch(':id')
  @Roles(UserRole.TENANT_ADMIN)
  async updateTenant(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateTenantSchema)) dto: UpdateTenantDto
  ): Promise<TenantRecord> {
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
  async listUsers(@Param('id') tenantId: string): Promise<UserRecord[]> {
    return this.tenantsService.findUsers(tenantId)
  }

  @Post(':id/users')
  @Roles(UserRole.TENANT_ADMIN)
  async addUser(
    @Param('id') tenantId: string,
    @Body(new ZodValidationPipe(AddUserSchema)) dto: AddUserDto,
    @CurrentUser() user: JwtPayload
  ): Promise<UserRecord> {
    return this.tenantsService.addUser(tenantId, dto, user.role)
  }

  @Patch(':tenantId/users/:userId')
  @Roles(UserRole.TENANT_ADMIN)
  async updateUser(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(UpdateUserSchema)) dto: UpdateUserDto,
    @CurrentUser() user: JwtPayload
  ): Promise<UserRecord> {
    return this.tenantsService.updateUser(tenantId, userId, dto, user.role, user.sub)
  }

  @Delete(':tenantId/users/:userId')
  @Roles(UserRole.TENANT_ADMIN)
  async removeUser(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<{ deleted: boolean }> {
    return this.tenantsService.removeUser(tenantId, userId, user.role, user.sub)
  }

  @Post(':tenantId/users/:userId/restore')
  @Roles(UserRole.TENANT_ADMIN)
  async restoreUser(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<UserRecord> {
    return this.tenantsService.restoreUser(tenantId, userId, user.role)
  }

  @Post(':tenantId/users/:userId/block')
  @Roles(UserRole.TENANT_ADMIN)
  async blockUser(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<UserRecord> {
    return this.tenantsService.blockUser(tenantId, userId, user.role, user.sub)
  }

  @Post(':tenantId/users/:userId/unblock')
  @Roles(UserRole.TENANT_ADMIN)
  async unblockUser(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<UserRecord> {
    return this.tenantsService.unblockUser(tenantId, userId, user.role)
  }
}
