import { Controller, Get, Post, Body, UsePipes } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
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
  @UsePipes(new ZodValidationPipe(AuthLoginSchema))
  async login(
    @Body() dto: AuthLoginDto
  ): Promise<{ accessToken: string; refreshToken: string; user: JwtPayload }> {
    return this.authService.login(dto.email, dto.password)
  }

  @ApiBearerAuth()
  @Get('me')
  getProfile(@CurrentUser() user: JwtPayload): JwtPayload {
    return user
  }

  @Public()
  @Post('refresh')
  @UsePipes(new ZodValidationPipe(AuthRefreshSchema))
  async refresh(
    @Body() dto: AuthRefreshDto
  ): Promise<{ accessToken: string; refreshToken: string }> {
    return this.authService.refreshTokens(dto.refreshToken)
  }
}
