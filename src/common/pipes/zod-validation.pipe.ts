import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common'
import { ZodSchema, ZodError } from 'zod'

/**
 * Generic validation pipe that validates incoming data against a Zod schema.
 *
 * @example
 *   @UsePipes(new ZodValidationPipe(CreateCaseSchema))
 *   @Post()
 *   create(@Body() dto: CreateCaseDto) { ... }
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    try {
      return this.schema.parse(value)
    } catch (error) {
      if (error instanceof ZodError) {
        const messages = error.errors.map(e => {
          const path = e.path.join('.')
          return path ? `${path}: ${e.message}` : e.message
        })
        throw new BadRequestException({
          statusCode: 400,
          message: 'Validation failed',
          errors: messages,
        })
      }
      throw new BadRequestException('Validation failed')
    }
  }
}
