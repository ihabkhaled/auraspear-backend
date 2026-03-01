import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '../interfaces/authenticated-request.interface';

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
    const request = ctx.switchToHttp().getRequest();
    const user: JwtPayload = request.user;
    return data ? (user[data] as string) : user;
  },
);
