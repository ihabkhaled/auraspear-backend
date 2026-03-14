import { Controller, Get, Patch, Param, Query } from '@nestjs/common'
import { ListNotificationsQuerySchema } from './dto/list-notifications-query.dto'
import { NotificationsService } from './notifications.service'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { UserRole } from '../../common/interfaces/authenticated-request.interface'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { ListNotificationsQueryDto } from './dto/list-notifications-query.dto'
import type { PaginatedNotifications } from './notifications.types'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @Roles(UserRole.SOC_ANALYST_L1)
  async listNotifications(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(ListNotificationsQuerySchema)) query: ListNotificationsQueryDto
  ): Promise<PaginatedNotifications> {
    return this.notificationsService.listNotifications(tenantId, user.sub, query.page, query.limit)
  }

  @Get('unread-count')
  @Roles(UserRole.SOC_ANALYST_L1)
  async getUnreadCount(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<{ count: number }> {
    const count = await this.notificationsService.getUnreadCount(tenantId, user.sub)
    return { count }
  }

  @Patch('read-all')
  @Roles(UserRole.SOC_ANALYST_L1)
  async markAllAsRead(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<{ success: boolean }> {
    await this.notificationsService.markAllAsRead(tenantId, user.sub)
    return { success: true }
  }

  @Patch(':id/read')
  @Roles(UserRole.SOC_ANALYST_L1)
  async markAsRead(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload
  ): Promise<{ success: boolean }> {
    await this.notificationsService.markAsRead(id, user)
    return { success: true }
  }
}
