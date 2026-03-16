import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import { ZodError, type ZodIssue } from 'zod'
import type { Response } from 'express'

interface ErrorResponse {
  statusCode: number
  message: string | string[]
  messageKey: string
  errors?: string[]
  error: string
  timestamp: string
  path: string
}

const STATUS_MESSAGE_KEYS = new Map<number, string>([
  [HttpStatus.BAD_REQUEST, 'errors.badRequest'],
  [HttpStatus.UNAUTHORIZED, 'errors.unauthorized'],
  [HttpStatus.FORBIDDEN, 'errors.forbidden'],
  [HttpStatus.NOT_FOUND, 'errors.notFound'],
  [HttpStatus.CONFLICT, 'errors.conflict'],
  [HttpStatus.UNPROCESSABLE_ENTITY, 'errors.validationFailed'],
  [HttpStatus.TOO_MANY_REQUESTS, 'errors.tooManyRequests'],
  [HttpStatus.INTERNAL_SERVER_ERROR, 'errors.internalError'],
  [HttpStatus.SERVICE_UNAVAILABLE, 'errors.serviceUnavailable'],
])

function statusToMessageKey(status: number): string {
  return STATUS_MESSAGE_KEYS.get(status) ?? 'errors.internalError'
}

/** Maps a ZodIssue to a field-specific i18n messageKey (same logic as ZodValidationPipe). */
function zodIssueToMessageKey(issue: ZodIssue): string {
  const field = issue.path.join('.') || 'field'

  switch (issue.code) {
    case 'invalid_type': {
      if (issue.received === 'undefined') {
        return `errors.validation.${field}.required`
      }
      return `errors.validation.${field}.invalid`
    }
    case 'too_small': {
      if (issue.type === 'string' && issue.minimum === 1) {
        return `errors.validation.${field}.required`
      }
      if (issue.type === 'string') {
        return `errors.validation.${field}.tooShort`
      }
      if (issue.type === 'array') {
        return `errors.validation.${field}.tooFew`
      }
      return `errors.validation.${field}.invalid`
    }
    case 'too_big': {
      if (issue.type === 'string') {
        return `errors.validation.${field}.tooLong`
      }
      if (issue.type === 'number') {
        return `errors.validation.${field}.tooLarge`
      }
      return `errors.validation.${field}.invalid`
    }
    case 'invalid_enum_value': {
      return `errors.validation.${field}.invalidOption`
    }
    default: {
      return `errors.validation.${field}.invalid`
    }
  }
}

/** Strip internal file paths from error messages to prevent information leakage. */
function sanitizeMessage(value: string): string {
  return value.replaceAll(/[A-Z]:\\[^\s]+|\/[\w./-]+/g, '[path]').slice(0, 500)
}

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
    } else if (exception instanceof Error) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error(`Unhandled exception: ${exception.message}`)
      } else {
        this.logger.error(`Unhandled exception: ${exception.message}`, exception.stack)
      }
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
      error,
      timestamp: new Date().toISOString(),
      path: process.env.NODE_ENV === 'production' ? (request.url.split('?')[0] ?? '') : request.url,
    }

    // Include field-level validation errors when present
    if (errors && errors.length > 0) {
      errorResponse.errors = errors
    }

    response.status(status).json(errorResponse)
  }
}
