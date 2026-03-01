import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { CasesService } from './cases.service';
import { CreateCaseDto, CreateCaseSchema } from './dto/create-case.dto';
import { UpdateCaseDto, UpdateCaseSchema } from './dto/update-case.dto';
import { LinkAlertDto, LinkAlertSchema } from './dto/link-alert.dto';
import { CreateNoteDto, CreateNoteSchema } from './dto/create-note.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtPayload, UserRole } from '../../common/interfaces/authenticated-request.interface';

@Controller('cases')
@UseGuards(AuthGuard, TenantGuard)
export class CasesController {
  constructor(private readonly casesService: CasesService) {}

  /**
   * GET /cases
   * List cases for the current tenant (paginated).
   */
  @Get()
  async listCases(
    @TenantId() tenantId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.casesService.listCases(
      tenantId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  /**
   * POST /cases
   * Create a new case. Requires SOC_ANALYST_L1 or above.
   */
  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L1)
  @UsePipes(new ZodValidationPipe(CreateCaseSchema))
  async createCase(
    @Body() dto: CreateCaseDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.casesService.createCase(dto, user);
  }

  /**
   * GET /cases/:id
   * Get a single case by ID.
   */
  @Get(':id')
  async getCaseById(
    @Param('id') id: string,
    @TenantId() tenantId: string,
  ) {
    return this.casesService.getCaseById(id, tenantId);
  }

  /**
   * PATCH /cases/:id
   * Update an existing case. Requires SOC_ANALYST_L1 or above.
   */
  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L1)
  @UsePipes(new ZodValidationPipe(UpdateCaseSchema))
  async updateCase(
    @Param('id') id: string,
    @Body() dto: UpdateCaseDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.casesService.updateCase(id, dto, user);
  }

  /**
   * DELETE /cases/:id
   * Delete a case. Requires TENANT_ADMIN or above.
   */
  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.TENANT_ADMIN)
  async deleteCase(
    @Param('id') id: string,
    @TenantId() tenantId: string,
  ) {
    return this.casesService.deleteCase(id, tenantId);
  }

  /**
   * POST /cases/:id/link-alert
   * Link an alert to a case.
   */
  @Post(':id/link-alert')
  @UsePipes(new ZodValidationPipe(LinkAlertSchema))
  async linkAlert(
    @Param('id') id: string,
    @Body() dto: LinkAlertDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.casesService.linkAlert(id, dto, user);
  }

  /**
   * GET /cases/:id/notes
   * Get all notes for a case.
   */
  @Get(':id/notes')
  async getCaseNotes(
    @Param('id') id: string,
    @TenantId() tenantId: string,
  ) {
    return this.casesService.getCaseNotes(id, tenantId);
  }

  /**
   * POST /cases/:id/notes
   * Add a note to a case.
   */
  @Post(':id/notes')
  @UsePipes(new ZodValidationPipe(CreateNoteSchema))
  async addCaseNote(
    @Param('id') id: string,
    @Body() dto: CreateNoteDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.casesService.addCaseNote(id, dto, user);
  }
}
