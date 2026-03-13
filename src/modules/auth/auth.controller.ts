import { Controller, Get, Post, Body, Req, UsePipes } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { AuthService } from './auth.service'
import { AuthLoginSchema, type AuthLoginDto } from './dto/auth-login.dto'
import { AuthLogoutSchema, type AuthLogoutDto } from './dto/auth-logout.dto'
import { AuthRefreshSchema, type AuthRefreshDto } from './dto/auth-refresh.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Public } from '../../common/decorators/public.decorator'
import { BusinessException } from '../../common/exceptions/business.exception'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type {
  AuthenticatedRequest,
  JwtPayload,
} from '../../common/interfaces/authenticated-request.interface'

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UsePipes(new ZodValidationPipe(AuthLoginSchema))
  async login(@Body() dto: AuthLoginDto): Promise<{
    accessToken: string
    refreshToken: string
    user: JwtPayload
    tenants: Array<{ id: string; name: string; slug: string; role: string }>
  }> {
    return this.authService.login(dto.email, dto.password)
  }

  @ApiBearerAuth()
  @Get('me')
  getProfile(@CurrentUser() user: JwtPayload): JwtPayload {
    return user
  }

  @ApiBearerAuth()
  @Get('tenants')
  async getTenants(
    @CurrentUser() user: JwtPayload
  ): Promise<Array<{ id: string; name: string; slug: string; role: string }>> {
    return this.authService.getUserTenants(user.sub)
  }

  @Public()
  @Post('refresh')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @UsePipes(new ZodValidationPipe(AuthRefreshSchema))
  async refresh(
    @Body() dto: AuthRefreshDto
  ): Promise<{ accessToken: string; refreshToken: string }> {
    return this.authService.refreshTokens(dto.refreshToken)
  }

  /**
   * POST /auth/end-impersonation
   * Ends the current impersonation session by blacklisting the impersonation
   * tokens and issuing fresh tokens for the original admin user.
   */
  @ApiBearerAuth()
  @Post('end-impersonation')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async endImpersonation(
    @CurrentUser() user: JwtPayload
  ): Promise<{ accessToken: string; refreshToken: string; user: JwtPayload }> {
    return this.authService.endImpersonation(user)
  }

  /**
   * POST /auth/logout
   * Blacklists both access and refresh tokens in Redis so they cannot be reused.
   * The client should also discard its stored tokens.
   */
  @ApiBearerAuth()
  @Post('logout')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async logout(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(AuthLogoutSchema)) dto: AuthLogoutDto
  ): Promise<{ loggedOut: boolean }> {
    const accessUser = request.user
    if (!accessUser?.jti || !accessUser?.exp) {
      throw new BusinessException(
        401,
        'Access token missing required claims',
        'errors.auth.invalidAccessToken'
      )
    }

    const refreshPayload = await this.authService.verifyRefreshToken(dto.refreshToken)
    if (!refreshPayload.jti || !refreshPayload.exp) {
      throw new BusinessException(
        401,
        'Refresh token missing required claims',
        'errors.auth.invalidRefreshToken'
      )
    }

    if (refreshPayload.sub !== accessUser.sub) {
      throw new BusinessException(
        403,
        'Refresh token does not belong to this user',
        'errors.auth.tokenMismatch'
      )
    }

    await this.authService.logout(
      accessUser.jti,
      refreshPayload.jti,
      accessUser.exp,
      refreshPayload.exp
    )

    return { loggedOut: true }
  }
}
