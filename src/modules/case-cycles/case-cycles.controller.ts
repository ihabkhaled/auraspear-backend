import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { CaseCyclesService } from './case-cycles.service'
import { type CloseCaseCycleDto, CloseCaseCycleSchema } from './dto/close-case-cycle.dto'
import { type CreateCaseCycleDto, CreateCaseCycleSchema } from './dto/create-case-cycle.dto'
import { ListCaseCyclesQuerySchema } from './dto/list-case-cycles-query.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { AuthGuard } from '../../common/guards/auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { TenantGuard } from '../../common/guards/tenant.guard'
import { type JwtPayload, UserRole } from '../../common/interfaces/authenticated-request.interface'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { CaseCycleDetail, CaseCycleRecord, PaginatedCaseCycles } from './case-cycles.types'

@Controller('case-cycles')
@UseGuards(AuthGuard, TenantGuard)
export class CaseCyclesController {
  constructor(private readonly caseCyclesService: CaseCyclesService) {}

  @Get()
  async listCycles(
    @TenantId() tenantId: string,
    @Query() rawQuery: Record<string, string>
  ): Promise<PaginatedCaseCycles> {
    const { page, limit, sortBy, sortOrder, status } = ListCaseCyclesQuerySchema.parse(rawQuery)
    return this.caseCyclesService.listCycles(tenantId, page, limit, sortBy, sortOrder, status)
  }

  @Get('active')
  async getActiveCycle(@TenantId() tenantId: string): Promise<{ data: CaseCycleRecord | null }> {
    const cycle = await this.caseCyclesService.getActiveCycle(tenantId)
    return { data: cycle }
  }

  @Get('orphaned-stats')
  async getOrphanedStats(
    @TenantId() tenantId: string
  ): Promise<{ data: { caseCount: number; openCount: number; closedCount: number } }> {
    const stats = await this.caseCyclesService.getOrphanedStats(tenantId)
    return { data: stats }
  }

  @Get(':id')
  async getCycleById(
    @Param('id') id: string,
    @TenantId() tenantId: string
  ): Promise<{ data: CaseCycleDetail }> {
    const cycle = await this.caseCyclesService.getCycleById(id, tenantId)
    return { data: cycle }
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  async createCycle(
    @Body(new ZodValidationPipe(CreateCaseCycleSchema)) dto: CreateCaseCycleDto,
    @CurrentUser() user: JwtPayload
  ): Promise<{ data: CaseCycleRecord }> {
    const cycle = await this.caseCyclesService.createCycle(dto, user)
    return { data: cycle }
  }

  @Patch(':id/close')
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  async closeCycle(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CloseCaseCycleSchema)) dto: CloseCaseCycleDto,
    @CurrentUser() user: JwtPayload
  ): Promise<{ data: CaseCycleRecord }> {
    const cycle = await this.caseCyclesService.closeCycle(id, dto, user)
    return { data: cycle }
  }
}
