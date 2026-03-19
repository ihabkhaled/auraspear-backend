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
import { type CreateReportDto, CreateReportSchema } from './dto/create-report.dto'
import { ListReportsQuerySchema } from './dto/list-reports-query.dto'
import { type UpdateReportDto, UpdateReportSchema } from './dto/update-report.dto'
import { ReportsService } from './reports.service'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermission } from '../../common/decorators/permission.decorator'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { Permission } from '../../common/enums'
import { AuthGuard } from '../../common/guards/auth.guard'
import { TenantGuard } from '../../common/guards/tenant.guard'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { ReportRecord, PaginatedReports, ReportStats } from './reports.types'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'

@Controller('reports')
@UseGuards(AuthGuard, TenantGuard)
@Throttle({ default: { limit: 30, ttl: 60000 } })
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get()
  @RequirePermission(Permission.REPORTS_VIEW)
  async listReports(
    @TenantId() tenantId: string,
    @Query() rawQuery: Record<string, string>
  ): Promise<PaginatedReports> {
    const { page, limit, sortBy, sortOrder, type, status, query, format } =
      ListReportsQuerySchema.parse(rawQuery)
    return this.reportsService.listReports(
      tenantId,
      page,
      limit,
      sortBy,
      sortOrder,
      type,
      status,
      query,
      format
    )
  }

  @Get('stats')
  @RequirePermission(Permission.REPORTS_VIEW)
  async getReportStats(@TenantId() tenantId: string): Promise<ReportStats> {
    return this.reportsService.getReportStats(tenantId)
  }

  @Get(':id')
  @RequirePermission(Permission.REPORTS_VIEW)
  async getReportById(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string
  ): Promise<ReportRecord> {
    return this.reportsService.getReportById(id, tenantId)
  }

  @Post()
  @RequirePermission(Permission.REPORTS_CREATE)
  async createReport(
    @Body(new ZodValidationPipe(CreateReportSchema)) dto: CreateReportDto,
    @CurrentUser() user: JwtPayload
  ): Promise<ReportRecord> {
    return this.reportsService.createReport(dto, user)
  }

  @Patch(':id')
  @RequirePermission(Permission.REPORTS_UPDATE)
  async updateReport(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateReportSchema)) dto: UpdateReportDto,
    @CurrentUser() user: JwtPayload
  ): Promise<ReportRecord> {
    return this.reportsService.updateReport(id, dto, user)
  }

  @Post(':id/export')
  @RequirePermission(Permission.REPORTS_EXPORT)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async exportReport(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<ReportRecord> {
    return this.reportsService.exportReport(id, tenantId, user)
  }

  @Delete(':id')
  @RequirePermission(Permission.REPORTS_DELETE)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async deleteReport(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<{ deleted: boolean }> {
    return this.reportsService.deleteReport(id, tenantId, user.email)
  }
}
