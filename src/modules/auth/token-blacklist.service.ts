import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../common/enums'
import { AppLoggerService } from '../../common/services/app-logger.service'

const TOKEN_BLACKLIST_PREFIX = 'token:blacklist:'

@Injectable()
export class TokenBlacklistService implements OnModuleDestroy {
  private readonly logger = new Logger(TokenBlacklistService.name)
  private readonly redis: Redis

  constructor(
    private readonly configService: ConfigService,
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

    this.redis.on('error', (error: Error) => {
      this.logger.warn(`Redis connection error in TokenBlacklistService: ${error.message}`)
    })
  }

  /**
   * Add a token JTI to the blacklist with a TTL matching the token's remaining lifetime.
   */
  async blacklist(jti: string, expSeconds: number): Promise<void> {
    try {
      const key = `${TOKEN_BLACKLIST_PREFIX}${jti}`
      const ttl = Math.max(expSeconds, 1)
      await this.redis.set(key, '1', 'EX', ttl)

      this.appLogger.info('Token blacklisted successfully', {
        feature: AppLogFeature.AUTH,
        action: 'blacklist',
        outcome: AppLogOutcome.SUCCESS,
        sourceType: AppLogSourceType.SERVICE,
        className: 'TokenBlacklistService',
        functionName: 'blacklist',
        metadata: { ttlSeconds: ttl },
      })
    } catch (error) {
      this.logger.warn(
        `Failed to blacklist token ${jti}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )

      this.appLogger.error('Failed to blacklist token', {
        feature: AppLogFeature.AUTH,
        action: 'blacklist',
        outcome: AppLogOutcome.FAILURE,
        sourceType: AppLogSourceType.SERVICE,
        className: 'TokenBlacklistService',
        functionName: 'blacklist',
        stackTrace: error instanceof Error ? error.stack : undefined,
      })
    }
  }

  /**
   * Check whether a token JTI has been blacklisted (revoked).
   *
   * **Security trade-off (fail-open):** When Redis is unavailable, this method
   * returns `false` (not blacklisted) rather than `true`. This is an intentional
   * availability-over-security decision: failing closed would lock out ALL
   * authenticated users during a Redis outage, including admins who need access
   * to diagnose and resolve the issue. The risk is that previously revoked tokens
   * could be used during the Redis downtime window, which is bounded by the
   * token's short TTL (15 min for access tokens). Monitor Redis health via
   * `isRedisHealthy()` and alert on failures to minimize this window.
   */
  async isBlacklisted(jti: string): Promise<boolean> {
    try {
      const key = `${TOKEN_BLACKLIST_PREFIX}${jti}`
      const result = await this.redis.exists(key)
      const blacklisted = result === 1

      if (blacklisted) {
        this.appLogger.warn('Blacklisted token usage attempt detected', {
          feature: AppLogFeature.AUTH,
          action: 'isBlacklisted',
          outcome: AppLogOutcome.DENIED,
          sourceType: AppLogSourceType.SERVICE,
          className: 'TokenBlacklistService',
          functionName: 'isBlacklisted',
        })
      }

      return blacklisted
    } catch (error) {
      this.logger.warn(
        `Failed to check blacklist for ${jti}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )

      this.appLogger.error('Failed to check token blacklist (fail-open)', {
        feature: AppLogFeature.AUTH,
        action: 'isBlacklisted',
        className: 'TokenBlacklistService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
      })

      // Fail-open: see JSDoc above for rationale.
      return false
    }
  }

  /**
   * Check whether the Redis connection used for token blacklisting is healthy.
   * Intended for use by health check services to monitor and alert on Redis
   * availability, since the blacklist fails open when Redis is down.
   */
  async isRedisHealthy(): Promise<boolean> {
    try {
      const result = await this.redis.ping()
      return result === 'PONG'
    } catch {
      this.appLogger.warn('Token blacklist Redis connection is unhealthy', {
        feature: AppLogFeature.AUTH,
        action: 'isRedisHealthy',
        outcome: AppLogOutcome.FAILURE,
        sourceType: AppLogSourceType.SERVICE,
        className: 'TokenBlacklistService',
        functionName: 'isRedisHealthy',
      })
      return false
    }
  }

  onModuleDestroy(): void {
    this.redis.disconnect()
  }
}
