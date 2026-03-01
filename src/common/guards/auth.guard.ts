import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import { AuthService } from '../../modules/auth/auth.service'
import { IS_PUBLIC_KEY } from '../decorators/public.decorator'
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
    private readonly authService: AuthService
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
      throw new UnauthorizedException('Missing or invalid Authorization header')
    }

    const token = authHeader.slice(7)

    try {
      const decoded = this.authService.verifyAccessToken(token)
      request.user = decoded
      return true
    } catch (error) {
      this.logger.warn(`JWT verification failed: ${(error as Error).message}`)
      throw new UnauthorizedException('Invalid or expired token')
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
      role,
    }
  }
}
