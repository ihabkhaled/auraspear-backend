import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { CloudSecurityService } from './cloud-security.service'
import { type CreateAccountDto, CreateAccountSchema } from './dto/create-account.dto'
import { ListAccountsQuerySchema } from './dto/list-accounts-query.dto'
import { ListFindingsQuerySchema } from './dto/list-findings-query.dto'
import { type UpdateAccountDto, UpdateAccountSchema } from './dto/update-account.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { AuthGuard } from '../../common/guards/auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { TenantGuard } from '../../common/guards/tenant.guard'
import { type JwtPayload, UserRole } from '../../common/interfaces/authenticated-request.interface'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type {
  CloudAccountRecord,
  CloudSecurityStats,
  PaginatedAccounts,
  PaginatedFindings,
} from './cloud-security.types'

@Controller('cloud-security')
@UseGuards(AuthGuard, TenantGuard)
@Throttle({ default: { limit: 30, ttl: 60000 } })
export class CloudSecurityController {
  constructor(private readonly cloudSecurityService: CloudSecurityService) {}

  @Get('stats')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async getStats(@TenantId() tenantId: string): Promise<CloudSecurityStats> {
    return this.cloudSecurityService.getCloudSecurityStats(tenantId)
  }

  @Get('accounts')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async listAccounts(
    @TenantId() tenantId: string,
    @Query() rawQuery: Record<string, string>
  ): Promise<PaginatedAccounts> {
    const { page, limit, sortBy, sortOrder, provider, status } =
      ListAccountsQuerySchema.parse(rawQuery)
    return this.cloudSecurityService.listAccounts(
      tenantId,
      page,
      limit,
      sortBy,
      sortOrder,
      provider,
      status
    )
  }

  @Get('accounts/stats')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async getCloudSecurityStats(@TenantId() tenantId: string): Promise<CloudSecurityStats> {
    return this.cloudSecurityService.getCloudSecurityStats(tenantId)
  }

  @Get('accounts/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async getAccountById(
    @Param('id') id: string,
    @TenantId() tenantId: string
  ): Promise<CloudAccountRecord> {
    return this.cloudSecurityService.getAccountById(id, tenantId)
  }

  @Post('accounts')
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  async createAccount(
    @Body(new ZodValidationPipe(CreateAccountSchema)) dto: CreateAccountDto,
    @CurrentUser() user: JwtPayload
  ): Promise<CloudAccountRecord> {
    return this.cloudSecurityService.createAccount(dto, user)
  }

  @Patch('accounts/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  async updateAccount(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateAccountSchema)) dto: UpdateAccountDto,
    @CurrentUser() user: JwtPayload
  ): Promise<CloudAccountRecord> {
    return this.cloudSecurityService.updateAccount(id, dto, user)
  }

  @Delete('accounts/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async deleteAccount(
    @Param('id') id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<{ deleted: boolean }> {
    return this.cloudSecurityService.deleteAccount(id, tenantId, user.email)
  }

  @Get('findings')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async listFindings(
    @TenantId() tenantId: string,
    @Query() rawQuery: Record<string, string>
  ): Promise<PaginatedFindings> {
    const { page, limit, sortBy, sortOrder, severity, status, cloudAccountId } =
      ListFindingsQuerySchema.parse(rawQuery)
    return this.cloudSecurityService.listFindings(
      tenantId,
      page,
      limit,
      sortBy,
      sortOrder,
      severity,
      status,
      cloudAccountId
    )
  }
}
