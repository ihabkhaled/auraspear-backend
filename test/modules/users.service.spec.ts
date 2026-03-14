jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}))

import * as bcrypt from 'bcryptjs'
import { BusinessException } from '../../src/common/exceptions/business.exception'
import { UsersService } from '../../src/modules/users/users.service'

const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>

const mockAppLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

function createMockPrisma() {
  return {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    userPreference: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  }
}

const USER_ID = 'user-001'
const TENANT_ID = 'tenant-001'

const mockTenant = {
  id: TENANT_ID,
  name: 'AuraSpear',
  slug: 'auraspear',
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
}

const mockPreference = {
  id: 'pref-001',
  userId: USER_ID,
  theme: 'dark',
  language: 'en',
  notificationsEmail: true,
  notificationsInApp: false,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
}

const mockUserWithMemberships = {
  id: USER_ID,
  email: 'analyst@auraspear.com',
  name: 'John Analyst',
  passwordHash: '$2a$12$hashedpassword',
  status: 'active',
  role: 'ANALYST',
  isProtected: false,
  avatarUrl: null,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  preference: mockPreference,
  memberships: [{ tenant: mockTenant }],
}

const mockUserPlain = {
  id: USER_ID,
  email: 'analyst@auraspear.com',
  name: 'John Analyst',
  passwordHash: '$2a$12$hashedpassword',
  status: 'active',
  role: 'ANALYST',
  isProtected: false,
  avatarUrl: null,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
}

describe('UsersService', () => {
  let service: UsersService
  let prisma: ReturnType<typeof createMockPrisma>

  beforeEach(() => {
    prisma = createMockPrisma()
    service = new UsersService(prisma as never, mockAppLogger as never)
    jest.clearAllMocks()
  })

  /* ------------------------------------------------------------------ */
  /* getProfile                                                          */
  /* ------------------------------------------------------------------ */

  describe('getProfile', () => {
    it('should return profile with tenant and preference, excluding passwordHash', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUserWithMemberships)

      const result = await service.getProfile(USER_ID, TENANT_ID)

      expect(result).toEqual(
        expect.objectContaining({
          id: USER_ID,
          email: 'analyst@auraspear.com',
          name: 'John Analyst',
          tenant: mockTenant,
          preference: mockPreference,
        })
      )
      expect(result).not.toHaveProperty('passwordHash')
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: USER_ID },
        include: {
          preference: true,
          memberships: { where: { tenantId: TENANT_ID }, include: { tenant: true }, take: 1 },
        },
      })
    })

    it('should return first membership tenant when tenantId is not provided', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUserWithMemberships)

      const result = await service.getProfile(USER_ID)

      expect(result.tenant).toEqual(mockTenant)
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: USER_ID },
        include: {
          preference: true,
          memberships: { include: { tenant: true }, take: 1 },
        },
      })
    })

    it('should return null tenant when user has no memberships', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUserWithMemberships,
        memberships: [],
      })

      const result = await service.getProfile(USER_ID)

      expect(result.tenant).toBeNull()
    })

    it('should throw 404 when user is not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null)

      await expect(service.getProfile(USER_ID, TENANT_ID)).rejects.toThrow(BusinessException)
      await expect(service.getProfile(USER_ID, TENANT_ID)).rejects.toMatchObject({
        messageKey: 'errors.users.notFound',
      })
    })

    it('should log warning when user is not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null)

      await expect(service.getProfile(USER_ID)).rejects.toThrow()
      expect(mockAppLogger.warn).toHaveBeenCalled()
    })

    it('should log info on successful profile retrieval', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUserWithMemberships)

      await service.getProfile(USER_ID)

      expect(mockAppLogger.info).toHaveBeenCalled()
    })
  })

  /* ------------------------------------------------------------------ */
  /* updateProfile                                                       */
  /* ------------------------------------------------------------------ */

  describe('updateProfile', () => {
    const updateDto = { name: 'Updated Name', currentPassword: 'correct-password' }

    it('should update name when password is correct', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUserPlain)
      mockedBcrypt.compare.mockResolvedValue(true as never)

      const updatedUser = {
        ...mockUserPlain,
        name: 'Updated Name',
        preference: mockPreference,
        memberships: [{ tenant: mockTenant }],
      }
      prisma.user.update.mockResolvedValue(updatedUser)

      const result = await service.updateProfile(USER_ID, updateDto)

      expect(result.name).toBe('Updated Name')
      expect(result.tenant).toEqual(mockTenant)
      expect(result).not.toHaveProperty('passwordHash')
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { name: 'Updated Name' },
        include: {
          preference: true,
          memberships: { include: { tenant: true }, take: 1 },
        },
      })
    })

    it('should throw 404 when user is not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null)

      await expect(service.updateProfile(USER_ID, updateDto)).rejects.toThrow(BusinessException)
      await expect(service.updateProfile(USER_ID, updateDto)).rejects.toMatchObject({
        messageKey: 'errors.users.notFound',
      })
    })

    it('should throw 400 when user has no passwordHash (external auth)', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...mockUserPlain, passwordHash: null })

      await expect(service.updateProfile(USER_ID, updateDto)).rejects.toThrow(BusinessException)
      await expect(service.updateProfile(USER_ID, updateDto)).rejects.toMatchObject({
        messageKey: 'errors.users.incorrectPassword',
      })
    })

    it('should throw 400 when current password is incorrect', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUserPlain)
      mockedBcrypt.compare.mockResolvedValue(false as never)

      await expect(service.updateProfile(USER_ID, updateDto)).rejects.toThrow(BusinessException)
      await expect(service.updateProfile(USER_ID, updateDto)).rejects.toMatchObject({
        messageKey: 'errors.users.incorrectPassword',
      })
    })

    it('should return null tenant when updated user has no memberships', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUserPlain)
      mockedBcrypt.compare.mockResolvedValue(true as never)
      prisma.user.update.mockResolvedValue({
        ...mockUserPlain,
        name: 'Updated Name',
        preference: null,
        memberships: [],
      })

      const result = await service.updateProfile(USER_ID, updateDto)

      expect(result.tenant).toBeNull()
    })

    it('should call bcrypt.compare with the correct arguments', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUserPlain)
      mockedBcrypt.compare.mockResolvedValue(true as never)
      prisma.user.update.mockResolvedValue({
        ...mockUserPlain,
        preference: null,
        memberships: [],
      })

      await service.updateProfile(USER_ID, updateDto)

      expect(mockedBcrypt.compare).toHaveBeenCalledWith('correct-password', '$2a$12$hashedpassword')
    })
  })

  /* ------------------------------------------------------------------ */
  /* changePassword                                                      */
  /* ------------------------------------------------------------------ */

  describe('changePassword', () => {
    const changeDto = {
      currentPassword: 'OldPass1!',
      newPassword: 'NewPass1!',
      confirmPassword: 'NewPass1!',
    }

    it('should change password when current password is correct', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUserPlain)
      mockedBcrypt.compare.mockResolvedValue(true as never)
      mockedBcrypt.hash.mockResolvedValue('$2a$12$newhashedpassword' as never)
      prisma.user.update.mockResolvedValue({})

      const result = await service.changePassword(USER_ID, changeDto)

      expect(result).toEqual({ changed: true })
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { passwordHash: '$2a$12$newhashedpassword' },
      })
    })

    it('should hash new password with bcrypt using 12 salt rounds', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUserPlain)
      mockedBcrypt.compare.mockResolvedValue(true as never)
      mockedBcrypt.hash.mockResolvedValue('$2a$12$newhashedpassword' as never)
      prisma.user.update.mockResolvedValue({})

      await service.changePassword(USER_ID, changeDto)

      expect(mockedBcrypt.hash).toHaveBeenCalledWith('NewPass1!', 12)
    })

    it('should throw 404 when user is not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null)

      await expect(service.changePassword(USER_ID, changeDto)).rejects.toThrow(BusinessException)
      await expect(service.changePassword(USER_ID, changeDto)).rejects.toMatchObject({
        messageKey: 'errors.users.notFound',
      })
    })

    it('should throw 400 when user has no passwordHash', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...mockUserPlain, passwordHash: null })

      await expect(service.changePassword(USER_ID, changeDto)).rejects.toThrow(BusinessException)
      await expect(service.changePassword(USER_ID, changeDto)).rejects.toMatchObject({
        messageKey: 'errors.users.incorrectPassword',
      })
    })

    it('should throw 400 when current password is incorrect', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUserPlain)
      mockedBcrypt.compare.mockResolvedValue(false as never)

      await expect(service.changePassword(USER_ID, changeDto)).rejects.toThrow(BusinessException)
      await expect(service.changePassword(USER_ID, changeDto)).rejects.toMatchObject({
        messageKey: 'errors.users.incorrectPassword',
      })
    })

    it('should call bcrypt.compare with current password and stored hash', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUserPlain)
      mockedBcrypt.compare.mockResolvedValue(false as never)

      await expect(service.changePassword(USER_ID, changeDto)).rejects.toThrow()

      expect(mockedBcrypt.compare).toHaveBeenCalledWith('OldPass1!', '$2a$12$hashedpassword')
    })

    it('should log warning when password change is denied', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUserPlain)
      mockedBcrypt.compare.mockResolvedValue(false as never)

      await expect(service.changePassword(USER_ID, changeDto)).rejects.toThrow()

      expect(mockAppLogger.warn).toHaveBeenCalled()
    })

    it('should log info on successful password change', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUserPlain)
      mockedBcrypt.compare.mockResolvedValue(true as never)
      mockedBcrypt.hash.mockResolvedValue('$2a$12$newhashedpassword' as never)
      prisma.user.update.mockResolvedValue({})

      await service.changePassword(USER_ID, changeDto)

      expect(mockAppLogger.info).toHaveBeenCalled()
    })
  })

  /* ------------------------------------------------------------------ */
  /* getPreferences                                                      */
  /* ------------------------------------------------------------------ */

  describe('getPreferences', () => {
    it('should return existing preferences', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUserPlain)
      prisma.userPreference.findUnique.mockResolvedValue(mockPreference)

      const result = await service.getPreferences(USER_ID)

      expect(result).toEqual(mockPreference)
      expect(prisma.userPreference.findUnique).toHaveBeenCalledWith({ where: { userId: USER_ID } })
    })

    it('should return default preferences when none exist', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUserPlain)
      prisma.userPreference.findUnique.mockResolvedValue(null)

      const result = await service.getPreferences(USER_ID)

      expect(result).toEqual({
        userId: USER_ID,
        theme: 'system',
        language: 'en',
        notificationsEmail: true,
        notificationsInApp: true,
      })
    })

    it('should throw 404 when user is not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null)

      await expect(service.getPreferences(USER_ID)).rejects.toThrow(BusinessException)
      await expect(service.getPreferences(USER_ID)).rejects.toMatchObject({
        messageKey: 'errors.users.notFound',
      })
    })

    it('should log warning when user is not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null)

      await expect(service.getPreferences(USER_ID)).rejects.toThrow()

      expect(mockAppLogger.warn).toHaveBeenCalled()
    })

    it('should log info on successful preference retrieval', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUserPlain)
      prisma.userPreference.findUnique.mockResolvedValue(mockPreference)

      await service.getPreferences(USER_ID)

      expect(mockAppLogger.info).toHaveBeenCalled()
    })
  })

  /* ------------------------------------------------------------------ */
  /* updatePreferences                                                   */
  /* ------------------------------------------------------------------ */

  describe('updatePreferences', () => {
    const fullDto = {
      theme: 'dark' as const,
      language: 'fr' as const,
      notificationsEmail: false,
      notificationsInApp: true,
    }

    it('should upsert preferences with all fields', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUserPlain)
      prisma.userPreference.upsert.mockResolvedValue({
        ...mockPreference,
        ...fullDto,
      })

      const result = await service.updatePreferences(USER_ID, fullDto)

      expect(result.theme).toBe('dark')
      expect(result.language).toBe('fr')
      expect(result.notificationsEmail).toBe(false)
      expect(result.notificationsInApp).toBe(true)
      expect(prisma.userPreference.upsert).toHaveBeenCalledWith({
        where: { userId: USER_ID },
        update: {
          theme: 'dark',
          language: 'fr',
          notificationsEmail: false,
          notificationsInApp: true,
        },
        create: {
          userId: USER_ID,
          theme: 'dark',
          language: 'fr',
          notificationsEmail: false,
          notificationsInApp: true,
        },
      })
    })

    it('should throw 404 when user is not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null)

      await expect(service.updatePreferences(USER_ID, fullDto)).rejects.toThrow(BusinessException)
      await expect(service.updatePreferences(USER_ID, fullDto)).rejects.toMatchObject({
        messageKey: 'errors.users.notFound',
      })
    })

    it('should handle partial update with only theme', async () => {
      const partialDto = { theme: 'light' as const }
      prisma.user.findUnique.mockResolvedValue(mockUserPlain)
      prisma.userPreference.upsert.mockResolvedValue({
        ...mockPreference,
        theme: 'light',
      })

      await service.updatePreferences(USER_ID, partialDto)

      expect(prisma.userPreference.upsert).toHaveBeenCalledWith({
        where: { userId: USER_ID },
        update: {
          theme: 'light',
        },
        create: {
          userId: USER_ID,
          theme: 'light',
          language: 'en',
          notificationsEmail: true,
          notificationsInApp: true,
        },
      })
    })

    it('should handle partial update with only language', async () => {
      const partialDto = { language: 'ar' as const }
      prisma.user.findUnique.mockResolvedValue(mockUserPlain)
      prisma.userPreference.upsert.mockResolvedValue({
        ...mockPreference,
        language: 'ar',
      })

      await service.updatePreferences(USER_ID, partialDto)

      expect(prisma.userPreference.upsert).toHaveBeenCalledWith({
        where: { userId: USER_ID },
        update: {
          language: 'ar',
        },
        create: {
          userId: USER_ID,
          theme: 'system',
          language: 'ar',
          notificationsEmail: true,
          notificationsInApp: true,
        },
      })
    })

    it('should handle partial update with only notification settings', async () => {
      const partialDto = { notificationsEmail: false }
      prisma.user.findUnique.mockResolvedValue(mockUserPlain)
      prisma.userPreference.upsert.mockResolvedValue({
        ...mockPreference,
        notificationsEmail: false,
      })

      await service.updatePreferences(USER_ID, partialDto)

      expect(prisma.userPreference.upsert).toHaveBeenCalledWith({
        where: { userId: USER_ID },
        update: {
          notificationsEmail: false,
        },
        create: {
          userId: USER_ID,
          theme: 'system',
          language: 'en',
          notificationsEmail: false,
          notificationsInApp: true,
        },
      })
    })

    it('should use default values in create when dto fields are not provided', async () => {
      const emptyDto = {}
      prisma.user.findUnique.mockResolvedValue(mockUserPlain)
      prisma.userPreference.upsert.mockResolvedValue(mockPreference)

      await service.updatePreferences(USER_ID, emptyDto)

      expect(prisma.userPreference.upsert).toHaveBeenCalledWith({
        where: { userId: USER_ID },
        update: {},
        create: {
          userId: USER_ID,
          theme: 'system',
          language: 'en',
          notificationsEmail: true,
          notificationsInApp: true,
        },
      })
    })

    it('should log info on successful preference update', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUserPlain)
      prisma.userPreference.upsert.mockResolvedValue(mockPreference)

      await service.updatePreferences(USER_ID, fullDto)

      expect(mockAppLogger.info).toHaveBeenCalled()
    })

    it('should log warning when user is not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null)

      await expect(service.updatePreferences(USER_ID, fullDto)).rejects.toThrow()

      expect(mockAppLogger.warn).toHaveBeenCalled()
    })
  })
})
