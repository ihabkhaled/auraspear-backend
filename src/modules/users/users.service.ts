import { Injectable, Logger } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { BCRYPT_SALT_ROUNDS } from './users.constants'
import { UsersRepository } from './users.repository'
import {
  DEFAULT_PREFERENCES,
  buildPreferenceCreateData,
  buildPreferenceUpdateData,
  mapUserToProfile,
} from './users.utilities'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { AppLoggerService } from '../../common/services/app-logger.service'
import type { ChangePasswordDto } from './dto/change-password.dto'
import type { UpdatePreferencesDto } from './dto/update-preferences.dto'
import type { UpdateProfileDto } from './dto/update-profile.dto'
import type { UserProfile } from './users.types'
import type { User, UserPreference } from '@prisma/client'

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
      this.logWarn('getProfile', userId, tenantId)
      throw new BusinessException(404, 'User not found', 'errors.users.notFound')
    }
    this.logSuccess('getProfile', userId, user.email, tenantId)
    return mapUserToProfile(user)
  }

  /* ---------------------------------------------------------------- */
  /* UPDATE PROFILE                                                    */
  /* ---------------------------------------------------------------- */

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<UserProfile> {
    const user = await this.findUserOrThrow(userId, 'updateProfile')
    await this.verifyPasswordOrThrow(user, dto.currentPassword, 'updateProfile')

    const updated = await this.usersRepository.updateName(userId, dto.name)
    this.logger.log(`Profile updated for user ${userId}`)
    this.logSuccess('updateProfile', userId, user.email)
    return mapUserToProfile(updated)
  }

  /* ---------------------------------------------------------------- */
  /* CHANGE PASSWORD                                                   */
  /* ---------------------------------------------------------------- */

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<{ changed: boolean }> {
    const user = await this.findUserOrThrow(userId, 'changePassword')
    await this.verifyPasswordOrThrow(user, dto.currentPassword, 'changePassword')

    const hashedPassword = await bcrypt.hash(dto.newPassword, BCRYPT_SALT_ROUNDS)
    await this.usersRepository.updatePasswordHash(userId, hashedPassword)

    this.logger.log(`Password changed for user ${userId}`)
    this.logSuccess('changePassword', userId, user.email)
    return { changed: true }
  }

  /* ---------------------------------------------------------------- */
  /* GET PREFERENCES                                                   */
  /* ---------------------------------------------------------------- */

  async getPreferences(
    userId: string
  ): Promise<UserPreference | (typeof DEFAULT_PREFERENCES & { userId: string })> {
    const user = await this.findUserOrThrow(userId, 'getPreferences')
    const preference = await this.usersRepository.findPreference(userId)
    this.logSuccess('getPreferences', userId, user.email)
    return preference ?? { userId, ...DEFAULT_PREFERENCES }
  }

  /* ---------------------------------------------------------------- */
  /* UPDATE PREFERENCES                                                */
  /* ---------------------------------------------------------------- */

  async updatePreferences(userId: string, dto: UpdatePreferencesDto): Promise<UserPreference> {
    const user = await this.findUserOrThrow(userId, 'updatePreferences')

    const preference = await this.usersRepository.upsertPreference(
      userId,
      buildPreferenceUpdateData(dto),
      buildPreferenceCreateData(dto)
    )

    this.logger.log(`Preferences updated for user ${userId}`)
    this.logSuccess('updatePreferences', userId, user.email, undefined, {
      theme: dto.theme ?? null,
      language: dto.language ?? null,
    })
    return preference
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Finders                                                  */
  /* ---------------------------------------------------------------- */

  private async findUserOrThrow(userId: string, action: string): Promise<User> {
    const user = await this.usersRepository.findById(userId)
    if (!user) {
      this.logWarn(action, userId)
      throw new BusinessException(404, 'User not found', 'errors.users.notFound')
    }
    return user
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Password Verification                                    */
  /* ---------------------------------------------------------------- */

  private async verifyPasswordOrThrow(
    user: { id: string; email: string; passwordHash: string | null },
    password: string,
    action: string
  ): Promise<void> {
    if (!user.passwordHash) {
      this.logDenied(action, user.id, user.email)
      throw new BusinessException(400, 'Incorrect password', 'errors.users.incorrectPassword')
    }
    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      this.logDenied(action, user.id, user.email)
      throw new BusinessException(400, 'Incorrect password', 'errors.users.incorrectPassword')
    }
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Logging                                                  */
  /* ---------------------------------------------------------------- */

  private logSuccess(
    action: string,
    userId: string,
    email?: string,
    tenantId?: string,
    metadata?: Record<string, unknown>
  ): void {
    this.appLogger.info(`Users ${action}`, {
      feature: AppLogFeature.USERS,
      action,
      outcome: AppLogOutcome.SUCCESS,
      actorUserId: userId,
      actorEmail: email,
      tenantId,
      targetResource: 'User',
      targetResourceId: userId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'UsersService',
      functionName: action,
      metadata,
    })
  }

  private logWarn(action: string, userId: string, tenantId?: string): void {
    this.appLogger.warn(`Users ${action} failed`, {
      feature: AppLogFeature.USERS,
      action,
      outcome: AppLogOutcome.FAILURE,
      actorUserId: userId,
      tenantId,
      targetResource: 'User',
      targetResourceId: userId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'UsersService',
      functionName: action,
    })
  }

  private logDenied(action: string, userId: string, email: string): void {
    this.appLogger.warn(`Users ${action} denied`, {
      feature: AppLogFeature.USERS,
      action,
      outcome: AppLogOutcome.DENIED,
      actorUserId: userId,
      actorEmail: email,
      targetResource: 'User',
      targetResourceId: userId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'UsersService',
      functionName: action,
    })
  }
}
