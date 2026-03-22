import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'
import {
  statusToMessageKey,
  zodIssueToMessageKey,
  sanitizeMessage,
} from './http-exception.utilities'
import type { ErrorResponse } from './http-exception.types'
import type { Response } from 'express'

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<{ url: string }>()

    let status = HttpStatus.INTERNAL_SERVER_ERROR
    let message: string | string[] = 'Internal server error'
    let error = 'Internal Server Error'
    let messageKey: string | undefined
    let errors: string[] | undefined

    if (exception instanceof HttpException) {
      status = exception.getStatus()
      const exceptionResponse = exception.getResponse()

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const responseObject = exceptionResponse as Record<string, unknown>
        message = (responseObject.message as string | string[]) ?? exception.message
        error = (responseObject.error as string) ?? 'Error'
        messageKey = responseObject.messageKey as string | undefined
        errors = responseObject.errors as string[] | undefined
      }
    } else if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST
      error = 'Bad Request'
      const issueKeys = exception.errors.map(zodIssueToMessageKey)
      messageKey = issueKeys[0] ?? 'errors.validation.failed'
      errors = issueKeys
      message = `Validation failed: ${issueKeys.join(', ')}`
      this.logger.warn(`ZodError caught by GlobalExceptionFilter: ${issueKeys.join(', ')}`)
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Prisma known errors (unique constraint, foreign key, not found, etc.)
      // NEVER leak table names, column names, or constraint names to the client
      this.logger.error(`Prisma error [${exception.code}]: ${exception.message}`, exception.stack)
      status = HttpStatus.INTERNAL_SERVER_ERROR
      message = 'A database error occurred'
      messageKey = 'errors.internalError'
      error = 'Internal Server Error'
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      // Prisma validation errors — may contain model/field names
      this.logger.error(`Prisma validation error: ${exception.message}`)
      status = HttpStatus.BAD_REQUEST
      message = 'Invalid database query'
      messageKey = 'errors.badRequest'
      error = 'Bad Request'
    } else if (exception instanceof Prisma.PrismaClientInitializationError) {
      // Connection failures — never leak connection strings
      this.logger.error(`Prisma initialization error: ${exception.message}`)
      status = HttpStatus.SERVICE_UNAVAILABLE
      message = 'Service temporarily unavailable'
      messageKey = 'errors.serviceUnavailable'
      error = 'Service Unavailable'
    } else if (exception instanceof Error) {
      // Log full details server-side only; never send stack/message to client
      this.logger.error(`Unhandled exception: ${exception.message}`, exception.stack)
    } else {
      this.logger.error('Unknown exception occurred')
    }

    // Fall back to a status-based messageKey if none was provided
    messageKey ??= statusToMessageKey(status)

    const sanitizedMessage = Array.isArray(message)
      ? message.map(m => sanitizeMessage(m))
      : sanitizeMessage(message)

    const errorResponse: ErrorResponse = {
      statusCode: status,
      message: sanitizedMessage,
      messageKey,
      error: sanitizeMessage(error),
      timestamp: new Date().toISOString(),
      path: request.url.split('?')[0] ?? '',
    }

    // Include field-level validation errors when present
    if (errors && errors.length > 0) {
      errorResponse.errors = errors
    }

    response.status(status).json(errorResponse)
  }
}
