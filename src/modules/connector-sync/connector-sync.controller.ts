import { Controller, Post, Param, Get } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { ConnectorSyncService } from './connector-sync.service'
import { Roles } from '../../common/decorators/roles.decorator'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { UserRole } from '../../common/interfaces/authenticated-request.interface'
import { PrismaService } from '../../prisma/prisma.service'

@ApiTags('connector-sync')
@ApiBearerAuth()
@Controller('connector-sync')
@Throttle({ default: { limit: 30, ttl: 60000 } })
export class ConnectorSyncController {
  constructor(
    private readonly syncService: ConnectorSyncService,
    private readonly prisma: PrismaService
  ) {}

  /** Manually trigger a sync for a specific connector type. */
  @Post(':type/sync')
  @Roles(UserRole.TENANT_ADMIN)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async triggerSync(
    @TenantId() tenantId: string,
    @Param('type') type: string
  ): Promise<{ success: boolean; message: string; ingested?: number }> {
    return this.syncService.syncConnector(tenantId, type)
  }

  /** Get sync status for all connectors of the current tenant. */
  @Get('status')
  @Roles(UserRole.SOC_ANALYST_L1)
  async getSyncStatus(@TenantId() tenantId: string): Promise<
    Array<{
      type: string
      lastSyncAt: string | null
      syncEnabled: boolean
      enabled: boolean
    }>
  > {
    const connectors = await this.prisma.connectorConfig.findMany({
      where: { tenantId },
      select: {
        type: true,
        lastSyncAt: true,
        syncEnabled: true,
        enabled: true,
      },
      orderBy: { type: 'asc' },
    })

    return connectors.map(c => ({
      type: c.type,
      lastSyncAt: c.lastSyncAt ? c.lastSyncAt.toISOString() : null,
      syncEnabled: c.syncEnabled,
      enabled: c.enabled,
    }))
  }
}
