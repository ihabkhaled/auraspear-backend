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

function createMockRepository() {
  return {
    findByIdWithPreferencesAndMemberships: jest.fn(),
    findById: jest.fn(),
    updateName: jest.fn(),
    updatePasswordHash: jest.fn(),
    findPreference: jest.fn(),
    upsertPreference: jest.fn(),
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
  let repository: ReturnType<typeof createMockRepository>

  beforeEach(() => {
    repository = createMockRepository()
    service = new UsersService(repository as never, mockAppLogger as never)
    jest.clearAllMocks()
  })

  /* ------------------------------------------------------------------ */
  /* getProfile                                                          */
  /* ------------------------------------------------------------------ */

  describe('getProfile', () => {
    it('should return profile with tenant and preference, excluding passwordHash', async () => {
      repository.findByIdWithPreferencesAndMemberships.mockResolvedValue(mockUserWithMemberships)

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
      expect(repository.findByIdWithPreferencesAndMemberships).toHaveBeenCalledWith(
        USER_ID,
        TENANT_ID
      )
    })

    it('should return first membership tenant when tenantId is not provided', async () => {
      repository.findByIdWithPreferencesAndMemberships.mockResolvedValue(mockUserWithMemberships)

      const result = await service.getProfile(USER_ID)

      expect(result.tenant).toEqual(mockTenant)
      expect(repository.findByIdWithPreferencesAndMemberships).toHaveBeenCalledWith(
        USER_ID,
        undefined
      )
    })

    it('should return null tenant when user has no memberships', async () => {
      repository.findByIdWithPreferencesAndMemberships.mockResolvedValue({
        ...mockUserWithMemberships,
        memberships: [],
      })

      const result = await service.getProfile(USER_ID)

      expect(result.tenant).toBeNull()
    })

    it('should throw 404 when user is not found', async () => {
      repository.findByIdWithPreferencesAndMemberships.mockResolvedValue(null)

      await expect(service.getProfile(USER_ID, TENANT_ID)).rejects.toThrow(BusinessException)
      await expect(service.getProfile(USER_ID, TENANT_ID)).rejects.toMatchObject({
        messageKey: 'errors.users.notFound',
      })
    })

    it('should log warning when user is not found', async () => {
      repository.findByIdWithPreferencesAndMemberships.mockResolvedValue(null)

      await expect(service.getProfile(USER_ID)).rejects.toThrow()
      expect(mockAppLogger.warn).toHaveBeenCalled()
    })

    it('should log info on successful profile retrieval', async () => {
      repository.findByIdWithPreferencesAndMemberships.mockResolvedValue(mockUserWithMemberships)

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
      repository.findById.mockResolvedValue(mockUserPlain)
      mockedBcrypt.compare.mockResolvedValue(true as never)

      const updatedUser = {
        ...mockUserPlain,
        name: 'Updated Name',
        preference: mockPreference,
        memberships: [{ tenant: mockTenant }],
      }
      repository.updateName.mockResolvedValue(updatedUser)

      const result = await service.updateProfile(USER_ID, updateDto)

      expect(result.name).toBe('Updated Name')
      expect(result.tenant).toEqual(mockTenant)
      expect(result).not.toHaveProperty('passwordHash')
      expect(repository.updateName).toHaveBeenCalledWith(USER_ID, 'Updated Name')
    })

    it('should throw 404 when user is not found', async () => {
      repository.findById.mockResolvedValue(null)

      await expect(service.updateProfile(USER_ID, updateDto)).rejects.toThrow(BusinessException)
      await expect(service.updateProfile(USER_ID, updateDto)).rejects.toMatchObject({
        messageKey: 'errors.users.notFound',
      })
    })

    it('should throw 400 when user has no passwordHash (external auth)', async () => {
      repository.findById.mockResolvedValue({ ...mockUserPlain, passwordHash: null })

      await expect(service.updateProfile(USER_ID, updateDto)).rejects.toThrow(BusinessException)
      await expect(service.updateProfile(USER_ID, updateDto)).rejects.toMatchObject({
        messageKey: 'errors.users.incorrectPassword',
      })
    })

    it('should throw 400 when current password is incorrect', async () => {
      repository.findById.mockResolvedValue(mockUserPlain)
      mockedBcrypt.compare.mockResolvedValue(false as never)

      await expect(service.updateProfile(USER_ID, updateDto)).rejects.toThrow(BusinessException)
      await expect(service.updateProfile(USER_ID, updateDto)).rejects.toMatchObject({
        messageKey: 'errors.users.incorrectPassword',
      })
    })

    it('should return null tenant when updated user has no memberships', async () => {
      repository.findById.mockResolvedValue(mockUserPlain)
      mockedBcrypt.compare.mockResolvedValue(true as never)
      repository.updateName.mockResolvedValue({
        ...mockUserPlain,
        name: 'Updated Name',
        preference: null,
        memberships: [],
      })

      const result = await service.updateProfile(USER_ID, updateDto)

      expect(result.tenant).toBeNull()
    })

    it('should call bcrypt.compare with the correct arguments', async () => {
      repository.findById.mockResolvedValue(mockUserPlain)
      mockedBcrypt.compare.mockResolvedValue(true as never)
      repository.updateName.mockResolvedValue({
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
      repository.findById.mockResolvedValue(mockUserPlain)
      mockedBcrypt.compare.mockResolvedValue(true as never)
      mockedBcrypt.hash.mockResolvedValue('$2a$12$newhashedpassword' as never)

      const result = await service.changePassword(USER_ID, changeDto)

      expect(result).toEqual({ changed: true })
      expect(repository.updatePasswordHash).toHaveBeenCalledWith(
        USER_ID,
        '$2a$12$newhashedpassword'
      )
    })

    it('should hash new password with bcrypt using 12 salt rounds', async () => {
      repository.findById.mockResolvedValue(mockUserPlain)
      mockedBcrypt.compare.mockResolvedValue(true as never)
      mockedBcrypt.hash.mockResolvedValue('$2a$12$newhashedpassword' as never)

      await service.changePassword(USER_ID, changeDto)

      expect(mockedBcrypt.hash).toHaveBeenCalledWith('NewPass1!', 12)
    })

    it('should throw 404 when user is not found', async () => {
      repository.findById.mockResolvedValue(null)

      await expect(service.changePassword(USER_ID, changeDto)).rejects.toThrow(BusinessException)
      await expect(service.changePassword(USER_ID, changeDto)).rejects.toMatchObject({
        messageKey: 'errors.users.notFound',
      })
    })

    it('should throw 400 when user has no passwordHash', async () => {
      repository.findById.mockResolvedValue({ ...mockUserPlain, passwordHash: null })

      await expect(service.changePassword(USER_ID, changeDto)).rejects.toThrow(BusinessException)
      await expect(service.changePassword(USER_ID, changeDto)).rejects.toMatchObject({
        messageKey: 'errors.users.incorrectPassword',
      })
    })

    it('should throw 400 when current password is incorrect', async () => {
      repository.findById.mockResolvedValue(mockUserPlain)
      mockedBcrypt.compare.mockResolvedValue(false as never)

      await expect(service.changePassword(USER_ID, changeDto)).rejects.toThrow(BusinessException)
      await expect(service.changePassword(USER_ID, changeDto)).rejects.toMatchObject({
        messageKey: 'errors.users.incorrectPassword',
      })
    })

    it('should call bcrypt.compare with current password and stored hash', async () => {
      repository.findById.mockResolvedValue(mockUserPlain)
      mockedBcrypt.compare.mockResolvedValue(false as never)

      await expect(service.changePassword(USER_ID, changeDto)).rejects.toThrow()

      expect(mockedBcrypt.compare).toHaveBeenCalledWith('OldPass1!', '$2a$12$hashedpassword')
    })

    it('should log warning when password change is denied', async () => {
      repository.findById.mockResolvedValue(mockUserPlain)
      mockedBcrypt.compare.mockResolvedValue(false as never)

      await expect(service.changePassword(USER_ID, changeDto)).rejects.toThrow()

      expect(mockAppLogger.warn).toHaveBeenCalled()
    })

    it('should log info on successful password change', async () => {
      repository.findById.mockResolvedValue(mockUserPlain)
      mockedBcrypt.compare.mockResolvedValue(true as never)
      mockedBcrypt.hash.mockResolvedValue('$2a$12$newhashedpassword' as never)

      await service.changePassword(USER_ID, changeDto)

      expect(mockAppLogger.info).toHaveBeenCalled()
    })
  })

  /* ------------------------------------------------------------------ */
  /* getPreferences                                                      */
  /* ------------------------------------------------------------------ */

  describe('getPreferences', () => {
    it('should return existing preferences', async () => {
      repository.findById.mockResolvedValue(mockUserPlain)
      repository.findPreference.mockResolvedValue(mockPreference)

      const result = await service.getPreferences(USER_ID)

      expect(result).toEqual(mockPreference)
      expect(repository.findPreference).toHaveBeenCalledWith(USER_ID)
    })

    it('should return default preferences when none exist', async () => {
      repository.findById.mockResolvedValue(mockUserPlain)
      repository.findPreference.mockResolvedValue(null)

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
      repository.findById.mockResolvedValue(null)

      await expect(service.getPreferences(USER_ID)).rejects.toThrow(BusinessException)
      await expect(service.getPreferences(USER_ID)).rejects.toMatchObject({
        messageKey: 'errors.users.notFound',
      })
    })

    it('should log warning when user is not found', async () => {
      repository.findById.mockResolvedValue(null)

      await expect(service.getPreferences(USER_ID)).rejects.toThrow()

      expect(mockAppLogger.warn).toHaveBeenCalled()
    })

    it('should log info on successful preference retrieval', async () => {
      repository.findById.mockResolvedValue(mockUserPlain)
      repository.findPreference.mockResolvedValue(mockPreference)

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
      repository.findById.mockResolvedValue(mockUserPlain)
      repository.upsertPreference.mockResolvedValue({
        ...mockPreference,
        ...fullDto,
      })

      const result = await service.updatePreferences(USER_ID, fullDto)

      expect(result.theme).toBe('dark')
      expect(result.language).toBe('fr')
      expect(result.notificationsEmail).toBe(false)
      expect(result.notificationsInApp).toBe(true)
      expect(repository.upsertPreference).toHaveBeenCalledWith(
        USER_ID,
        {
          theme: 'dark',
          language: 'fr',
          notificationsEmail: false,
          notificationsInApp: true,
        },
        {
          theme: 'dark',
          language: 'fr',
          notificationsEmail: false,
          notificationsInApp: true,
        }
      )
    })

    it('should throw 404 when user is not found', async () => {
      repository.findById.mockResolvedValue(null)

      await expect(service.updatePreferences(USER_ID, fullDto)).rejects.toThrow(BusinessException)
      await expect(service.updatePreferences(USER_ID, fullDto)).rejects.toMatchObject({
        messageKey: 'errors.users.notFound',
      })
    })

    it('should handle partial update with only theme', async () => {
      const partialDto = { theme: 'light' as const }
      repository.findById.mockResolvedValue(mockUserPlain)
      repository.upsertPreference.mockResolvedValue({
        ...mockPreference,
        theme: 'light',
      })

      await service.updatePreferences(USER_ID, partialDto)

      expect(repository.upsertPreference).toHaveBeenCalledWith(
        USER_ID,
        {
          theme: 'light',
        },
        {
          theme: 'light',
          language: 'en',
          notificationsEmail: true,
          notificationsInApp: true,
        }
      )
    })

    it('should handle partial update with only language', async () => {
      const partialDto = { language: 'ar' as const }
      repository.findById.mockResolvedValue(mockUserPlain)
      repository.upsertPreference.mockResolvedValue({
        ...mockPreference,
        language: 'ar',
      })

      await service.updatePreferences(USER_ID, partialDto)

      expect(repository.upsertPreference).toHaveBeenCalledWith(
        USER_ID,
        {
          language: 'ar',
        },
        {
          theme: 'system',
          language: 'ar',
          notificationsEmail: true,
          notificationsInApp: true,
        }
      )
    })

    it('should handle partial update with only notification settings', async () => {
      const partialDto = { notificationsEmail: false }
      repository.findById.mockResolvedValue(mockUserPlain)
      repository.upsertPreference.mockResolvedValue({
        ...mockPreference,
        notificationsEmail: false,
      })

      await service.updatePreferences(USER_ID, partialDto)

      expect(repository.upsertPreference).toHaveBeenCalledWith(
        USER_ID,
        {
          notificationsEmail: false,
        },
        {
          theme: 'system',
          language: 'en',
          notificationsEmail: false,
          notificationsInApp: true,
        }
      )
    })

    it('should use default values in create when dto fields are not provided', async () => {
      const emptyDto = {}
      repository.findById.mockResolvedValue(mockUserPlain)
      repository.upsertPreference.mockResolvedValue(mockPreference)

      await service.updatePreferences(USER_ID, emptyDto)

      expect(repository.upsertPreference).toHaveBeenCalledWith(
        USER_ID,
        {},
        {
          theme: 'system',
          language: 'en',
          notificationsEmail: true,
          notificationsInApp: true,
        }
      )
    })

    it('should log info on successful preference update', async () => {
      repository.findById.mockResolvedValue(mockUserPlain)
      repository.upsertPreference.mockResolvedValue(mockPreference)

      await service.updatePreferences(USER_ID, fullDto)

      expect(mockAppLogger.info).toHaveBeenCalled()
    })

    it('should log warning when user is not found', async () => {
      repository.findById.mockResolvedValue(null)

      await expect(service.updatePreferences(USER_ID, fullDto)).rejects.toThrow()

      expect(mockAppLogger.warn).toHaveBeenCalled()
    })
  })
})
