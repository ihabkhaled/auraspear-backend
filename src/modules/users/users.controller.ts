import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { ChangePasswordSchema, type ChangePasswordDto } from './dto/change-password.dto'
import { UpdatePreferencesSchema, type UpdatePreferencesDto } from './dto/update-preferences.dto'
import { UpdateProfileSchema, type UpdateProfileDto } from './dto/update-profile.dto'
import { UsersService } from './users.service'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { AuthGuard } from '../../common/guards/auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { TenantGuard } from '../../common/guards/tenant.guard'
import { UserRole } from '../../common/interfaces/authenticated-request.interface'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'
import type { Tenant, User, UserPreference } from '@prisma/client'

type UserProfile = Omit<User, 'passwordHash'> & {
  tenant: Tenant | null
  preference: UserPreference | null
}

type UserPreferenceOrDefault =
  | UserPreference
  | {
      userId: string
      theme: string
      language: string
      notificationsEmail: boolean
      notificationsInApp: boolean
    }

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(AuthGuard, TenantGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('profile')
  async getProfile(@CurrentUser() user: JwtPayload): Promise<UserProfile> {
    return this.usersService.getProfile(user.sub)
  }

  @Patch('profile')
  @Roles(UserRole.SOC_ANALYST_L1)
  async updateProfile(
    @Body(new ZodValidationPipe(UpdateProfileSchema)) dto: UpdateProfileDto,
    @CurrentUser() user: JwtPayload
  ): Promise<UserProfile> {
    return this.usersService.updateProfile(user.sub, dto)
  }

  @Post('change-password')
  @Roles(UserRole.SOC_ANALYST_L1)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async changePassword(
    @Body(new ZodValidationPipe(ChangePasswordSchema)) dto: ChangePasswordDto,
    @CurrentUser() user: JwtPayload
  ): Promise<{ changed: boolean }> {
    return this.usersService.changePassword(user.sub, dto)
  }

  @Get('preferences')
  async getPreferences(@CurrentUser() user: JwtPayload): Promise<UserPreferenceOrDefault> {
    return this.usersService.getPreferences(user.sub)
  }

  @Patch('preferences')
  @Roles(UserRole.SOC_ANALYST_L1)
  async updatePreferences(
    @Body(new ZodValidationPipe(UpdatePreferencesSchema)) dto: UpdatePreferencesDto,
    @CurrentUser() user: JwtPayload
  ): Promise<UserPreference> {
    return this.usersService.updatePreferences(user.sub, dto)
  }
}
