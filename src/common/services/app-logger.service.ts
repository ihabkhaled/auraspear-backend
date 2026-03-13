import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { redactSensitiveFields } from '../utils/redaction.util'
import type { Prisma } from '@prisma/client'

export interface AppLogContext {
  feature: string
  action: string
  functionName?: string
  className?: string
  tenantId?: string
  actorUserId?: string
  actorEmail?: string
  requestId?: string
  targetResource?: string
  targetResourceId?: string
  outcome?: string
  metadata?: Record<string, unknown>
  stackTrace?: string
  httpMethod?: string
  httpRoute?: string
  httpStatusCode?: number
  sourceType?: string
  ipAddress?: string
}

const MAX_MESSAGE_LENGTH = 2000
const MAX_STACK_TRACE_LENGTH = 5000
const MAX_METADATA_SIZE = 10000

@Injectable()
export class AppLoggerService {
  private readonly logger = new Logger(AppLoggerService.name)

  constructor(private readonly prisma: PrismaService) {}

  info(message: string, context: AppLogContext): void {
    this.persist('info', message, context)
    this.logger.log(this.formatLogMessage(message, context))
  }

  warn(message: string, context: AppLogContext): void {
    this.persist('warn', message, context)
    this.logger.warn(this.formatLogMessage(message, context))
  }

  error(message: string, context: AppLogContext): void {
    this.persist('error', message, context)
    this.logger.error(this.formatLogMessage(message, context))
  }

  debug(message: string, context: AppLogContext): void {
    this.persist('debug', message, context)
    this.logger.debug(this.formatLogMessage(message, context))
  }

  private formatLogMessage(message: string, context: AppLogContext): string {
    const parts = [`${context.feature} => ${message}`]
    if (context.actorEmail) {
      parts.push(`actorEmail=${context.actorEmail}`)
    }
    if (context.tenantId) {
      parts.push(`tenantId=${context.tenantId}`)
    }
    if (context.targetResource && context.targetResourceId) {
      parts.push(`${context.targetResource}=${context.targetResourceId}`)
    }
    if (context.outcome) {
      parts.push(`outcome=${context.outcome}`)
    }
    return parts.join(' ')
  }

  private persist(level: string, message: string, context: AppLogContext): void {
    const sanitizedMetadata = context.metadata ? redactSensitiveFields(context.metadata) : undefined

    let finalMetadata = sanitizedMetadata
    if (finalMetadata) {
      const serialized = JSON.stringify(finalMetadata)
      if (serialized.length > MAX_METADATA_SIZE) {
        finalMetadata = { _truncated: true, _reason: 'metadata exceeded size limit' }
      }
    }

    this.prisma.applicationLog
      .create({
        data: {
          level,
          message: message.slice(0, MAX_MESSAGE_LENGTH),
          feature: context.feature,
          action: context.action,
          functionName: context.functionName ?? null,
          className: context.className ?? null,
          tenantId: context.tenantId ?? null,
          actorUserId: context.actorUserId ?? null,
          actorEmail: context.actorEmail ?? null,
          requestId: context.requestId ?? null,
          targetResource: context.targetResource ?? null,
          targetResourceId: context.targetResourceId ?? null,
          outcome: context.outcome ?? null,
          metadata: (finalMetadata as Prisma.InputJsonValue) ?? undefined,
          stackTrace: context.stackTrace
            ? context.stackTrace.slice(0, MAX_STACK_TRACE_LENGTH)
            : null,
          httpMethod: context.httpMethod ?? null,
          httpRoute: context.httpRoute ?? null,
          httpStatusCode: context.httpStatusCode ?? null,
          sourceType: context.sourceType ?? null,
          ipAddress: context.ipAddress ?? null,
        },
      })
      .catch((error: unknown) => {
        this.logger.error('Failed to persist application log', error)
      })
  }
}
