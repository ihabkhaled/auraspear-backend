import { Controller, Get, Post, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('callback')
  async callback(
    @Body() body: { code: string; redirect_uri: string },
  ): Promise<{ accessToken: string; user: JwtPayload }> {
    return this.authService.exchangeCode(body.code, body.redirect_uri);
  }

  @ApiBearerAuth()
  @Get('me')
  getProfile(@CurrentUser() user: JwtPayload): JwtPayload {
    return user;
  }

  @ApiBearerAuth()
  @Post('refresh')
  async refresh(
    @Body() body: { refreshToken: string },
  ): Promise<{ accessToken: string }> {
    return this.authService.refreshToken(body.refreshToken);
  }
}
