import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'
import { PrismaService } from '../../prisma/prisma.service'
import { ConnectorsService } from '../connectors/connectors.service'
import type { ServiceHealthResult, OverallHealth, ComponentCheck } from './health.types'

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly connectorsService: ConnectorsService
  ) {}

  /**
   * GET /health
   * Overall system health -- checks database and Redis connectivity.
   * This endpoint is public (no auth required).
   */
  async getOverallHealth(): Promise<OverallHealth> {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()])

    let status: 'healthy' | 'degraded' | 'down' = 'healthy'
    if (database.status === 'down' && redis.status === 'down') {
      status = 'down'
    } else if (database.status === 'down' || redis.status === 'down') {
      status = 'degraded'
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      version: '1.0.0',
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

          let status: 'healthy' | 'degraded' | 'down' = 'down'
          if (test.ok) {
            status = test.latencyMs > 3000 ? 'degraded' : 'healthy'
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
            status: 'down',
            latencyMs: -1,
          }
        }
      })
    )

    return results
  }

  /**
   * Ping the database with a simple SELECT 1 query.
   */
  private async checkDatabase(): Promise<ComponentCheck> {
    const start = Date.now()
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1')
      return { status: 'healthy', latencyMs: Date.now() - start }
    } catch (error) {
      this.logger.error(
        `Database health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
      return { status: 'down', latencyMs: Date.now() - start }
    }
  }

  /**
   * Ping Redis to verify connectivity.
   */
  private async checkRedis(): Promise<ComponentCheck> {
    const start = Date.now()
    const host = this.configService.get<string>('REDIS_HOST', 'localhost')
    const port = this.configService.get<number>('REDIS_PORT', 6379)
    const password = this.configService.get<string>('REDIS_PASSWORD', '')

    const redis = new Redis({
      host,
      port,
      password: password || undefined,
      connectTimeout: 5000,
      lazyConnect: true,
    })

    try {
      await redis.connect()
      await redis.ping()
      return { status: 'healthy', latencyMs: Date.now() - start }
    } catch (error) {
      this.logger.error(
        `Redis health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
      return { status: 'down', latencyMs: Date.now() - start }
    } finally {
      try {
        redis.disconnect()
      } catch {
        // ignore disconnect errors
      }
    }
  }
}
