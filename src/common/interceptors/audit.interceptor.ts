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
              resourceId: request.params?.id ?? null,
              details: null,
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
