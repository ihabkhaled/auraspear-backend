import { Injectable, Logger } from '@nestjs/common'
import { CONFIGURABLE_ROLES, DEFAULT_PERMISSIONS } from './constants/default-permissions'
import { PERMISSION_DEFINITIONS } from './constants/permission-definitions'
import { PermissionCacheService } from './permission-cache.service'
import { RoleSettingsRepository } from './role-settings.repository'
import {
  ALL_PERMISSIONS,
  Permission,
  AppLogFeature,
  AppLogOutcome,
  AppLogSourceType,
} from '../../common/enums'
import { UserRole as UserRoleEnum } from '../../common/interfaces/authenticated-request.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import type { UserRole } from '@prisma/client'

@Injectable()
export class RoleSettingsService {
  private readonly logger = new Logger(RoleSettingsService.name)

  constructor(
    private readonly repository: RoleSettingsRepository,
    private readonly cache: PermissionCacheService,
    private readonly appLogger: AppLoggerService
  ) {}

  /* ---------------------------------------------------------------- */
  /* GET PERMISSION MATRIX                                             */
  /* ---------------------------------------------------------------- */

  async getPermissionMatrix(tenantId: string): Promise<Record<string, string[]>> {
    const records = await this.repository.findPermissionsByTenant(tenantId)

    const matrix = new Map<string, string[]>()

    for (const role of CONFIGURABLE_ROLES) {
      matrix.set(role, [])
    }

    for (const record of records) {
      const role = record.role as string
      const existing = matrix.get(role) ?? []
      existing.push(record.permissionKey)
      matrix.set(role, existing)
    }

    return Object.fromEntries(matrix)
  }

  /* ---------------------------------------------------------------- */
  /* UPDATE PERMISSION MATRIX                                          */
  /* ---------------------------------------------------------------- */

  async updatePermissionMatrix(
    tenantId: string,
    matrix: Record<string, string[]>,
    actorEmail: string,
    actorUserId: string
  ): Promise<Record<string, string[]>> {
    const allPermissionValues = new Set<string>(ALL_PERMISSIONS)
    const entries: Array<{ role: UserRole; permissionKey: string; allowed: boolean }> = []

    const matrixMap = new Map(Object.entries(matrix))

    for (const role of CONFIGURABLE_ROLES) {
      const allowedPermissions = new Set(matrixMap.get(role) ?? [])

      for (const permission of allPermissionValues) {
        entries.push({
          role: role as UserRole,
          permissionKey: permission,
          allowed: allowedPermissions.has(permission),
        })
      }
    }

    await this.repository.bulkUpsertPermissions(tenantId, entries)
    this.cache.invalidate(tenantId)

    this.appLogger.info('Permission matrix updated', {
      feature: AppLogFeature.AUTH,
      action: 'updatePermissionMatrix',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      actorEmail,
      actorUserId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'RoleSettingsService',
      functionName: 'updatePermissionMatrix',
    })

    return this.getPermissionMatrix(tenantId)
  }

  /* ---------------------------------------------------------------- */
  /* RESET TO DEFAULTS                                                 */
  /* ---------------------------------------------------------------- */

  async resetToDefaults(
    tenantId: string,
    actorEmail: string,
    actorUserId: string
  ): Promise<Record<string, string[]>> {
    await this.repository.deleteAllByTenant(tenantId)
    await this.seedDefaultsForTenant(tenantId)
    this.cache.invalidate(tenantId)

    this.appLogger.info('Permission matrix reset to defaults', {
      feature: AppLogFeature.AUTH,
      action: 'resetToDefaults',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      actorEmail,
      actorUserId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'RoleSettingsService',
      functionName: 'resetToDefaults',
    })

    return this.getPermissionMatrix(tenantId)
  }

  /* ---------------------------------------------------------------- */
  /* GET USER PERMISSIONS (used by PermissionsGuard + auth response)    */
  /* ---------------------------------------------------------------- */

  async getUserPermissions(tenantId: string, role: string): Promise<string[]> {
    // GLOBAL_ADMIN always has all permissions
    if (role === UserRoleEnum.GLOBAL_ADMIN) {
      return ALL_PERMISSIONS
    }

    // Check cache first
    const cached = this.cache.get(tenantId, role)
    if (cached) {
      return [...cached]
    }

    // Fetch from DB
    const records = await this.repository.findPermissionsByTenantAndRole(tenantId, role as UserRole)

    const permissions = records.map(r => r.permissionKey)
    this.cache.set(tenantId, role, new Set(permissions))

    return permissions
  }

  /* ---------------------------------------------------------------- */
  /* HAS PERMISSION (used by PermissionsGuard)                         */
  /* ---------------------------------------------------------------- */

  async hasPermission(tenantId: string, role: string, permission: Permission): Promise<boolean> {
    if (role === UserRoleEnum.GLOBAL_ADMIN) {
      return true
    }

    const userPermissions = await this.getUserPermissions(tenantId, role)
    return userPermissions.includes(permission)
  }

  /* ---------------------------------------------------------------- */
  /* SEED DEFAULTS                                                     */
  /* ---------------------------------------------------------------- */

  async seedDefaultsForTenant(tenantId: string): Promise<void> {
    const entries: Array<{ role: UserRole; permissionKey: string; allowed: boolean }> = []
    const allPermissionValues = ALL_PERMISSIONS

    const defaultPermissionsMap = new Map(Object.entries(DEFAULT_PERMISSIONS))

    for (const role of CONFIGURABLE_ROLES) {
      const allowedSet = new Set<string>(defaultPermissionsMap.get(role) ?? [])

      for (const permission of allPermissionValues) {
        entries.push({
          role: role as UserRole,
          permissionKey: permission,
          allowed: allowedSet.has(permission),
        })
      }
    }

    await this.repository.bulkUpsertPermissions(tenantId, entries)
    this.logger.log(`Seeded default permissions for tenant ${tenantId}`)
  }

  async seedAllTenants(): Promise<void> {
    const tenantIds = await this.repository.findAllTenantIds()

    const seedPromises = tenantIds.map(async tenantId => {
      const count = await this.repository.countByTenant(tenantId)
      if (count === 0) {
        await this.seedDefaultsForTenant(tenantId)
      }
    })
    await Promise.all(seedPromises)

    this.logger.log(`Seeded default permissions for ${tenantIds.length} tenants`)
  }

  /* ---------------------------------------------------------------- */
  /* PERMISSION DEFINITIONS (dynamic from DB)                          */
  /* ---------------------------------------------------------------- */

  /**
   * Returns permission definitions for a tenant.
   * Includes global defaults merged with any tenant-specific overrides.
   */
  async getPermissionDefinitions(
    tenantId: string
  ): Promise<Array<{ key: string; module: string; labelKey: string; sortOrder: number }>> {
    return this.repository.findPermissionDefinitions(tenantId)
  }

  /**
   * Seeds global (tenantId = null) permission definitions from the
   * static PERMISSION_DEFINITIONS constant. Run during database seeding.
   */
  async seedPermissionDefinitions(): Promise<void> {
    const upsertPromises = PERMISSION_DEFINITIONS.map(definition =>
      this.repository.upsertPermissionDefinition(
        null,
        definition.key,
        definition.module,
        definition.labelKey,
        definition.sortOrder
      )
    )
    await Promise.all(upsertPromises)

    this.logger.log(`Seeded ${PERMISSION_DEFINITIONS.length} permission definitions`)
  }
}
