import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../enums'
import { AppLoggerService } from './app-logger.service'
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
    // Delay slightly to ensure all modules are initialized
    setTimeout(() => {
      void this.runStartupChecks()
    }, 2000)
  }

  private async runStartupChecks(): Promise<void> {
    this.logger.log('Running startup health checks...')

    const checks = await Promise.all([this.checkPostgres(), this.checkRedis()])

    const allHealthy = checks.every(c => c.status === 'up')
    const downServices = checks.filter(c => c.status === 'down')

    const metadata: Record<string, unknown> = {}
    for (const check of checks) {
      metadata[check.name] = {
        status: check.status,
        latencyMs: check.latencyMs,
        error: check.error ?? null,
      }
    }

    if (allHealthy) {
      this.appLogger.info('All services healthy on startup', {
        feature: AppLogFeature.SYSTEM_HEALTH,
        action: 'startupCheck',
        outcome: AppLogOutcome.SUCCESS,
        sourceType: AppLogSourceType.SERVICE,
        className: 'StartupHealthService',
        functionName: 'runStartupChecks',
        metadata,
      })
      this.logger.log('Startup health checks passed: all services are UP')
    } else {
      const downNames = downServices.map(s => s.name).join(', ')
      this.appLogger.error(`Services DOWN on startup: ${downNames}`, {
        feature: AppLogFeature.SYSTEM_HEALTH,
        action: 'startupCheck',
        outcome: AppLogOutcome.FAILURE,
        sourceType: AppLogSourceType.SERVICE,
        className: 'StartupHealthService',
        functionName: 'runStartupChecks',
        metadata,
      })
      this.logger.error(`Startup health checks FAILED: ${downNames} are DOWN`)
    }

    // Log individual results
    for (const check of checks) {
      if (check.status === 'up') {
        this.appLogger.info(`${check.name}: UP (${String(check.latencyMs)}ms)`, {
          feature: AppLogFeature.SYSTEM_HEALTH,
          action: 'serviceCheck',
          outcome: AppLogOutcome.SUCCESS,
          sourceType: AppLogSourceType.SERVICE,
          className: 'StartupHealthService',
          functionName: 'runStartupChecks',
          metadata: { service: check.name, latencyMs: check.latencyMs },
        })
      } else {
        this.appLogger.error(`${check.name}: DOWN — ${check.error ?? 'Unknown error'}`, {
          feature: AppLogFeature.SYSTEM_HEALTH,
          action: 'serviceCheck',
          outcome: AppLogOutcome.FAILURE,
          sourceType: AppLogSourceType.SERVICE,
          className: 'StartupHealthService',
          functionName: 'runStartupChecks',
          metadata: {
            service: check.name,
            latencyMs: check.latencyMs,
            error: check.error,
          },
        })
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

    try {
      await redis.connect()
      await redis.ping()
      const latencyMs = Date.now() - start
      redis.disconnect()
      return { name: 'Redis', status: 'up', latencyMs }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      redis.disconnect()
      return {
        name: 'Redis',
        status: 'down',
        latencyMs: Date.now() - start,
        error: errorMessage,
      }
    }
  }
}
