import { Injectable, Logger } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { UsersRepository } from './users.repository'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { AppLoggerService } from '../../common/services/app-logger.service'
import type { ChangePasswordDto } from './dto/change-password.dto'
import type { UpdatePreferencesDto } from './dto/update-preferences.dto'
import type { UpdateProfileDto } from './dto/update-profile.dto'
import type { Tenant, User, UserPreference } from '@prisma/client'

type UserProfile = Omit<User, 'passwordHash'> & {
  tenant: Tenant | null
  preference: UserPreference | null
}

const BCRYPT_SALT_ROUNDS = 12

const DEFAULT_PREFERENCES = {
  theme: 'system',
  language: 'en',
  notificationsEmail: true,
  notificationsInApp: true,
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name)

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly appLogger: AppLoggerService
  ) {}

  /* ---------------------------------------------------------------- */
  /* GET PROFILE                                                       */
  /* ---------------------------------------------------------------- */

  async getProfile(userId: string, tenantId?: string): Promise<UserProfile> {
    const user = await this.usersRepository.findByIdWithPreferencesAndMemberships(userId, tenantId)

    if (!user) {
      this.appLogger.warn(`User profile not found userId=${userId}`, {
        feature: AppLogFeature.USERS,
        action: 'getProfile',
        outcome: AppLogOutcome.FAILURE,
        tenantId,
        actorUserId: userId,
        targetResource: 'User',
        targetResourceId: userId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'UsersService',
        functionName: 'getProfile',
      })
      throw new BusinessException(404, 'User not found', 'errors.users.notFound')
    }

    const { passwordHash: _passwordHash, memberships, ...rest } = user
    const firstMembership = memberships[0]

    this.appLogger.info(`Retrieved user profile userId=${userId}`, {
      feature: AppLogFeature.USERS,
      action: 'getProfile',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      actorUserId: userId,
      actorEmail: user.email,
      targetResource: 'User',
      targetResourceId: userId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'UsersService',
      functionName: 'getProfile',
    })

    return {
      ...rest,
      tenant: firstMembership?.tenant ?? null,
      preference: user.preference,
    }
  }

  /* ---------------------------------------------------------------- */
  /* UPDATE PROFILE                                                    */
  /* ---------------------------------------------------------------- */

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<UserProfile> {
    const user = await this.usersRepository.findById(userId)

    if (!user) {
      this.appLogger.warn(`User not found for profile update userId=${userId}`, {
        feature: AppLogFeature.USERS,
        action: 'updateProfile',
        outcome: AppLogOutcome.FAILURE,
        actorUserId: userId,
        targetResource: 'User',
        targetResourceId: userId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'UsersService',
        functionName: 'updateProfile',
      })
      throw new BusinessException(404, 'User not found', 'errors.users.notFound')
    }

    if (!user.passwordHash) {
      this.appLogger.warn(`Profile update failed: no password set userId=${userId}`, {
        feature: AppLogFeature.USERS,
        action: 'updateProfile',
        outcome: AppLogOutcome.DENIED,
        actorUserId: userId,
        actorEmail: user.email,
        targetResource: 'User',
        targetResourceId: userId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'UsersService',
        functionName: 'updateProfile',
      })
      throw new BusinessException(400, 'Incorrect password', 'errors.users.incorrectPassword')
    }

    const isPasswordValid = await bcrypt.compare(dto.currentPassword, user.passwordHash)
    if (!isPasswordValid) {
      this.appLogger.warn(`Profile update failed: incorrect password userId=${userId}`, {
        feature: AppLogFeature.USERS,
        action: 'updateProfile',
        outcome: AppLogOutcome.DENIED,
        actorUserId: userId,
        actorEmail: user.email,
        targetResource: 'User',
        targetResourceId: userId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'UsersService',
        functionName: 'updateProfile',
      })
      throw new BusinessException(400, 'Incorrect password', 'errors.users.incorrectPassword')
    }

    const updated = await this.usersRepository.updateName(userId, dto.name)

    const { passwordHash: _passwordHash, memberships, ...rest } = updated
    const firstMembership = memberships[0]

    this.logger.log(`Profile updated for user ${userId}`)

    this.appLogger.info(`Updated user profile userId=${userId}`, {
      feature: AppLogFeature.USERS,
      action: 'updateProfile',
      outcome: AppLogOutcome.SUCCESS,
      actorUserId: userId,
      actorEmail: user.email,
      targetResource: 'User',
      targetResourceId: userId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'UsersService',
      functionName: 'updateProfile',
    })

    return {
      ...rest,
      tenant: firstMembership?.tenant ?? null,
      preference: updated.preference,
    }
  }

  /* ---------------------------------------------------------------- */
  /* CHANGE PASSWORD                                                   */
  /* ---------------------------------------------------------------- */

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<{ changed: boolean }> {
    const user = await this.usersRepository.findById(userId)

    if (!user) {
      this.appLogger.warn(`User not found for password change userId=${userId}`, {
        feature: AppLogFeature.USERS,
        action: 'changePassword',
        outcome: AppLogOutcome.FAILURE,
        actorUserId: userId,
        targetResource: 'User',
        targetResourceId: userId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'UsersService',
        functionName: 'changePassword',
      })
      throw new BusinessException(404, 'User not found', 'errors.users.notFound')
    }

    if (!user.passwordHash) {
      this.appLogger.warn(`Password change failed: no password set userId=${userId}`, {
        feature: AppLogFeature.USERS,
        action: 'changePassword',
        outcome: AppLogOutcome.DENIED,
        actorUserId: userId,
        actorEmail: user.email,
        targetResource: 'User',
        targetResourceId: userId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'UsersService',
        functionName: 'changePassword',
      })
      throw new BusinessException(400, 'Incorrect password', 'errors.users.incorrectPassword')
    }

    const isPasswordValid = await bcrypt.compare(dto.currentPassword, user.passwordHash)
    if (!isPasswordValid) {
      this.appLogger.warn(`Password change failed: incorrect current password userId=${userId}`, {
        feature: AppLogFeature.USERS,
        action: 'changePassword',
        outcome: AppLogOutcome.DENIED,
        actorUserId: userId,
        actorEmail: user.email,
        targetResource: 'User',
        targetResourceId: userId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'UsersService',
        functionName: 'changePassword',
      })
      throw new BusinessException(400, 'Incorrect password', 'errors.users.incorrectPassword')
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, BCRYPT_SALT_ROUNDS)

    await this.usersRepository.updatePasswordHash(userId, hashedPassword)

    this.logger.log(`Password changed for user ${userId}`)

    this.appLogger.info(`Password changed successfully userId=${userId}`, {
      feature: AppLogFeature.USERS,
      action: 'changePassword',
      outcome: AppLogOutcome.SUCCESS,
      actorUserId: userId,
      actorEmail: user.email,
      targetResource: 'User',
      targetResourceId: userId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'UsersService',
      functionName: 'changePassword',
    })

    return { changed: true }
  }

  /* ---------------------------------------------------------------- */
  /* GET PREFERENCES                                                   */
  /* ---------------------------------------------------------------- */

  async getPreferences(userId: string): Promise<
    | UserPreference
    | {
        userId: string
        theme: string
        language: string
        notificationsEmail: boolean
        notificationsInApp: boolean
      }
  > {
    const user = await this.usersRepository.findById(userId)

    if (!user) {
      this.appLogger.warn(`User not found for preferences userId=${userId}`, {
        feature: AppLogFeature.USERS,
        action: 'getPreferences',
        outcome: AppLogOutcome.FAILURE,
        actorUserId: userId,
        targetResource: 'UserPreference',
        targetResourceId: userId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'UsersService',
        functionName: 'getPreferences',
      })
      throw new BusinessException(404, 'User not found', 'errors.users.notFound')
    }

    const preference = await this.usersRepository.findPreference(userId)

    this.appLogger.info(`Retrieved user preferences userId=${userId}`, {
      feature: AppLogFeature.USERS,
      action: 'getPreferences',
      outcome: AppLogOutcome.SUCCESS,
      actorUserId: userId,
      actorEmail: user.email,
      targetResource: 'UserPreference',
      targetResourceId: userId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'UsersService',
      functionName: 'getPreferences',
    })

    if (!preference) {
      return { userId, ...DEFAULT_PREFERENCES }
    }

    return preference
  }

  /* ---------------------------------------------------------------- */
  /* UPDATE PREFERENCES                                                */
  /* ---------------------------------------------------------------- */

  async updatePreferences(userId: string, dto: UpdatePreferencesDto): Promise<UserPreference> {
    const user = await this.usersRepository.findById(userId)

    if (!user) {
      this.appLogger.warn(`User not found for preferences update userId=${userId}`, {
        feature: AppLogFeature.USERS,
        action: 'updatePreferences',
        outcome: AppLogOutcome.FAILURE,
        actorUserId: userId,
        targetResource: 'UserPreference',
        targetResourceId: userId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'UsersService',
        functionName: 'updatePreferences',
      })
      throw new BusinessException(404, 'User not found', 'errors.users.notFound')
    }

    const preference = await this.usersRepository.upsertPreference(
      userId,
      {
        ...(dto.theme !== undefined && { theme: dto.theme }),
        ...(dto.language !== undefined && { language: dto.language }),
        ...(dto.notificationsEmail !== undefined && { notificationsEmail: dto.notificationsEmail }),
        ...(dto.notificationsInApp !== undefined && { notificationsInApp: dto.notificationsInApp }),
      },
      {
        theme: dto.theme ?? DEFAULT_PREFERENCES.theme,
        language: dto.language ?? DEFAULT_PREFERENCES.language,
        notificationsEmail: dto.notificationsEmail ?? DEFAULT_PREFERENCES.notificationsEmail,
        notificationsInApp: dto.notificationsInApp ?? DEFAULT_PREFERENCES.notificationsInApp,
      }
    )

    this.logger.log(`Preferences updated for user ${userId}`)

    this.appLogger.info(`Updated user preferences userId=${userId}`, {
      feature: AppLogFeature.USERS,
      action: 'updatePreferences',
      outcome: AppLogOutcome.SUCCESS,
      actorUserId: userId,
      actorEmail: user.email,
      targetResource: 'UserPreference',
      targetResourceId: userId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'UsersService',
      functionName: 'updatePreferences',
      metadata: {
        theme: dto.theme ?? null,
        language: dto.language ?? null,
      },
    })

    return preference
  }
}
