import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import { AuthService } from '../../modules/auth/auth.service'
import { PrismaService } from '../../prisma/prisma.service'
import { IS_PUBLIC_KEY } from '../decorators/public.decorator'
import { BusinessException } from '../exceptions/business.exception'
import { UserRole } from '../interfaces/authenticated-request.interface'
import type {
  JwtPayload,
  AuthenticatedRequest,
} from '../interfaces/authenticated-request.interface'

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name)
  private readonly isDev: boolean

  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
    private readonly prisma: PrismaService
  ) {
    this.isDev = this.configService.get('NODE_ENV') !== 'production'
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    if (isPublic) {
      return true
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const authHeader = request.headers.authorization

    if (!authHeader?.startsWith('Bearer ')) {
      if (this.isDev && !authHeader) {
        request.user = this.getDevUser(request)
        return true
      }
      throw new BusinessException(
        401,
        'Missing or invalid Authorization header',
        'errors.auth.missingToken'
      )
    }

    const token = authHeader.slice(7)

    try {
      const decoded = this.authService.verifyAccessToken(token)

      // Verify user still exists and is active
      await this.authService.validateUserActive(decoded.sub)

      request.user = decoded

      // Allow GLOBAL_ADMIN to switch tenant context via X-Tenant-Id header
      if (decoded.role === UserRole.GLOBAL_ADMIN) {
        const headerTenantId = request.headers['x-tenant-id'] as string | undefined
        if (headerTenantId && headerTenantId !== decoded.tenantId) {
          const tenantExists = await this.prisma.tenant.findUnique({
            where: { id: headerTenantId },
            select: { id: true },
          })
          if (!tenantExists) {
            throw new BusinessException(400, 'Invalid tenant ID', 'errors.tenants.notFound')
          }
          request.user = { ...decoded, tenantId: headerTenantId }
        }
      }

      return true
    } catch (error) {
      if (error instanceof BusinessException) {
        throw error
      }
      this.logger.warn(`JWT verification failed: ${(error as Error).message}`)
      throw new BusinessException(401, 'Invalid or expired token', 'errors.auth.expiredToken')
    }
  }

  private getDevUser(request: AuthenticatedRequest): JwtPayload {
    const tenantId = (request.headers['x-tenant-id'] as string | undefined) ?? 'dev-tenant-001'
    const role =
      (request.headers['x-role'] as string | undefined as UserRole | undefined) ??
      UserRole.GLOBAL_ADMIN

    return {
      sub: 'dev-user-001',
      email: 'dev@auraspear.local',
      tenantId,
      tenantSlug: 'dev-tenant',
      role,
    }
  }
}
