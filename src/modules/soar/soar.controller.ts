import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { type CreatePlaybookDto, CreatePlaybookSchema } from './dto/create-playbook.dto'
import { ListPlaybooksQuerySchema } from './dto/list-playbooks-query.dto'
import { type UpdatePlaybookDto, UpdatePlaybookSchema } from './dto/update-playbook.dto'
import { SoarService } from './soar.service'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { AuthGuard } from '../../common/guards/auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { TenantGuard } from '../../common/guards/tenant.guard'
import { type JwtPayload, UserRole } from '../../common/interfaces/authenticated-request.interface'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type {
  SoarPlaybookRecord,
  PaginatedPlaybooks,
  SoarExecutionRecord,
  PaginatedExecutions,
  SoarStats,
} from './soar.types'

@Controller('soar')
@UseGuards(AuthGuard, TenantGuard)
export class SoarController {
  constructor(private readonly soarService: SoarService) {}

  @Get('playbooks')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async listPlaybooks(
    @TenantId() tenantId: string,
    @Query() rawQuery: Record<string, string>
  ): Promise<PaginatedPlaybooks> {
    const { page, limit, sortBy, sortOrder, status, triggerType, query } =
      ListPlaybooksQuerySchema.parse(rawQuery)
    return this.soarService.listPlaybooks(
      tenantId,
      page,
      limit,
      sortBy,
      sortOrder,
      status,
      triggerType,
      query
    )
  }

  @Get('stats')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async getSoarStats(@TenantId() tenantId: string): Promise<SoarStats> {
    return this.soarService.getSoarStats(tenantId)
  }

  @Get('playbooks/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async getPlaybookById(
    @Param('id') id: string,
    @TenantId() tenantId: string
  ): Promise<SoarPlaybookRecord> {
    return this.soarService.getPlaybookById(id, tenantId)
  }

  @Post('playbooks')
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  async createPlaybook(
    @Body(new ZodValidationPipe(CreatePlaybookSchema)) dto: CreatePlaybookDto,
    @CurrentUser() user: JwtPayload
  ): Promise<SoarPlaybookRecord> {
    return this.soarService.createPlaybook(dto, user)
  }

  @Patch('playbooks/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  async updatePlaybook(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdatePlaybookSchema)) dto: UpdatePlaybookDto,
    @CurrentUser() user: JwtPayload
  ): Promise<SoarPlaybookRecord> {
    return this.soarService.updatePlaybook(id, dto, user)
  }

  @Delete('playbooks/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  async deletePlaybook(
    @Param('id') id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<{ deleted: boolean }> {
    return this.soarService.deletePlaybook(id, tenantId, user.email)
  }

  @Get('executions')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async listExecutions(
    @TenantId() tenantId: string,
    @Query('playbookId') playbookId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ): Promise<PaginatedExecutions> {
    return this.soarService.listExecutions(
      tenantId,
      playbookId,
      page ? Number.parseInt(page, 10) : undefined,
      limit ? Number.parseInt(limit, 10) : undefined
    )
  }

  @Post('playbooks/:id/execute')
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  async executePlaybook(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload
  ): Promise<SoarExecutionRecord> {
    return this.soarService.executePlaybook(id, user)
  }
}
