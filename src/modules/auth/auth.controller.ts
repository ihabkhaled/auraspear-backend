import { Controller, Get, Post, Body, UsePipes } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { AuthService } from './auth.service'
import { AuthCallbackSchema, type AuthCallbackDto } from './dto/auth-callback.dto'
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
  @Post('callback')
  @UsePipes(new ZodValidationPipe(AuthCallbackSchema))
  async callback(@Body() dto: AuthCallbackDto): Promise<{ accessToken: string; user: JwtPayload }> {
    return this.authService.exchangeCode(dto.code, dto.redirect_uri)
  }

  @ApiBearerAuth()
  @Get('me')
  getProfile(@CurrentUser() user: JwtPayload): JwtPayload {
    return user
  }

  @ApiBearerAuth()
  @Post('refresh')
  @UsePipes(new ZodValidationPipe(AuthRefreshSchema))
  async refresh(@Body() dto: AuthRefreshDto): Promise<{ accessToken: string }> {
    return this.authService.refreshToken(dto.refreshToken)
  }
}
