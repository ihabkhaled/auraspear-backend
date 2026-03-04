import { Injectable, Logger } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { BusinessException } from '../../common/exceptions/business.exception'
import { PrismaService } from '../../prisma/prisma.service'
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

  constructor(private readonly prisma: PrismaService) {}

  /* ---------------------------------------------------------------- */
  /* GET PROFILE                                                       */
  /* ---------------------------------------------------------------- */

  async getProfile(userId: string, tenantId?: string): Promise<UserProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        preference: true,
        memberships: tenantId
          ? { where: { tenantId }, include: { tenant: true }, take: 1 }
          : { include: { tenant: true }, take: 1 },
      },
    })

    if (!user) {
      throw new BusinessException(404, 'User not found', 'errors.users.notFound')
    }

    const { passwordHash: _passwordHash, memberships, ...rest } = user
    const firstMembership = memberships[0]

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
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    })

    if (!user) {
      throw new BusinessException(404, 'User not found', 'errors.users.notFound')
    }

    if (!user.passwordHash) {
      throw new BusinessException(400, 'Incorrect password', 'errors.users.incorrectPassword')
    }

    const isPasswordValid = await bcrypt.compare(dto.currentPassword, user.passwordHash)
    if (!isPasswordValid) {
      throw new BusinessException(400, 'Incorrect password', 'errors.users.incorrectPassword')
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { name: dto.name },
      include: {
        preference: true,
        memberships: { include: { tenant: true }, take: 1 },
      },
    })

    const { passwordHash: _passwordHash, memberships, ...rest } = updated
    const firstMembership = memberships[0]

    this.logger.log(`Profile updated for user ${userId}`)
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
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    })

    if (!user) {
      throw new BusinessException(404, 'User not found', 'errors.users.notFound')
    }

    if (!user.passwordHash) {
      throw new BusinessException(400, 'Incorrect password', 'errors.users.incorrectPassword')
    }

    const isPasswordValid = await bcrypt.compare(dto.currentPassword, user.passwordHash)
    if (!isPasswordValid) {
      throw new BusinessException(400, 'Incorrect password', 'errors.users.incorrectPassword')
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, BCRYPT_SALT_ROUNDS)

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hashedPassword },
    })

    this.logger.log(`Password changed for user ${userId}`)
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
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    })

    if (!user) {
      throw new BusinessException(404, 'User not found', 'errors.users.notFound')
    }

    const preference = await this.prisma.userPreference.findUnique({
      where: { userId },
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
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    })

    if (!user) {
      throw new BusinessException(404, 'User not found', 'errors.users.notFound')
    }

    const preference = await this.prisma.userPreference.upsert({
      where: { userId },
      update: {
        ...(dto.theme !== undefined && { theme: dto.theme }),
        ...(dto.language !== undefined && { language: dto.language }),
        ...(dto.notificationsEmail !== undefined && { notificationsEmail: dto.notificationsEmail }),
        ...(dto.notificationsInApp !== undefined && { notificationsInApp: dto.notificationsInApp }),
      },
      create: {
        userId,
        theme: dto.theme ?? DEFAULT_PREFERENCES.theme,
        language: dto.language ?? DEFAULT_PREFERENCES.language,
        notificationsEmail: dto.notificationsEmail ?? DEFAULT_PREFERENCES.notificationsEmail,
        notificationsInApp: dto.notificationsInApp ?? DEFAULT_PREFERENCES.notificationsInApp,
      },
    })

    this.logger.log(`Preferences updated for user ${userId}`)
    return preference
  }
}
