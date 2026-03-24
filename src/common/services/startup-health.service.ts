import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'
import { AppLogOutcome } from '../enums'
import { AppLoggerService } from './app-logger.service'
import {
  buildChecksMetadata,
  buildStartupSummaryLogContext,
  buildServiceCheckLogContext,
  buildServiceCheckMessage,
} from './startup-health.utilities'
import { PrismaService } from '../../prisma/prisma.service'
import type { ServiceCheck } from './startup-health.types'

@Injectable()
export class StartupHealthService implements OnModuleInit {
  private readonly logger = new Logger(StartupHealthService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly appLogger: AppLoggerService
  ) {}

  async onModuleInit(): Promise<void> {
    setTimeout(() => {
      void this.runStartupChecks()
    }, 2000)
  }

  private async runStartupChecks(): Promise<void> {
    this.logger.log('Running startup health checks...')

    const checks = await Promise.all([this.checkPostgres(), this.checkRedis()])
    const metadata = buildChecksMetadata(checks)

    this.logStartupSummary(checks, metadata)
    this.logIndividualChecks(checks)
  }

  private logStartupSummary(
    checks: ServiceCheck[],
    metadata: Record<string, unknown>
  ): void {
    const allHealthy = checks.every(c => c.status === 'up')

    if (allHealthy) {
      this.appLogger.info(
        'All services healthy on startup',
        buildStartupSummaryLogContext(AppLogOutcome.SUCCESS, metadata)
      )
      this.logger.log('Startup health checks passed: all services are UP')
    } else {
      const downNames = checks
        .filter(c => c.status === 'down')
        .map(s => s.name)
        .join(', ')
      this.appLogger.error(
        `Services DOWN on startup: ${downNames}`,
        buildStartupSummaryLogContext(AppLogOutcome.FAILURE, metadata)
      )
      this.logger.error(`Startup health checks FAILED: ${downNames} are DOWN`)
    }
  }

  private logIndividualChecks(checks: ServiceCheck[]): void {
    for (const check of checks) {
      const message = buildServiceCheckMessage(check)
      const outcome = check.status === 'up' ? AppLogOutcome.SUCCESS : AppLogOutcome.FAILURE
      const context = buildServiceCheckLogContext(check, outcome)

      if (check.status === 'up') {
        this.appLogger.info(message, context)
      } else {
        this.appLogger.error(message, context)
      }
    }
  }

  private async checkPostgres(): Promise<ServiceCheck> {
    const start = Date.now()
    try {
      await this.prisma.$queryRaw`SELECT 1`
      return { name: 'PostgreSQL', status: 'up', latencyMs: Date.now() - start }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return {
        name: 'PostgreSQL',
        status: 'down',
        latencyMs: Date.now() - start,
        error: errorMessage,
      }
    }
  }

  private async checkRedis(): Promise<ServiceCheck> {
    const start = Date.now()
    const redis = this.createRedisCheckClient()

    try {
      await redis.connect()
      await redis.ping()
      const latencyMs = Date.now() - start
      redis.disconnect()
      return { name: 'Redis', status: 'up', latencyMs }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      redis.disconnect()
      return { name: 'Redis', status: 'down', latencyMs: Date.now() - start, error: errorMessage }
    }
  }

  private createRedisCheckClient(): Redis {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost')
    const port = this.configService.get<number>('REDIS_PORT', 6379)
    const password = this.configService.get<string>('REDIS_PASSWORD', '')

    const redis = new Redis({
      host,
      port,
      password: password || undefined,
      connectTimeout: 5000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      lazyConnect: true,
    })

    // Suppress connection errors during check
    redis.on('error', () => {})

    return redis
  }
}
