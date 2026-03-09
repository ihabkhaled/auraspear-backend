import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { CasesService } from './cases.service'
import { type CreateCaseDto, CreateCaseSchema } from './dto/create-case.dto'
import { type CreateNoteDto, CreateNoteSchema } from './dto/create-note.dto'
import { type LinkAlertDto, LinkAlertSchema } from './dto/link-alert.dto'
import { type UpdateCaseDto, UpdateCaseSchema } from './dto/update-case.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { AuthGuard } from '../../common/guards/auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { TenantGuard } from '../../common/guards/tenant.guard'
import { type JwtPayload, UserRole } from '../../common/interfaces/authenticated-request.interface'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { CaseRecord, PaginatedCases } from './cases.types'
import type { CaseNote } from '@prisma/client'

@Controller('cases')
@UseGuards(AuthGuard, TenantGuard)
export class CasesController {
  constructor(private readonly casesService: CasesService) {}

  @Get()
  async listCases(
    @TenantId() tenantId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
    @Query('status') status?: string,
    @Query('severity') severity?: string,
    @Query('query') query?: string
  ): Promise<PaginatedCases> {
    return this.casesService.listCases(
      tenantId,
      Math.max(1, page ? Number.parseInt(page, 10) : 1),
      Math.min(100, Math.max(1, limit ? Number.parseInt(limit, 10) : 20)),
      sortBy,
      sortOrder,
      status,
      severity,
      query
    )
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L1)
  async createCase(
    @Body(new ZodValidationPipe(CreateCaseSchema)) dto: CreateCaseDto,
    @CurrentUser() user: JwtPayload
  ): Promise<CaseRecord> {
    return this.casesService.createCase(dto, user)
  }

  @Get(':id')
  async getCaseById(@Param('id') id: string, @TenantId() tenantId: string): Promise<CaseRecord> {
    return this.casesService.getCaseById(id, tenantId)
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L1)
  async updateCase(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCaseSchema)) dto: UpdateCaseDto,
    @CurrentUser() user: JwtPayload
  ): Promise<CaseRecord> {
    return this.casesService.updateCase(id, dto, user)
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  async deleteCase(
    @Param('id') id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<{ deleted: boolean }> {
    return this.casesService.deleteCase(id, tenantId, user.email)
  }

  @Post(':id/link-alert')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L1)
  async linkAlert(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(LinkAlertSchema)) dto: LinkAlertDto,
    @CurrentUser() user: JwtPayload
  ): Promise<CaseRecord> {
    return this.casesService.linkAlert(id, dto, user)
  }

  @Get(':id/notes')
  async getCaseNotes(@Param('id') id: string, @TenantId() tenantId: string): Promise<CaseNote[]> {
    return this.casesService.getCaseNotes(id, tenantId)
  }

  @Post(':id/notes')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L1)
  async addCaseNote(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateNoteSchema)) dto: CreateNoteDto,
    @CurrentUser() user: JwtPayload
  ): Promise<CaseNote> {
    return this.casesService.addCaseNote(id, dto, user)
  }
}
