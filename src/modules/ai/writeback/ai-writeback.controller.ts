import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { AiWritebackRepository } from './ai-writeback.repository'
import { AiWritebackService } from './ai-writeback.service'
import { ListFindingsQuerySchema } from './dto/list-findings-query.dto'
import { RequirePermission } from '../../../common/decorators/permission.decorator'
import { TenantId } from '../../../common/decorators/tenant-id.decorator'
import { Permission } from '../../../common/enums'
import { AuthGuard } from '../../../common/guards/auth.guard'
import { TenantGuard } from '../../../common/guards/tenant.guard'
import type { PaginatedResponse } from '../../../common/interfaces/pagination.interface'
import type { AiExecutionFinding } from '@prisma/client'

@Controller('ai/findings')
@UseGuards(AuthGuard, TenantGuard)
@Throttle({ default: { limit: 30, ttl: 60000 } })
export class AiWritebackController {
  constructor(
    private readonly repository: AiWritebackRepository,
    private readonly service: AiWritebackService
  ) {}

  /**
   * GET /ai/findings
   * List AI execution findings with filters, tenant-scoped, paginated.
   */
  @Get()
  @RequirePermission(Permission.AI_AGENTS_VIEW)
  async listFindings(
    @TenantId() tenantId: string,
    @Query() rawQuery: Record<string, string>
  ): Promise<PaginatedResponse<AiExecutionFinding>> {
    const query = ListFindingsQuerySchema.parse(rawQuery)
    return this.repository.listFindings(tenantId, query)
  }

  /**
   * GET /ai/findings/:id
   * Get a single AI execution finding by ID, tenant-scoped.
   */
  @Get(':id')
  @RequirePermission(Permission.AI_AGENTS_VIEW)
  async getFinding(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string
  ): Promise<AiExecutionFinding> {
    return this.service.getFindingById(tenantId, id)
  }

  /**
   * GET /ai/findings/by-entity/:entityType/:entityId
   * Get all findings for a specific source entity (alert, case, incident).
   */
  @Get('by-entity/:entityType/:entityId')
  @RequirePermission(Permission.AI_AGENTS_VIEW)
  async findingsByEntity(
    @TenantId() tenantId: string,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string
  ): Promise<AiExecutionFinding[]> {
    return this.repository.findingsByEntity(tenantId, entityType, entityId)
  }
}
