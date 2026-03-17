import { ALL_PERMISSIONS, Permission } from '../../src/common/enums/permission.enum'
import { UserRole } from '../../src/common/interfaces/authenticated-request.interface'
import { CONFIGURABLE_ROLES } from '../../src/modules/role-settings/constants/default-permissions'
import { RoleSettingsService } from '../../src/modules/role-settings/role-settings.service'

const TENANT_ID = 'tenant-001'

function createMockRepository() {
  return {
    findPermissionsByTenant: jest.fn(),
    findPermissionsByTenantAndRole: jest.fn(),
    bulkUpsertPermissions: jest.fn(),
    deleteAllByTenant: jest.fn(),
    countByTenant: jest.fn(),
    findAllTenantIds: jest.fn(),
    upsertPermissionDefinition: jest.fn(),
    findPermissionDefinitions: jest.fn(),
  }
}

function createMockCache() {
  return {
    get: jest.fn().mockReturnValue(null),
    set: jest.fn(),
    invalidate: jest.fn(),
    invalidateAll: jest.fn(),
  }
}

const mockAppLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

describe('RoleSettingsService', () => {
  let service: RoleSettingsService
  let repository: ReturnType<typeof createMockRepository>
  let cache: ReturnType<typeof createMockCache>

  beforeEach(() => {
    repository = createMockRepository()
    cache = createMockCache()
    service = new RoleSettingsService(repository as never, cache as never, mockAppLogger as never)
  })

  /* ---------------------------------------------------------------- */
  /* getPermissionMatrix                                                */
  /* ---------------------------------------------------------------- */

  describe('getPermissionMatrix', () => {
    it('should return a matrix with all configurable roles as keys', async () => {
      repository.findPermissionsByTenant.mockResolvedValue([])

      const matrix = await service.getPermissionMatrix(TENANT_ID)

      for (const role of CONFIGURABLE_ROLES) {
        expect(matrix).toHaveProperty(role)
        expect(Array.isArray(matrix[role])).toBe(true)
      }
    })

    it('should populate permissions from DB records into the correct role', async () => {
      repository.findPermissionsByTenant.mockResolvedValue([
        { role: UserRole.TENANT_ADMIN, permissionKey: Permission.ALERTS_VIEW },
        { role: UserRole.TENANT_ADMIN, permissionKey: Permission.CASES_VIEW },
        { role: UserRole.SOC_ANALYST_L1, permissionKey: Permission.DASHBOARD_VIEW },
      ])

      const matrix = await service.getPermissionMatrix(TENANT_ID)

      expect(matrix[UserRole.TENANT_ADMIN]).toContain(Permission.ALERTS_VIEW)
      expect(matrix[UserRole.TENANT_ADMIN]).toContain(Permission.CASES_VIEW)
      expect(matrix[UserRole.SOC_ANALYST_L1]).toContain(Permission.DASHBOARD_VIEW)
      expect(matrix[UserRole.SOC_ANALYST_L2]).toEqual([])
    })

    it('should return empty arrays when DB has no records', async () => {
      repository.findPermissionsByTenant.mockResolvedValue([])

      const matrix = await service.getPermissionMatrix(TENANT_ID)

      for (const role of CONFIGURABLE_ROLES) {
        expect(matrix[role]).toEqual([])
      }
    })
  })

  /* ---------------------------------------------------------------- */
  /* getUserPermissions                                                 */
  /* ---------------------------------------------------------------- */

  describe('getUserPermissions', () => {
    it('should return ALL_PERMISSIONS for GLOBAL_ADMIN', async () => {
      const permissions = await service.getUserPermissions(TENANT_ID, UserRole.GLOBAL_ADMIN)

      expect(permissions).toEqual(ALL_PERMISSIONS)
      expect(repository.findPermissionsByTenantAndRole).not.toHaveBeenCalled()
      expect(cache.get).not.toHaveBeenCalled()
    })

    it('should return cached permissions when available', async () => {
      const cachedSet = new Set([Permission.ALERTS_VIEW, Permission.DASHBOARD_VIEW])
      cache.get.mockReturnValue(cachedSet)

      const permissions = await service.getUserPermissions(TENANT_ID, UserRole.SOC_ANALYST_L1)

      expect(permissions).toEqual([...cachedSet])
      expect(repository.findPermissionsByTenantAndRole).not.toHaveBeenCalled()
    })

    it('should fetch from DB and cache when cache is empty', async () => {
      cache.get.mockReturnValue(null)
      repository.findPermissionsByTenantAndRole.mockResolvedValue([
        { permissionKey: Permission.ALERTS_VIEW },
        { permissionKey: Permission.CASES_VIEW },
      ])

      const permissions = await service.getUserPermissions(TENANT_ID, UserRole.SOC_ANALYST_L1)

      expect(permissions).toEqual([Permission.ALERTS_VIEW, Permission.CASES_VIEW])
      expect(cache.set).toHaveBeenCalledWith(
        TENANT_ID,
        UserRole.SOC_ANALYST_L1,
        new Set([Permission.ALERTS_VIEW, Permission.CASES_VIEW])
      )
    })

    it('should return empty array when user has no permissions in DB', async () => {
      cache.get.mockReturnValue(null)
      repository.findPermissionsByTenantAndRole.mockResolvedValue([])

      const permissions = await service.getUserPermissions(TENANT_ID, UserRole.EXECUTIVE_READONLY)

      expect(permissions).toEqual([])
    })
  })

  /* ---------------------------------------------------------------- */
  /* hasPermission                                                      */
  /* ---------------------------------------------------------------- */

  describe('hasPermission', () => {
    it('should return true for GLOBAL_ADMIN regardless of permission', async () => {
      const result = await service.hasPermission(
        TENANT_ID,
        UserRole.GLOBAL_ADMIN,
        Permission.ADMIN_TENANTS_DELETE
      )
      expect(result).toBe(true)
    })

    it('should return true when user has the permission', async () => {
      cache.get.mockReturnValue(null)
      repository.findPermissionsByTenantAndRole.mockResolvedValue([
        { permissionKey: Permission.ALERTS_VIEW },
      ])

      const result = await service.hasPermission(
        TENANT_ID,
        UserRole.SOC_ANALYST_L1,
        Permission.ALERTS_VIEW
      )
      expect(result).toBe(true)
    })

    it('should return false when user lacks the permission', async () => {
      cache.get.mockReturnValue(null)
      repository.findPermissionsByTenantAndRole.mockResolvedValue([
        { permissionKey: Permission.ALERTS_VIEW },
      ])

      const result = await service.hasPermission(
        TENANT_ID,
        UserRole.SOC_ANALYST_L1,
        Permission.ADMIN_TENANTS_DELETE
      )
      expect(result).toBe(false)
    })
  })

  /* ---------------------------------------------------------------- */
  /* resetToDefaults                                                    */
  /* ---------------------------------------------------------------- */

  describe('resetToDefaults', () => {
    it('should delete existing, re-seed, and invalidate cache', async () => {
      repository.deleteAllByTenant.mockResolvedValue({ count: 10 })
      repository.bulkUpsertPermissions.mockResolvedValue(undefined)
      repository.findPermissionsByTenant.mockResolvedValue([])

      await service.resetToDefaults(TENANT_ID, 'admin@test.com', 'admin-001')

      expect(repository.deleteAllByTenant).toHaveBeenCalledWith(TENANT_ID)
      expect(repository.bulkUpsertPermissions).toHaveBeenCalled()
      expect(cache.invalidate).toHaveBeenCalledWith(TENANT_ID)
    })
  })

  /* ---------------------------------------------------------------- */
  /* seedDefaultsForTenant                                              */
  /* ---------------------------------------------------------------- */

  describe('seedDefaultsForTenant', () => {
    it('should call bulkUpsertPermissions with entries for all configurable roles', async () => {
      repository.bulkUpsertPermissions.mockResolvedValue(undefined)

      await service.seedDefaultsForTenant(TENANT_ID)

      expect(repository.bulkUpsertPermissions).toHaveBeenCalledTimes(1)
      const entries = repository.bulkUpsertPermissions.mock.calls[0][1] as Array<{
        role: string
        permissionKey: string
        allowed: boolean
      }>

      // Each configurable role should have an entry for each permission
      const expectedEntryCount = CONFIGURABLE_ROLES.length * ALL_PERMISSIONS.length
      expect(entries).toHaveLength(expectedEntryCount)
    })
  })
})
