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
import { UserMemoryService } from './user-memory.service'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import { RequirePermission } from '../../../common/decorators/permission.decorator'
import { TenantId } from '../../../common/decorators/tenant-id.decorator'
import { Permission } from '../../../common/enums'
import { AuthGuard } from '../../../common/guards/auth.guard'
import { TenantGuard } from '../../../common/guards/tenant.guard'
import type { UserMemoryRecord } from './memory.types'
import type { JwtPayload } from '../../../common/interfaces/authenticated-request.interface'

@Controller('user-memory')
@UseGuards(AuthGuard, TenantGuard)
@Throttle({ default: { limit: 60, ttl: 60000 } })
export class UserMemoryController {
  constructor(private readonly memoryService: UserMemoryService) {}

  @Get()
  @RequirePermission(Permission.AI_MEMORY_VIEW)
  async listMemories(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('limit') rawLimit?: string,
    @Query('offset') rawOffset?: string
  ): Promise<{ data: UserMemoryRecord[]; total: number }> {
    const limit = Math.min(100, Math.max(1, Number.parseInt(rawLimit ?? '50', 10) || 50))
    const offset = Math.max(0, Number.parseInt(rawOffset ?? '0', 10) || 0)
    return this.memoryService.listMemories(tenantId, user.sub, { category, search, limit, offset })
  }

  @Post()
  @RequirePermission(Permission.AI_MEMORY_EDIT)
  async createMemory(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { content: string; category?: string }
  ): Promise<UserMemoryRecord> {
    return this.memoryService.createMemory(tenantId, user.sub, body)
  }

  @Patch(':id')
  @RequirePermission(Permission.AI_MEMORY_EDIT)
  async updateMemory(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) memoryId: string,
    @Body() body: { content: string; category?: string }
  ): Promise<UserMemoryRecord> {
    return this.memoryService.updateMemory(tenantId, user.sub, memoryId, body)
  }

  @Delete(':id')
  @RequirePermission(Permission.AI_MEMORY_EDIT)
  async deleteMemory(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) memoryId: string
  ): Promise<void> {
    return this.memoryService.deleteMemory(tenantId, user.sub, memoryId)
  }

  @Delete()
  @RequirePermission(Permission.AI_MEMORY_EDIT)
  async deleteAllMemories(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<{ deleted: number }> {
    const count = await this.memoryService.deleteAllMemories(tenantId, user.sub)
    return { deleted: count }
  }
}
