import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
  Logger,
} from '@nestjs/common'
import { type Observable, tap } from 'rxjs'
import { PrismaService } from '../../prisma/prisma.service'
import type { AuthenticatedRequest } from '../interfaces/authenticated-request.interface'

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const SENSITIVE_BODY_KEYS = new Set([
  'password',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'passwordHash',
  'secret',
  'apiKey',
  'token',
])

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name)

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const { method } = request

    if (!MUTATION_METHODS.has(method)) {
      return next.handle()
    }

    const { user } = request
    const tenantId = user?.tenantId
    const handler = context.getHandler().name
    const controller = context.getClass().name

    // Build resource ID from all path params
    const params = request.params as Record<string, string> | undefined
    const resourceId = params ? Object.values(params).filter(Boolean).join('/') || null : null

    // Build sanitized details from request body (strip sensitive fields)
    let details: string | null = null
    if (request.body && typeof request.body === 'object') {
      const sanitized: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(request.body as Record<string, unknown>)) {
        sanitized[key] = SENSITIVE_BODY_KEYS.has(key) ? '[REDACTED]' : value
      }
      details = JSON.stringify(sanitized).slice(0, 2000)
    }

    return next.handle().pipe(
      tap(() => {
        if (!tenantId || !user) return

        this.prisma.auditLog
          .create({
            data: {
              tenantId,
              actor: user.email ?? user.sub,
              role: user.role,
              action: `${method} ${handler}`,
              resource: controller,
              resourceId,
              details,
              ipAddress: request.ip ?? null,
            },
          })
          .catch((error: unknown) => {
            this.logger.error('Failed to write audit log', error)
          })
      })
    )
  }
}
