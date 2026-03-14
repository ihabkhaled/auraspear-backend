const mockRedis = {
  set: jest.fn(),
  exists: jest.fn(),
  ping: jest.fn(),
  disconnect: jest.fn(),
  on: jest.fn(),
}

jest.mock('ioredis', () => jest.fn().mockImplementation(() => mockRedis))

import { TokenBlacklistService } from '../../src/modules/auth/token-blacklist.service'

const mockAppLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

const mockConfigService = {
  get: jest.fn((key: string, defaultValue?: unknown) => {
    const config: Record<string, unknown> = {
      REDIS_HOST: 'localhost',
      REDIS_PORT: 6379,
      REDIS_PASSWORD: '',
    }
    return config[key] ?? defaultValue
  }),
}

describe('TokenBlacklistService', () => {
  let service: TokenBlacklistService

  beforeEach(() => {
    jest.clearAllMocks()
    service = new TokenBlacklistService(mockConfigService as never, mockAppLogger as never)
  })

  /* ------------------------------------------------------------------ */
  /* blacklist                                                           */
  /* ------------------------------------------------------------------ */

  describe('blacklist', () => {
    it('should set key in Redis with correct TTL', async () => {
      mockRedis.set.mockResolvedValue('OK')

      await service.blacklist('jti-001', 900)

      expect(mockRedis.set).toHaveBeenCalledWith('token:blacklist:jti-001', '1', 'EX', 900)
      expect(mockAppLogger.info).toHaveBeenCalledWith(
        'Token blacklisted successfully',
        expect.objectContaining({
          action: 'blacklist',
          metadata: { ttlSeconds: 900 },
        })
      )
    })

    it('should enforce a minimum TTL of 1 second', async () => {
      mockRedis.set.mockResolvedValue('OK')

      await service.blacklist('jti-expired', 0)

      expect(mockRedis.set).toHaveBeenCalledWith('token:blacklist:jti-expired', '1', 'EX', 1)
    })

    it('should enforce minimum TTL of 1 for negative expSeconds', async () => {
      mockRedis.set.mockResolvedValue('OK')

      await service.blacklist('jti-negative', -5)

      expect(mockRedis.set).toHaveBeenCalledWith('token:blacklist:jti-negative', '1', 'EX', 1)
    })

    it('should handle Redis error gracefully without throwing', async () => {
      mockRedis.set.mockRejectedValue(new Error('ECONNREFUSED'))

      await expect(service.blacklist('jti-fail', 600)).resolves.toBeUndefined()

      expect(mockAppLogger.error).toHaveBeenCalledWith(
        'Failed to blacklist token',
        expect.objectContaining({
          action: 'blacklist',
          stackTrace: expect.stringContaining('ECONNREFUSED'),
        })
      )
    })

    it('should handle non-Error thrown values gracefully', async () => {
      mockRedis.set.mockRejectedValue('string-error')

      await expect(service.blacklist('jti-string-err', 300)).resolves.toBeUndefined()

      expect(mockAppLogger.error).toHaveBeenCalledWith(
        'Failed to blacklist token',
        expect.objectContaining({
          action: 'blacklist',
          stackTrace: undefined,
        })
      )
    })
  })

  /* ------------------------------------------------------------------ */
  /* isBlacklisted                                                       */
  /* ------------------------------------------------------------------ */

  describe('isBlacklisted', () => {
    it('should return true when token exists in Redis (exists=1)', async () => {
      mockRedis.exists.mockResolvedValue(1)

      const result = await service.isBlacklisted('jti-blacklisted')

      expect(result).toBe(true)
      expect(mockRedis.exists).toHaveBeenCalledWith('token:blacklist:jti-blacklisted')
      expect(mockAppLogger.warn).toHaveBeenCalledWith(
        'Blacklisted token usage attempt detected',
        expect.objectContaining({
          action: 'isBlacklisted',
        })
      )
    })

    it('should return false when token does not exist in Redis (exists=0)', async () => {
      mockRedis.exists.mockResolvedValue(0)

      const result = await service.isBlacklisted('jti-valid')

      expect(result).toBe(false)
      expect(mockRedis.exists).toHaveBeenCalledWith('token:blacklist:jti-valid')
      // Should NOT log a warning for valid tokens
      expect(mockAppLogger.warn).not.toHaveBeenCalled()
    })

    it('should fail-open and return false when Redis throws an error', async () => {
      mockRedis.exists.mockRejectedValue(new Error('Connection timed out'))

      const result = await service.isBlacklisted('jti-error')

      expect(result).toBe(false)
      expect(mockAppLogger.error).toHaveBeenCalledWith(
        'Failed to check token blacklist (fail-open)',
        expect.objectContaining({
          action: 'isBlacklisted',
          metadata: { error: 'Connection timed out' },
        })
      )
    })

    it('should fail-open and handle non-Error thrown values', async () => {
      mockRedis.exists.mockRejectedValue('unexpected-rejection')

      const result = await service.isBlacklisted('jti-unknown-err')

      expect(result).toBe(false)
      expect(mockAppLogger.error).toHaveBeenCalledWith(
        'Failed to check token blacklist (fail-open)',
        expect.objectContaining({
          metadata: { error: 'Unknown error' },
        })
      )
    })
  })

  /* ------------------------------------------------------------------ */
  /* isRedisHealthy                                                      */
  /* ------------------------------------------------------------------ */

  describe('isRedisHealthy', () => {
    it('should return true when Redis responds with PONG', async () => {
      mockRedis.ping.mockResolvedValue('PONG')

      const result = await service.isRedisHealthy()

      expect(result).toBe(true)
      expect(mockRedis.ping).toHaveBeenCalledTimes(1)
    })

    it('should return false when Redis responds with unexpected value', async () => {
      mockRedis.ping.mockResolvedValue('NOT_PONG')

      const result = await service.isRedisHealthy()

      expect(result).toBe(false)
    })

    it('should return false when Redis throws an error', async () => {
      mockRedis.ping.mockRejectedValue(new Error('ECONNREFUSED'))

      const result = await service.isRedisHealthy()

      expect(result).toBe(false)
      expect(mockAppLogger.warn).toHaveBeenCalledWith(
        'Token blacklist Redis connection is unhealthy',
        expect.objectContaining({
          action: 'isRedisHealthy',
        })
      )
    })
  })

  /* ------------------------------------------------------------------ */
  /* onModuleDestroy                                                     */
  /* ------------------------------------------------------------------ */

  describe('onModuleDestroy', () => {
    it('should call redis.disconnect()', () => {
      service.onModuleDestroy()

      expect(mockRedis.disconnect).toHaveBeenCalledTimes(1)
    })
  })
})
