import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'
import {
  REFRESH_FAMILY_PREFIX,
  REFRESH_FAMILY_REVOKED_PREFIX,
  TOKEN_BLACKLIST_PREFIX,
} from './auth.constants'
import {
  buildBlacklistLogContext,
  extractErrorMessage,
  extractErrorStack,
} from './token-blacklist.utilities'
import { AppLogOutcome, RedisResponse } from '../../common/enums'
import { AppLoggerService } from '../../common/services/app-logger.service'

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

  async blacklist(jti: string, expSeconds: number): Promise<void> {
    try {
      const key = `${TOKEN_BLACKLIST_PREFIX}${jti}`
      const ttl = Math.max(expSeconds, 1)
      await this.redis.set(key, '1', 'EX', ttl)

      this.appLogger.info(
        'Token blacklisted successfully',
        buildBlacklistLogContext('blacklist', AppLogOutcome.SUCCESS, { ttlSeconds: ttl })
      )
    } catch (error) {
      this.logger.warn(`Failed to blacklist token ${jti}: ${extractErrorMessage(error)}`)
      this.appLogger.error(
        'Failed to blacklist token',
        buildBlacklistLogContext('blacklist', AppLogOutcome.FAILURE, undefined, extractErrorStack(error))
      )
    }
  }

  /**
   * Check whether a token JTI has been blacklisted (revoked).
   *
   * **Security trade-off (fail-open):** When Redis is unavailable, this method
   * returns `false` (not blacklisted) rather than `true`. This is an intentional
   * availability-over-security decision. See class-level docs for rationale.
   */
  async isBlacklisted(jti: string): Promise<boolean> {
    try {
      const key = `${TOKEN_BLACKLIST_PREFIX}${jti}`
      const result = await this.redis.exists(key)
      const blacklisted = result === 1

      if (blacklisted) {
        this.appLogger.warn(
          'Blacklisted token usage attempt detected',
          buildBlacklistLogContext('isBlacklisted', AppLogOutcome.DENIED)
        )
      }

      return blacklisted
    } catch (error) {
      this.logger.warn(`Failed to check blacklist for ${jti}: ${extractErrorMessage(error)}`)
      this.appLogger.error(
        'Failed to check token blacklist (fail-open)',
        buildBlacklistLogContext('isBlacklisted', AppLogOutcome.FAILURE, {
          error: extractErrorMessage(error),
        })
      )

      return false
    }
  }

  async isRedisHealthy(): Promise<boolean> {
    try {
      const result = await this.redis.ping()
      return result === RedisResponse.PONG
    } catch {
      this.appLogger.warn(
        'Token blacklist Redis connection is unhealthy',
        buildBlacklistLogContext('isRedisHealthy', AppLogOutcome.FAILURE)
      )
      return false
    }
  }

  /* ---------------------------------------------------------------- */
  /* REFRESH TOKEN FAMILY TRACKING                                     */
  /* ---------------------------------------------------------------- */

  async setFamilyGeneration(family: string, generation: number, ttlSeconds: number): Promise<void> {
    try {
      const key = `${REFRESH_FAMILY_PREFIX}${family}`
      const ttl = Math.max(ttlSeconds, 1)
      await this.redis.set(key, String(generation), 'EX', ttl)

      this.appLogger.info(
        'Refresh token family generation set',
        buildBlacklistLogContext('setFamilyGeneration', AppLogOutcome.SUCCESS, {
          family,
          generation,
          ttlSeconds: ttl,
        })
      )
    } catch (error) {
      this.logger.warn(
        `Failed to set family generation for ${family}: ${extractErrorMessage(error)}`
      )
      this.appLogger.error(
        'Failed to set refresh token family generation',
        buildBlacklistLogContext(
          'setFamilyGeneration',
          AppLogOutcome.FAILURE,
          undefined,
          extractErrorStack(error)
        )
      )
    }
  }

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
        `Failed to get family generation for ${family}: ${extractErrorMessage(error)}`
      )
      this.appLogger.error(
        'Failed to get refresh token family generation (fail-open)',
        buildBlacklistLogContext('getFamilyGeneration', AppLogOutcome.FAILURE, {
          error: extractErrorMessage(error),
        })
      )

      return null
    }
  }

  async invalidateFamily(family: string): Promise<void> {
    try {
      await this.performFamilyInvalidation(family)
      this.appLogger.warn(
        'Refresh token family invalidated (possible replay attack)',
        buildBlacklistLogContext('invalidateFamily', AppLogOutcome.DENIED, { family })
      )
    } catch (error) {
      this.logger.warn(`Failed to invalidate family ${family}: ${extractErrorMessage(error)}`)
      this.appLogger.error(
        'Failed to invalidate refresh token family',
        buildBlacklistLogContext(
          'invalidateFamily',
          AppLogOutcome.FAILURE,
          undefined,
          extractErrorStack(error)
        )
      )
    }
  }

  async isFamilyRevoked(family: string): Promise<boolean> {
    try {
      const key = `${REFRESH_FAMILY_REVOKED_PREFIX}${family}`
      const result = await this.redis.exists(key)
      return result === 1
    } catch (error) {
      this.logger.warn(
        `Failed to check family revocation for ${family}: ${extractErrorMessage(error)}`
      )

      return false
    }
  }

  async deleteFamilyKey(family: string): Promise<void> {
    try {
      const key = `${REFRESH_FAMILY_PREFIX}${family}`
      await this.redis.del(key)
    } catch (error) {
      this.logger.warn(
        `Failed to delete family key for ${family}: ${extractErrorMessage(error)}`
      )
    }
  }

  onModuleDestroy(): void {
    this.redis.disconnect()
  }

  private async performFamilyInvalidation(family: string): Promise<void> {
    const familyKey = `${REFRESH_FAMILY_PREFIX}${family}`
    const revokedKey = `${REFRESH_FAMILY_REVOKED_PREFIX}${family}`

    const remainingTtl = await this.redis.ttl(familyKey)
    await this.redis.del(familyKey)

    const ttl = Math.max(remainingTtl, 1)
    await this.redis.set(revokedKey, '1', 'EX', ttl)
  }
}
