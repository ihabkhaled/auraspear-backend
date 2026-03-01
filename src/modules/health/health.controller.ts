import { Controller, Get, UseGuards } from '@nestjs/common'
import { HealthService } from './health.service'
import { Public } from '../../common/decorators/public.decorator'
import { AuthGuard } from '../../common/guards/auth.guard'
import { TenantGuard } from '../../common/guards/tenant.guard'

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * GET /health
   * Overall system health status. Public endpoint -- no auth required.
   */
  @Get()
  @Public()
  async getOverallHealth() {
    return this.healthService.getOverallHealth()
  }

  /**
   * GET /health/wazuh
   * Wazuh Manager health check. Requires authentication.
   */
  @Get('wazuh')
  @UseGuards(AuthGuard, TenantGuard)
  async getWazuhHealth() {
    return this.healthService.checkWazuh()
  }

  /**
   * GET /health/indexer
   * OpenSearch / Wazuh Indexer health check. Requires authentication.
   */
  @Get('indexer')
  @UseGuards(AuthGuard, TenantGuard)
  async getIndexerHealth() {
    return this.healthService.checkIndexer()
  }

  /**
   * GET /health/logstash
   * Logstash health check. Requires authentication.
   */
  @Get('logstash')
  @UseGuards(AuthGuard, TenantGuard)
  async getLogstashHealth() {
    return this.healthService.checkLogstash()
  }

  /**
   * GET /health/misp
   * MISP threat intelligence platform health check. Requires authentication.
   */
  @Get('misp')
  @UseGuards(AuthGuard, TenantGuard)
  async getMispHealth() {
    return this.healthService.checkMisp()
  }
}
