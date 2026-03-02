import { Controller, Get, ServiceUnavailableException } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { HealthService } from './health.service'
import { Public } from '../../common/decorators/public.decorator'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import type { OverallHealth, ServiceHealthResult } from './health.types'

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * GET /health
   * Overall system health status (DB + Redis). Public endpoint -- no auth required.
   */
  @Get()
  @Public()
  async getOverallHealth(): Promise<OverallHealth> {
    const health = await this.healthService.getOverallHealth()

    if (health.status === 'down') {
      throw new ServiceUnavailableException({
        message: 'System is down',
        messageKey: 'errors.health.serviceUnavailable',
        ...health,
      })
    }

    return health
  }

  /**
   * GET /health/services
   * All connector health for the authenticated tenant.
   */
  @Get('services')
  async getServicesHealth(@TenantId() tenantId: string): Promise<ServiceHealthResult[]> {
    return this.healthService.getAllServiceHealth(tenantId)
  }
}
