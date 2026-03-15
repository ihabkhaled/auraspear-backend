import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { CorrelationService } from './correlation.service'
import { type CreateRuleDto, CreateRuleSchema } from './dto/create-rule.dto'
import { ListRulesQuerySchema } from './dto/list-rules-query.dto'
import { type UpdateRuleDto, UpdateRuleSchema } from './dto/update-rule.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { AuthGuard } from '../../common/guards/auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { TenantGuard } from '../../common/guards/tenant.guard'
import { type JwtPayload, UserRole } from '../../common/interfaces/authenticated-request.interface'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { CorrelationStats, PaginatedRules, RuleRecord } from './correlation.types'

@Controller('correlation')
@UseGuards(AuthGuard, TenantGuard)
export class CorrelationController {
  constructor(private readonly correlationService: CorrelationService) {}

  @Get()
  async listRules(
    @TenantId() tenantId: string,
    @Query() rawQuery: Record<string, string>
  ): Promise<PaginatedRules> {
    const { page, limit, sortBy, sortOrder, source, severity, status, query } =
      ListRulesQuerySchema.parse(rawQuery)
    return this.correlationService.listRules(
      tenantId,
      page,
      limit,
      sortBy,
      sortOrder,
      source,
      severity,
      status,
      query
    )
  }

  @Get('stats')
  async getCorrelationStats(@TenantId() tenantId: string): Promise<CorrelationStats> {
    return this.correlationService.getCorrelationStats(tenantId)
  }

  @Get(':id')
  async getRuleById(@Param('id', ParseUUIDPipe) id: string, @TenantId() tenantId: string): Promise<RuleRecord> {
    return this.correlationService.getRuleById(id, tenantId)
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async createRule(
    @Body(new ZodValidationPipe(CreateRuleSchema)) dto: CreateRuleDto,
    @CurrentUser() user: JwtPayload
  ): Promise<RuleRecord> {
    return this.correlationService.createRule(dto, user)
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async updateRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateRuleSchema)) dto: UpdateRuleDto,
    @CurrentUser() user: JwtPayload
  ): Promise<RuleRecord> {
    return this.correlationService.updateRule(id, dto, user)
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  async deleteRule(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<{ deleted: boolean }> {
    return this.correlationService.deleteRule(id, tenantId, user.email)
  }
}
