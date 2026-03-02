import { type ExecutionContext } from '@nestjs/common'
import { type ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import { BusinessException } from '../../src/common/exceptions/business.exception'
import { AuthGuard } from '../../src/common/guards/auth.guard'

function createMockContext(user?: Record<string, unknown>, authHeader?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        user,
        headers: {
          authorization: authHeader,
        },
      }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext
}

describe('AuthGuard', () => {
  let guard: AuthGuard
  let reflector: Reflector

  beforeEach(() => {
    reflector = new Reflector()
    const configService = {
      get: (key: string, defaultValue?: string) => {
        const config: Record<string, string> = {
          NODE_ENV: 'development',
          OIDC_AUDIENCE: 'api://test',
          OIDC_ISSUER_URL: 'https://test.example.com',
          OIDC_JWKS_URI: 'https://test.example.com/.well-known/jwks.json',
        }
        return config[key] ?? defaultValue
      },
    } as ConfigService

    const authService = {
      verifyAccessToken: jest.fn(),
      validateUserActive: jest.fn(),
    }

    const prismaService = {
      tenant: {
        findUnique: jest.fn(),
      },
    }

    guard = new AuthGuard(reflector, configService, authService as never, prismaService as never)
  })

  it('should allow public routes', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true)
    const context = createMockContext()
    const result = await guard.canActivate(context)
    expect(result).toBe(true)
  })

  it('should inject dev user when no auth header in development', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false)
    const context = createMockContext(undefined, undefined)
    const result = await guard.canActivate(context)
    expect(result).toBe(true)
  })

  it('should throw BusinessException for non-Bearer auth header', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false)
    const context = createMockContext(undefined, 'Basic abc123')
    await expect(guard.canActivate(context)).rejects.toThrow(BusinessException)
  })
})
