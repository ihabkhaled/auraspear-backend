import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import { BusinessException } from '../exceptions/business.exception'
import { type JwtPayload } from '../interfaces/authenticated-request.interface'

/**
 * Extracts the authenticated user (JwtPayload) from the request.
 * Optionally pass a property name to extract a single field.
 *
 * @example
 *   @CurrentUser() user: JwtPayload
 *   @CurrentUser('tenantId') tenantId: string
 */
export const CurrentUser = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext): JwtPayload | string => {
    const request = ctx.switchToHttp().getRequest()
    const user = request.user as JwtPayload | undefined
    if (!user) {
      throw new BusinessException(401, 'Authentication required', 'errors.auth.missingToken')
    }
    return data ? (user[data] as string) : user
  }
)
