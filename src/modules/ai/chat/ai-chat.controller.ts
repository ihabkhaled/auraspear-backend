import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { AiChatService } from './ai-chat.service'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import { RequirePermission } from '../../../common/decorators/permission.decorator'
import { TenantId } from '../../../common/decorators/tenant-id.decorator'
import { Permission } from '../../../common/enums'
import { AuthGuard } from '../../../common/guards/auth.guard'
import { TenantGuard } from '../../../common/guards/tenant.guard'
import type { JwtPayload } from '../../../common/interfaces/authenticated-request.interface'
import type { PaginatedResponse } from '../../../common/interfaces/pagination.interface'
import type { AiChatMessage, AiChatThread } from '@prisma/client'

@Controller('ai-chat')
@UseGuards(AuthGuard, TenantGuard)
@Throttle({ default: { limit: 30, ttl: 60000 } })
export class AiChatController {
  constructor(private readonly chatService: AiChatService) {}

  /** GET /ai-chat/threads — List user's chat threads */
  @Get('threads')
  @RequirePermission(Permission.AI_AGENTS_VIEW)
  async listThreads(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Query('page') rawPage?: string,
    @Query('limit') rawLimit?: string
  ): Promise<PaginatedResponse<AiChatThread>> {
    const page = Math.max(1, Number.parseInt(rawPage ?? '1', 10) || 1)
    const limit = Math.min(50, Math.max(1, Number.parseInt(rawLimit ?? '20', 10) || 20))
    return this.chatService.listThreads(tenantId, user.sub, page, limit)
  }

  /** POST /ai-chat/threads — Create a new chat thread */
  @Post('threads')
  @RequirePermission(Permission.AI_AGENTS_EXECUTE)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async createThread(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { connectorId?: string; model?: string; systemPrompt?: string }
  ): Promise<AiChatThread> {
    return this.chatService.createThread(tenantId, user.sub, body)
  }

  /** GET /ai-chat/threads/:id/messages — Get paginated messages for a thread */
  @Get('threads/:id/messages')
  @RequirePermission(Permission.AI_AGENTS_VIEW)
  async getMessages(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) threadId: string,
    @Query('page') rawPage?: string,
    @Query('limit') rawLimit?: string
  ): Promise<PaginatedResponse<AiChatMessage>> {
    const page = Math.max(1, Number.parseInt(rawPage ?? '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(rawLimit ?? '50', 10) || 50))
    return this.chatService.getMessages(tenantId, user.sub, threadId, page, limit)
  }

  /** POST /ai-chat/threads/:id/messages — Send a message and get AI response */
  @Post('threads/:id/messages')
  @RequirePermission(Permission.AI_AGENTS_EXECUTE)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async sendMessage(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) threadId: string,
    @Body('content') content: string
  ): Promise<AiChatMessage> {
    return this.chatService.sendMessage(tenantId, user.sub, threadId, content)
  }

  /** DELETE /ai-chat/threads/:id — Archive a chat thread */
  @Delete('threads/:id')
  @RequirePermission(Permission.AI_AGENTS_EXECUTE)
  async archiveThread(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) threadId: string
  ): Promise<void> {
    return this.chatService.archiveThread(tenantId, user.sub, threadId)
  }
}
