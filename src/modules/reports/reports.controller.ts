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
import { type CreateReportDto, CreateReportSchema } from './dto/create-report.dto'
import { ListReportsQuerySchema } from './dto/list-reports-query.dto'
import { type UpdateReportDto, UpdateReportSchema } from './dto/update-report.dto'
import { ReportsService } from './reports.service'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { AuthGuard } from '../../common/guards/auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { TenantGuard } from '../../common/guards/tenant.guard'
import { type JwtPayload, UserRole } from '../../common/interfaces/authenticated-request.interface'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { ReportRecord, PaginatedReports, ReportStats } from './reports.types'

@Controller('reports')
@UseGuards(AuthGuard, TenantGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
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
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async getReportStats(@TenantId() tenantId: string): Promise<ReportStats> {
    return this.reportsService.getReportStats(tenantId)
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L2)
  async getReportById(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string
  ): Promise<ReportRecord> {
    return this.reportsService.getReportById(id, tenantId)
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  async createReport(
    @Body(new ZodValidationPipe(CreateReportSchema)) dto: CreateReportDto,
    @CurrentUser() user: JwtPayload
  ): Promise<ReportRecord> {
    return this.reportsService.createReport(dto, user)
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  async updateReport(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateReportSchema)) dto: UpdateReportDto,
    @CurrentUser() user: JwtPayload
  ): Promise<ReportRecord> {
    return this.reportsService.updateReport(id, dto, user)
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  async deleteReport(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<{ deleted: boolean }> {
    return this.reportsService.deleteReport(id, tenantId, user.email)
  }
}
