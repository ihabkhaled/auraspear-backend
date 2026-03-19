import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'
import { AppLogFeature, AppLogOutcome, AppLogSourceType, RedisResponse } from '../../common/enums'
import { AppLoggerService } from '../../common/services/app-logger.service'

const TOKEN_BLACKLIST_PREFIX = 'token:blacklist:'
const REFRESH_FAMILY_PREFIX = 'rf:'
const REFRESH_FAMILY_REVOKED_PREFIX = 'rf:revoked:'

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
      return result === RedisResponse.PONG
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

  /* ---------------------------------------------------------------- */
  /* REFRESH TOKEN FAMILY TRACKING                                     */
  /* ---------------------------------------------------------------- */

  /**
   * Store the latest valid generation for a refresh token family.
   * Key: `rf:{family}` → generation number, with TTL matching refresh token expiry.
   */
  async setFamilyGeneration(family: string, generation: number, ttlSeconds: number): Promise<void> {
    try {
      const key = `${REFRESH_FAMILY_PREFIX}${family}`
      const ttl = Math.max(ttlSeconds, 1)
      await this.redis.set(key, String(generation), 'EX', ttl)

      this.appLogger.info('Refresh token family generation set', {
        feature: AppLogFeature.AUTH,
        action: 'setFamilyGeneration',
        outcome: AppLogOutcome.SUCCESS,
        sourceType: AppLogSourceType.SERVICE,
        className: 'TokenBlacklistService',
        functionName: 'setFamilyGeneration',
        metadata: { family, generation, ttlSeconds: ttl },
      })
    } catch (error) {
      this.logger.warn(
        `Failed to set family generation for ${family}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )

      this.appLogger.error('Failed to set refresh token family generation', {
        feature: AppLogFeature.AUTH,
        action: 'setFamilyGeneration',
        outcome: AppLogOutcome.FAILURE,
        sourceType: AppLogSourceType.SERVICE,
        className: 'TokenBlacklistService',
        functionName: 'setFamilyGeneration',
        stackTrace: error instanceof Error ? error.stack : undefined,
      })
    }
  }

  /**
   * Get the latest valid generation for a refresh token family.
   * Returns `null` if the family does not exist or Redis is unavailable.
   */
  async getFamilyGeneration(family: string): Promise<number | null> {
    try {
      const key = `${REFRESH_FAMILY_PREFIX}${family}`
      const result = await this.redis.get(key)
      if (result === null) {
        return null
      }
      return Number.parseInt(result, 10)
    } catch (error) {
      this.logger.warn(
        `Failed to get family generation for ${family}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )

      this.appLogger.error('Failed to get refresh token family generation (fail-open)', {
        feature: AppLogFeature.AUTH,
        action: 'getFamilyGeneration',
        outcome: AppLogOutcome.FAILURE,
        sourceType: AppLogSourceType.SERVICE,
        className: 'TokenBlacklistService',
        functionName: 'getFamilyGeneration',
        metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
      })

      return null
    }
  }

  /**
   * Invalidate an entire refresh token family by deleting the generation key
   * and marking the family as revoked (so any token from this family is rejected).
   */
  async invalidateFamily(family: string): Promise<void> {
    try {
      const familyKey = `${REFRESH_FAMILY_PREFIX}${family}`
      const revokedKey = `${REFRESH_FAMILY_REVOKED_PREFIX}${family}`

      // Get the TTL of the family key before deleting, so the revoked marker has the same TTL
      const remainingTtl = await this.redis.ttl(familyKey)
      await this.redis.del(familyKey)

      // Set a revoked marker so any token from this family is rejected even after the generation key is gone
      const ttl = Math.max(remainingTtl, 1)
      await this.redis.set(revokedKey, '1', 'EX', ttl)

      this.appLogger.warn('Refresh token family invalidated (possible replay attack)', {
        feature: AppLogFeature.AUTH,
        action: 'invalidateFamily',
        outcome: AppLogOutcome.DENIED,
        sourceType: AppLogSourceType.SERVICE,
        className: 'TokenBlacklistService',
        functionName: 'invalidateFamily',
        metadata: { family },
      })
    } catch (error) {
      this.logger.warn(
        `Failed to invalidate family ${family}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )

      this.appLogger.error('Failed to invalidate refresh token family', {
        feature: AppLogFeature.AUTH,
        action: 'invalidateFamily',
        outcome: AppLogOutcome.FAILURE,
        sourceType: AppLogSourceType.SERVICE,
        className: 'TokenBlacklistService',
        functionName: 'invalidateFamily',
        stackTrace: error instanceof Error ? error.stack : undefined,
      })
    }
  }

  /**
   * Check whether a refresh token family has been revoked.
   */
  async isFamilyRevoked(family: string): Promise<boolean> {
    try {
      const key = `${REFRESH_FAMILY_REVOKED_PREFIX}${family}`
      const result = await this.redis.exists(key)
      return result === 1
    } catch (error) {
      this.logger.warn(
        `Failed to check family revocation for ${family}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )

      // Fail-open: same rationale as isBlacklisted
      return false
    }
  }

  /**
   * Delete the refresh token family key (used on logout).
   */
  async deleteFamilyKey(family: string): Promise<void> {
    try {
      const key = `${REFRESH_FAMILY_PREFIX}${family}`
      await this.redis.del(key)
    } catch (error) {
      this.logger.warn(
        `Failed to delete family key for ${family}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  onModuleDestroy(): void {
    this.redis.disconnect()
  }
}
