import type { ZodIssue } from 'zod'

/**
 * Maps a single ZodIssue to a field-specific i18n messageKey.
 *
 * The generated keys follow the pattern `errors.validation.{field}.{reason}`
 * so the frontend can look up a precise translation for each validation failure.
 */
export function issueToMessageKey(issue: ZodIssue): string {
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

    case 'invalid_string': {
      if (issue.validation === 'email') {
        return `errors.validation.${field}.invalidEmail`
      }
      if (issue.validation === 'uuid') {
        return `errors.validation.${field}.invalidUuid`
      }
      if (issue.validation === 'regex') {
        return `errors.validation.${field}.invalidFormat`
      }
      return `errors.validation.${field}.invalid`
    }

    case 'invalid_enum_value': {
      return `errors.validation.${field}.invalidOption`
    }

    case 'custom': {
      if (issue.message.startsWith('errors.')) {
        return issue.message
      }
      return `errors.validation.${field}.invalid`
    }

    default: {
      return `errors.validation.${field}.invalid`
    }
  }
}
