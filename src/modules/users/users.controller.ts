import { Body, Controller, Get, Patch, Post } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { ChangePasswordSchema, type ChangePasswordDto } from './dto/change-password.dto'
import { UpdatePreferencesSchema, type UpdatePreferencesDto } from './dto/update-preferences.dto'
import { UpdateProfileSchema, type UpdateProfileDto } from './dto/update-profile.dto'
import { UsersService } from './users.service'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('profile')
  async getProfile(@CurrentUser() user: JwtPayload) {
    return this.usersService.getProfile(user.sub)
  }

  @Patch('profile')
  async updateProfile(
    @Body(new ZodValidationPipe(UpdateProfileSchema)) dto: UpdateProfileDto,
    @CurrentUser() user: JwtPayload
  ) {
    return this.usersService.updateProfile(user.sub, dto)
  }

  @Post('change-password')
  async changePassword(
    @Body(new ZodValidationPipe(ChangePasswordSchema)) dto: ChangePasswordDto,
    @CurrentUser() user: JwtPayload
  ) {
    return this.usersService.changePassword(user.sub, dto)
  }

  @Get('preferences')
  async getPreferences(@CurrentUser() user: JwtPayload) {
    return this.usersService.getPreferences(user.sub)
  }

  @Patch('preferences')
  async updatePreferences(
    @Body(new ZodValidationPipe(UpdatePreferencesSchema)) dto: UpdatePreferencesDto,
    @CurrentUser() user: JwtPayload
  ) {
    return this.usersService.updatePreferences(user.sub, dto)
  }
}
