import { Controller, Get, Post, Body, UsePipes } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { AuthService } from './auth.service'
import { AuthLoginSchema, type AuthLoginDto } from './dto/auth-login.dto'
import { AuthRefreshSchema, type AuthRefreshDto } from './dto/auth-refresh.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Public } from '../../common/decorators/public.decorator'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'

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
   * POST /auth/logout
   * Stateless logout — client must discard tokens.
   * TODO: Implement server-side token revocation via Redis blacklist for full security.
   */
  @ApiBearerAuth()
  @Post('logout')
  logout(): { loggedOut: boolean } {
    return { loggedOut: true }
  }
}
