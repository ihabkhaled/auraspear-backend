import { STATUS_MESSAGE_KEYS } from './http-exception.constants'
import type { ZodIssue } from 'zod'

export function statusToMessageKey(status: number): string {
  return STATUS_MESSAGE_KEYS.get(status) ?? 'errors.internalError'
}

/** Maps a ZodIssue to a field-specific i18n messageKey (same logic as ZodValidationPipe). */
export function zodIssueToMessageKey(issue: ZodIssue): string {
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
export function sanitizeMessage(value: string): string {
  return value.replaceAll(/[A-Z]:\\[^\s]+|\/[\w./-]+/g, '[path]').slice(0, 500)
}
