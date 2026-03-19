import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../../prisma/prisma.service'
import type { Job } from '@prisma/client'

@Injectable()
export class ConnectorSyncHandler {
  private readonly logger = new Logger(ConnectorSyncHandler.name)

  constructor(private readonly prisma: PrismaService) {}

  async handle(job: Job): Promise<Record<string, unknown>> {
    const payload = job.payload as Record<string, unknown> | null
    const connectorId = payload?.['connectorId'] as string | undefined

    if (!connectorId) {
      throw new Error('connectorId is required in job payload')
    }

    const connector = await this.prisma.connectorConfig.findFirst({
      where: { id: connectorId, tenantId: job.tenantId },
    })

    if (!connector) {
      throw new Error(`Connector ${connectorId} not found for tenant ${job.tenantId}`)
    }

    this.logger.log(
      `Syncing connector ${connector.name} (${connector.type}) for tenant ${job.tenantId}`
    )

    // Actual sync logic would be connector-type-specific
    // For now, update the lastSyncedAt timestamp
    await this.prisma.connectorConfig.update({
      where: { id: connectorId },
      data: { lastSyncAt: new Date() },
    })

    return {
      connectorId,
      connectorType: connector.type,
      syncedAt: new Date().toISOString(),
    }
  }
}
