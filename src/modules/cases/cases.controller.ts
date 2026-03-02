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

@Controller('cases')
@UseGuards(AuthGuard, TenantGuard)
export class CasesController {
  constructor(private readonly casesService: CasesService) {}

  @Get()
  async listCases(
    @TenantId() tenantId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    return this.casesService.listCases(
      tenantId,
      page ? Number.parseInt(page, 10) : 1,
      limit ? Number.parseInt(limit, 10) : 20
    )
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L1)
  async createCase(
    @Body(new ZodValidationPipe(CreateCaseSchema)) dto: CreateCaseDto,
    @CurrentUser() user: JwtPayload
  ) {
    return this.casesService.createCase(dto, user)
  }

  @Get(':id')
  async getCaseById(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.casesService.getCaseById(id, tenantId)
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L1)
  async updateCase(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCaseSchema)) dto: UpdateCaseDto,
    @CurrentUser() user: JwtPayload
  ) {
    return this.casesService.updateCase(id, dto, user)
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  async deleteCase(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.casesService.deleteCase(id, tenantId)
  }

  @Post(':id/link-alert')
  async linkAlert(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(LinkAlertSchema)) dto: LinkAlertDto,
    @CurrentUser() user: JwtPayload
  ) {
    return this.casesService.linkAlert(id, dto, user)
  }

  @Get(':id/notes')
  async getCaseNotes(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.casesService.getCaseNotes(id, tenantId)
  }

  @Post(':id/notes')
  async addCaseNote(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateNoteSchema)) dto: CreateNoteDto,
    @CurrentUser() user: JwtPayload
  ) {
    return this.casesService.addCaseNote(id, dto, user)
  }
}
