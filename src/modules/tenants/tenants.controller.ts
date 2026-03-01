import { Controller, Get, Post, Patch, Delete, Param, Body, UsePipes } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import {
  CreateTenantSchema,
  type CreateTenantDto,
  UpdateTenantSchema,
  type UpdateTenantDto,
  AddUserSchema,
  type AddUserDto,
  UpdateUserRoleSchema,
  type UpdateUserRoleDto,
} from './dto/tenant.dto'
import { TenantsService } from './tenants.service'
import { Roles } from '../../common/decorators/roles.decorator'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { UserRole } from '../../common/interfaces/authenticated-request.interface'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'

@ApiTags('tenants')
@ApiBearerAuth()
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get()
  @Roles(UserRole.GLOBAL_ADMIN)
  async listTenants() {
    return this.tenantsService.findAll()
  }

  @Post()
  @Roles(UserRole.GLOBAL_ADMIN)
  @UsePipes(new ZodValidationPipe(CreateTenantSchema))
  async createTenant(@Body() dto: CreateTenantDto) {
    return this.tenantsService.create(dto)
  }

  @Get('current')
  async getCurrentTenant(@TenantId() tenantId: string) {
    return this.tenantsService.findById(tenantId)
  }

  @Patch(':id')
  @Roles(UserRole.TENANT_ADMIN)
  @UsePipes(new ZodValidationPipe(UpdateTenantSchema))
  async updateTenant(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.tenantsService.update(id, dto)
  }

  @Delete(':id')
  @Roles(UserRole.GLOBAL_ADMIN)
  async deleteTenant(@Param('id') id: string) {
    return this.tenantsService.remove(id)
  }

  // ─── User Management ────────────────────────────────

  @Get(':id/users')
  @Roles(UserRole.TENANT_ADMIN)
  async listUsers(@Param('id') tenantId: string) {
    return this.tenantsService.findUsers(tenantId)
  }

  @Post(':id/users')
  @Roles(UserRole.TENANT_ADMIN)
  @UsePipes(new ZodValidationPipe(AddUserSchema))
  async addUser(@Param('id') tenantId: string, @Body() dto: AddUserDto) {
    return this.tenantsService.addUser(tenantId, dto)
  }

  @Patch(':tenantId/users/:userId/role')
  @Roles(UserRole.TENANT_ADMIN)
  @UsePipes(new ZodValidationPipe(UpdateUserRoleSchema))
  async updateUserRole(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateUserRoleDto
  ) {
    return this.tenantsService.updateUserRole(tenantId, userId, dto.role)
  }

  @Delete(':tenantId/users/:userId')
  @Roles(UserRole.TENANT_ADMIN)
  async removeUser(@Param('tenantId') tenantId: string, @Param('userId') userId: string) {
    return this.tenantsService.removeUser(tenantId, userId)
  }
}
