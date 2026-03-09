import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

const TOKEN_BLACKLIST_PREFIX = 'token:blacklist:'

@Injectable()
export class TokenBlacklistService implements OnModuleDestroy {
  private readonly logger = new Logger(TokenBlacklistService.name)
  private readonly redis: Redis

  constructor(private readonly configService: ConfigService) {
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
    } catch (error) {
      this.logger.warn(
        `Failed to blacklist token ${jti}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Check whether a token JTI has been blacklisted (revoked).
   */
  async isBlacklisted(jti: string): Promise<boolean> {
    try {
      const key = `${TOKEN_BLACKLIST_PREFIX}${jti}`
      const result = await this.redis.exists(key)
      return result === 1
    } catch (error) {
      this.logger.warn(
        `Failed to check blacklist for ${jti}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
      // Fail-open: if Redis is down, allow the token through
      // to avoid locking out all users. Log the warning above.
      return false
    }
  }

  onModuleDestroy(): void {
    this.redis.disconnect()
  }
}
