import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { CasesService } from './cases.service'
import { type CreateArtifactDto, CreateArtifactSchema } from './dto/create-artifact.dto'
import { type CreateCaseDto, CreateCaseSchema } from './dto/create-case.dto'
import { type CreateCommentDto, CreateCommentSchema } from './dto/create-comment.dto'
import { type CreateNoteDto, CreateNoteSchema } from './dto/create-note.dto'
import { type CreateTaskDto, CreateTaskSchema } from './dto/create-task.dto'
import { type LinkAlertDto, LinkAlertSchema } from './dto/link-alert.dto'
import { ListCasesQuerySchema } from './dto/list-cases-query.dto'
import { ListCommentsQuerySchema } from './dto/list-comments-query.dto'
import { ListNotesQuerySchema } from './dto/list-notes-query.dto'
import { SearchMentionableUsersQuerySchema } from './dto/search-mentionable-users-query.dto'
import { type UpdateCaseDto, UpdateCaseSchema } from './dto/update-case.dto'
import { type UpdateCommentDto, UpdateCommentSchema } from './dto/update-comment.dto'
import { type UpdateTaskDto, UpdateTaskSchema } from './dto/update-task.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { AuthGuard } from '../../common/guards/auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { TenantGuard } from '../../common/guards/tenant.guard'
import { type JwtPayload, UserRole } from '../../common/interfaces/authenticated-request.interface'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type {
  CaseCommentResponse,
  CaseRecord,
  CaseStats,
  MentionableUser,
  PaginatedCaseComments,
  PaginatedCaseNotes,
  PaginatedCases,
} from './cases.types'
import type { CaseNote } from '@prisma/client'

@Controller('cases')
@UseGuards(AuthGuard, TenantGuard)
export class CasesController {
  constructor(private readonly casesService: CasesService) {}

  @Get()
  async listCases(
    @TenantId() tenantId: string,
    @Query() rawQuery: Record<string, string>
  ): Promise<PaginatedCases> {
    const { page, limit, sortBy, sortOrder, status, severity, query, cycleId, ownerUserId } =
      ListCasesQuerySchema.parse(rawQuery)
    return this.casesService.listCases(
      tenantId,
      page,
      limit,
      sortBy,
      sortOrder,
      status,
      severity,
      query,
      cycleId,
      ownerUserId
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

  @Get('stats')
  async getCaseStats(@TenantId() tenantId: string): Promise<CaseStats> {
    return this.casesService.getCaseStats(tenantId)
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
  async getCaseNotes(
    @Param('id') id: string,
    @TenantId() tenantId: string,
    @Query() rawQuery: Record<string, string>
  ): Promise<PaginatedCaseNotes> {
    const { page, limit } = ListNotesQuerySchema.parse(rawQuery)
    return this.casesService.getCaseNotes(id, tenantId, page, limit)
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

  /* ---------------------------------------------------------------- */
  /* COMMENTS                                                           */
  /* ---------------------------------------------------------------- */

  @Get(':id/comments/mentionable-users')
  async searchMentionableUsers(
    @Param('id') _id: string,
    @TenantId() tenantId: string,
    @Query() rawQuery: Record<string, string>
  ): Promise<{ data: MentionableUser[] }> {
    const { query, limit } = SearchMentionableUsersQuerySchema.parse(rawQuery)
    const users = await this.casesService.searchMentionableUsers(tenantId, query, limit)
    return { data: users }
  }

  @Get(':id/comments')
  async listCaseComments(
    @Param('id') id: string,
    @TenantId() tenantId: string,
    @Query() rawQuery: Record<string, string>
  ): Promise<PaginatedCaseComments> {
    const { page, limit } = ListCommentsQuerySchema.parse(rawQuery)
    return this.casesService.listCaseComments(id, tenantId, page, limit)
  }

  @Post(':id/comments')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L1)
  async addCaseComment(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateCommentSchema)) dto: CreateCommentDto,
    @CurrentUser() user: JwtPayload
  ): Promise<{ data: CaseCommentResponse }> {
    const comment = await this.casesService.addCaseComment(id, dto, user)
    return { data: comment }
  }

  @Patch(':id/comments/:commentId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L1)
  async updateCaseComment(
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @Body(new ZodValidationPipe(UpdateCommentSchema)) dto: UpdateCommentDto,
    @CurrentUser() user: JwtPayload
  ): Promise<{ data: CaseCommentResponse }> {
    const comment = await this.casesService.updateCaseComment(id, commentId, dto, user)
    return { data: comment }
  }

  @Delete(':id/comments/:commentId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L1)
  async deleteCaseComment(
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<{ deleted: boolean }> {
    return this.casesService.deleteCaseComment(id, commentId, user)
  }

  /* ---------------------------------------------------------------- */
  /* TASKS                                                              */
  /* ---------------------------------------------------------------- */

  @Post(':id/tasks')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L1)
  async createTask(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateTaskSchema)) dto: CreateTaskDto,
    @CurrentUser() user: JwtPayload
  ) {
    const task = await this.casesService.createTask(id, dto, user)
    return { data: task }
  }

  @Patch(':id/tasks/:taskId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L1)
  async updateTask(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Body(new ZodValidationPipe(UpdateTaskSchema)) dto: UpdateTaskDto,
    @CurrentUser() user: JwtPayload
  ) {
    const task = await this.casesService.updateTask(id, taskId, dto, user)
    return { data: task }
  }

  @Delete(':id/tasks/:taskId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L1)
  async deleteTask(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @CurrentUser() user: JwtPayload
  ) {
    return this.casesService.deleteTask(id, taskId, user)
  }

  /* ---------------------------------------------------------------- */
  /* ARTIFACTS                                                          */
  /* ---------------------------------------------------------------- */

  @Post(':id/artifacts')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L1)
  async createArtifact(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateArtifactSchema)) dto: CreateArtifactDto,
    @CurrentUser() user: JwtPayload
  ) {
    const artifact = await this.casesService.createArtifact(id, dto, user)
    return { data: artifact }
  }

  @Delete(':id/artifacts/:artifactId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SOC_ANALYST_L1)
  async deleteArtifact(
    @Param('id') id: string,
    @Param('artifactId') artifactId: string,
    @CurrentUser() user: JwtPayload
  ) {
    return this.casesService.deleteArtifact(id, artifactId, user)
  }
}
