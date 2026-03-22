import { Injectable, Logger } from '@nestjs/common'
import {
  MAX_MESSAGE_LENGTH,
  MAX_STACK_TRACE_LENGTH,
  MAX_METADATA_SIZE,
} from './app-logger.constants'
import { PrismaService } from '../../prisma/prisma.service'
import { redactSensitiveFields } from '../utils/redaction.utility'
import type { AppLogContext } from './app-logger.types'
import type { Prisma } from '@prisma/client'

export type { AppLogContext } from './app-logger.types'

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
    if (context.action) {
      parts.push(`action=${context.action}`)
    }
    if (context.outcome) {
      parts.push(`outcome=${context.outcome}`)
    }
    if (context.className) {
      parts.push(`class=${context.className}`)
    }
    if (context.functionName) {
      parts.push(`fn=${context.functionName}`)
    }
    if (context.actorEmail) {
      parts.push(`actorEmail=${context.actorEmail}`)
    }
    if (context.tenantId) {
      parts.push(`tenantId=${context.tenantId}`)
    }
    if (context.targetResource) {
      parts.push(`resource=${context.targetResource}`)
    }
    if (context.targetResourceId) {
      parts.push(`resourceId=${context.targetResourceId}`)
    }
    if (context.sourceType) {
      parts.push(`source=${context.sourceType}`)
    }
    if (context.requestId) {
      parts.push(`reqId=${context.requestId}`)
    }
    if (context.httpMethod && context.httpRoute) {
      parts.push(`${context.httpMethod} ${context.httpRoute}`)
    }
    if (context.httpStatusCode) {
      parts.push(`httpStatus=${context.httpStatusCode}`)
    }
    if (context.ipAddress) {
      parts.push(`ip=${context.ipAddress}`)
    }
    if (context.metadata && Object.keys(context.metadata).length > 0) {
      parts.push(`metadata=${JSON.stringify(context.metadata)}`)
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
