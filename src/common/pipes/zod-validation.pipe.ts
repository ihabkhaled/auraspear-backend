import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common'
import { ZodSchema, ZodError, type ZodIssue } from 'zod'
import { BusinessException } from '../exceptions/business.exception'

/**
 * Maps a single ZodIssue to a field-specific i18n messageKey.
 *
 * The generated keys follow the pattern `errors.validation.{field}.{reason}`
 * so the frontend can look up a precise translation for each validation failure.
 */
function issueToMessageKey(issue: ZodIssue): string {
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

/**
 * Generic validation pipe that validates incoming data against a Zod schema.
 *
 * IMPORTANT: Never use @UsePipes() at method level when @Param() is present.
 * Instead apply the pipe directly on @Body():
 *
 * @example
 *   @Post(':id')
 *   create(@Param('id') id: string, @Body(new ZodValidationPipe(Schema)) dto: Dto) { ... }
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    try {
      return this.schema.parse(value)
    } catch (error) {
      if (error instanceof ZodError) {
        const messageKeys = error.errors.map(issueToMessageKey)
        const firstKey = messageKeys[0] ?? 'errors.validation.failed'

        throw new BusinessException(
          400,
          `Validation failed: ${messageKeys.join(', ')}`,
          firstKey,
          messageKeys
        )
      }
      throw new BusinessException(400, 'Validation failed', 'errors.validation.failed')
    }
  }
}
