import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'
import { AppLogFeature, AppLogOutcome, AppLogSourceType, HealthStatus } from '../../common/enums'
import { AppLoggerService } from '../../common/services/app-logger.service'
import { PrismaService } from '../../prisma/prisma.service'
import { ConnectorsService } from '../connectors/connectors.service'
import type { ServiceHealthResult, OverallHealth, ComponentCheck } from './health.types'

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name)
  private readonly redis: Redis

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly connectorsService: ConnectorsService,
    private readonly appLogger: AppLoggerService
  ) {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost')
    const port = this.configService.get<number>('REDIS_PORT', 6379)
    const password = this.configService.get<string>('REDIS_PASSWORD', '')

    this.redis = new Redis({
      host,
      port,
      password: password || undefined,
      connectTimeout: 5000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    })

    this.redis.on('error', () => {
      // Suppress connection errors — checked in health check
    })
  }

  /**
   * GET /health
   * Overall system health -- checks database and Redis connectivity.
   * This endpoint is public (no auth required).
   */
  async getOverallHealth(): Promise<OverallHealth> {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()])

    let status: HealthStatus = HealthStatus.HEALTHY
    if (database.status === HealthStatus.DOWN && redis.status === HealthStatus.DOWN) {
      status = HealthStatus.DOWN
    } else if (database.status === HealthStatus.DOWN || redis.status === HealthStatus.DOWN) {
      status = HealthStatus.DEGRADED
    }

    this.appLogger.debug('Overall health check completed', {
      feature: AppLogFeature.SYSTEM,
      action: 'getOverallHealth',
      outcome: status === HealthStatus.HEALTHY ? AppLogOutcome.SUCCESS : AppLogOutcome.WARNING,
      sourceType: AppLogSourceType.SERVICE,
      className: 'HealthService',
      functionName: 'getOverallHealth',
      metadata: {
        status,
        databaseStatus: database.status,
        databaseLatencyMs: database.latencyMs,
        redisStatus: redis.status,
        redisLatencyMs: redis.latencyMs,
      },
    })

    return {
      status,
      timestamp: new Date().toISOString(),
      checks: { database, redis },
    }
  }

  /**
   * GET /health/services
   * Iterates tenant's enabled connectors and pings each one via ConnectorsService.
   */
  async getAllServiceHealth(tenantId: string): Promise<ServiceHealthResult[]> {
    const connectors = await this.connectorsService.getEnabledConnectors(tenantId)

    const results = await Promise.all(
      connectors.map(async (connector): Promise<ServiceHealthResult> => {
        try {
          const test = await this.connectorsService.testConnection(tenantId, connector.type)

          let status: HealthStatus = HealthStatus.DOWN
          if (test.ok) {
            status = test.latencyMs > 3000 ? HealthStatus.DEGRADED : HealthStatus.HEALTHY
          }

          return {
            name: connector.name,
            type: connector.type,
            status,
            latencyMs: test.latencyMs,
          }
        } catch (error) {
          this.logger.error(
            `Health check failed for connector ${connector.type}: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`
          )
          return {
            name: connector.name,
            type: connector.type,
            status: HealthStatus.DOWN,
            latencyMs: -1,
          }
        }
      })
    )

    const unhealthyCount = results.filter(r => r.status !== HealthStatus.HEALTHY).length

    this.appLogger.debug('Service health check completed for all connectors', {
      feature: AppLogFeature.SYSTEM,
      action: 'getAllServiceHealth',
      outcome: unhealthyCount === 0 ? AppLogOutcome.SUCCESS : AppLogOutcome.WARNING,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'HealthService',
      functionName: 'getAllServiceHealth',
      metadata: {
        totalConnectors: connectors.length,
        unhealthyCount,
      },
    })

    return results
  }

  /**
   * Ping the database with a simple SELECT 1 query.
   */
  private async checkDatabase(): Promise<ComponentCheck> {
    const start = Date.now()
    try {
      await this.prisma.$queryRaw`SELECT 1`
      return { status: HealthStatus.HEALTHY, latencyMs: Date.now() - start }
    } catch (error) {
      this.logger.error(
        `Database health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
      return { status: HealthStatus.DOWN, latencyMs: Date.now() - start }
    }
  }

  /**
   * Ping Redis to verify connectivity using the shared connection.
   */
  private async checkRedis(): Promise<ComponentCheck> {
    const start = Date.now()
    try {
      await this.redis.ping()
      return { status: HealthStatus.HEALTHY, latencyMs: Date.now() - start }
    } catch (error) {
      this.logger.error(
        `Redis health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
      return { status: HealthStatus.DOWN, latencyMs: Date.now() - start }
    }
  }
}
