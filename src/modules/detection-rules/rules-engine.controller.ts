import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { DetectionRulesService } from './detection-rules.service'
import {
  type CreateDetectionRuleDto,
  CreateDetectionRuleSchema,
} from './dto/create-detection-rule.dto'
import { ListDetectionRulesQuerySchema } from './dto/list-detection-rules-query.dto'
import {
  type UpdateDetectionRuleDto,
  UpdateDetectionRuleSchema,
} from './dto/update-detection-rule.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { AuthGuard } from '../../common/guards/auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { TenantGuard } from '../../common/guards/tenant.guard'
import { type JwtPayload, UserRole } from '../../common/interfaces/authenticated-request.interface'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type {
  DetectionRuleRecord,
  DetectionRuleStats,
  PaginatedDetectionRules,
} from './detection-rules.types'

/**
 * Alias controller that registers /rules-engine routes,
 * delegating to the same DetectionRulesService.
 */
@Controller('rules-engine')
@UseGuards(AuthGuard, TenantGuard)
@Throttle({ default: { limit: 30, ttl: 60000 } })
export class RulesEngineController {
  constructor(private readonly detectionRulesService: DetectionRulesService) {}

  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async listRules(
    @TenantId() tenantId: string,
    @Query() rawQuery: Record<string, string>
  ): Promise<PaginatedDetectionRules> {
    const { page, limit, sortBy, sortOrder, ruleType, severity, status, query } =
      ListDetectionRulesQuerySchema.parse(rawQuery)
    return this.detectionRulesService.listRules(
      tenantId,
      page,
      limit,
      sortBy,
      sortOrder,
      ruleType,
      severity,
      status,
      query
    )
  }

  @Get('stats')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async getDetectionRuleStats(@TenantId() tenantId: string): Promise<DetectionRuleStats> {
    return this.detectionRulesService.getDetectionRuleStats(tenantId)
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async getRuleById(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string
  ): Promise<DetectionRuleRecord> {
    return this.detectionRulesService.getRuleById(id, tenantId)
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  async createRule(
    @Body(new ZodValidationPipe(CreateDetectionRuleSchema)) dto: CreateDetectionRuleDto,
    @CurrentUser() user: JwtPayload
  ): Promise<DetectionRuleRecord> {
    return this.detectionRulesService.createRule(dto, user)
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  async updateRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateDetectionRuleSchema)) dto: UpdateDetectionRuleDto,
    @CurrentUser() user: JwtPayload
  ): Promise<DetectionRuleRecord> {
    return this.detectionRulesService.updateRule(id, dto, user)
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async deleteRule(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<{ deleted: boolean }> {
    return this.detectionRulesService.deleteRule(id, tenantId, user.email)
  }
}
