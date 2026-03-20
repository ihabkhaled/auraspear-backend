import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common'
import { CONFIGURABLE_ROLES, DEFAULT_PERMISSIONS } from './constants/default-permissions'
import { PERMISSION_DEFINITIONS } from './constants/permission-definitions'
import {
  ROLE_SETTINGS_MODULE,
  TENANT_ADMIN_PROTECTED_PERMISSIONS,
} from './constants/role-settings.constants'
import { PermissionCacheService } from './permission-cache.service'
import { RoleSettingsRepository } from './role-settings.repository'
import {
  ALL_PERMISSIONS,
  Permission,
  AppLogFeature,
  AppLogOutcome,
  AppLogSourceType,
} from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { UserRole as UserRoleEnum } from '../../common/interfaces/authenticated-request.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import { PermissionUpdateReason } from '../notifications/notifications.enums'
import { NotificationsService } from '../notifications/notifications.service'
import {
  USERS_CONTROL_ASSIGNABLE_ROLES,
  USERS_CONTROL_PERMISSION_KEYS,
} from '../users-control/users-control.constants'
import type { UserRole } from '@prisma/client'

@Injectable()
export class RoleSettingsService {
  private readonly logger = new Logger(RoleSettingsService.name)

  constructor(
    private readonly repository: RoleSettingsRepository,
    private readonly cache: PermissionCacheService,
    private readonly appLogger: AppLoggerService,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService
  ) {}

  private normalizePermissions(permissions: string[]): string[] {
    return [...permissions].sort((left, right) => left.localeCompare(right))
  }

  private toPermissionMatrixMap(matrix: Record<string, string[]>): Map<string, string[]> {
    return new Map(Object.entries(matrix))
  }

  private getImpactedRoles(
    currentMatrix: Record<string, string[]>,
    nextMatrix: Record<string, string[]>
  ): UserRole[] {
    const impactedRoles: UserRole[] = []
    const currentMatrixMap = this.toPermissionMatrixMap(currentMatrix)
    const nextMatrixMap = this.toPermissionMatrixMap(nextMatrix)

    for (const role of CONFIGURABLE_ROLES) {
      const currentPermissions = JSON.stringify(
        this.normalizePermissions(currentMatrixMap.get(role) ?? [])
      )
      const nextPermissions = JSON.stringify(
        this.normalizePermissions(nextMatrixMap.get(role) ?? [])
      )

      if (currentPermissions !== nextPermissions) {
        impactedRoles.push(role as UserRole)
      }
    }

    return impactedRoles
  }

  private async emitRoleMatrixPermissionChanges(
    tenantId: string,
    impactedRoles: UserRole[]
  ): Promise<void> {
    if (impactedRoles.length === 0) {
      return
    }

    const userIds = await this.repository.findActiveUserIdsByRoles(tenantId, impactedRoles)
    this.notificationsService.emitPermissionsUpdatedToUsers(
      tenantId,
      userIds,
      PermissionUpdateReason.ROLE_MATRIX_UPDATED
    )
  }

  private buildDefaultAllowedPermissionEntries(): Array<{
    role: UserRole
    permissionKey: string
    allowed: boolean
  }> {
    const entries: Array<{ role: UserRole; permissionKey: string; allowed: boolean }> = []

    for (const role of CONFIGURABLE_ROLES) {
      const permissions = (Reflect.get(DEFAULT_PERMISSIONS, role) as string[] | undefined) ?? []

      for (const permissionKey of permissions) {
        entries.push({
          role: role as UserRole,
          permissionKey,
          allowed: true,
        })
      }
    }

    return entries
  }

  private async ensurePermissionDefinitionsInitialized(): Promise<void> {
    const definitionChecks = await Promise.all(
      USERS_CONTROL_PERMISSION_KEYS.map(permissionKey =>
        this.repository.hasPermissionDefinition(null, permissionKey)
      )
    )

    if (definitionChecks.every(Boolean)) {
      return
    }

    await this.seedPermissionDefinitions()
  }

  private async ensureTenantDefaultPermissionsInitialized(tenantId: string): Promise<void> {
    const permissionChecks = await Promise.all(
      USERS_CONTROL_PERMISSION_KEYS.map(permissionKey =>
        this.repository.hasPermissionByTenantAndRole(
          tenantId,
          UserRoleEnum.TENANT_ADMIN as UserRole,
          permissionKey
        )
      )
    )

    if (permissionChecks.every(Boolean)) {
      return
    }

    await this.repository.bulkCreatePermissions(
      tenantId,
      this.buildDefaultAllowedPermissionEntries()
    )
    this.cache.invalidate(tenantId)
  }

  private async assertProtectedRoleSettingsPermissionsUnchanged(
    tenantId: string,
    matrix: Record<string, string[]>,
    actorRole: string
  ): Promise<void> {
    if (actorRole !== UserRoleEnum.TENANT_ADMIN) {
      return
    }

    const currentMatrix = await this.getPermissionMatrix(tenantId)
    const currentMatrixMap = this.toPermissionMatrixMap(currentMatrix)
    const requestedMatrixMap = this.toPermissionMatrixMap(matrix)

    for (const role of CONFIGURABLE_ROLES) {
      const currentPermissions = new Set(currentMatrixMap.get(role) ?? [])
      const requestedPermissions = new Set(requestedMatrixMap.get(role) ?? [])

      for (const permission of TENANT_ADMIN_PROTECTED_PERMISSIONS) {
        if (currentPermissions.has(permission) !== requestedPermissions.has(permission)) {
          throw new BusinessException(
            403,
            'Tenant admins cannot modify role settings permissions',
            'errors.auth.insufficientPermissions'
          )
        }
      }
    }
  }

  private assertResetAllowed(actorRole: string): void {
    if (actorRole === UserRoleEnum.TENANT_ADMIN) {
      throw new BusinessException(
        403,
        'Tenant admins cannot reset role settings defaults',
        'errors.auth.insufficientPermissions'
      )
    }
  }

  private assertUsersControlPermissionsRestrictedToAllowedRoles(
    matrix: Record<string, string[]>
  ): void {
    const requestedMatrixMap = this.toPermissionMatrixMap(matrix)
    const allowedRoles = new Set<string>(USERS_CONTROL_ASSIGNABLE_ROLES)

    for (const role of CONFIGURABLE_ROLES) {
      if (allowedRoles.has(role)) {
        continue
      }

      const requestedPermissions = new Set(requestedMatrixMap.get(role) ?? [])
      for (const permission of USERS_CONTROL_PERMISSION_KEYS) {
        if (requestedPermissions.has(permission)) {
          throw new BusinessException(
            400,
            'Users control permissions are restricted to global administrators or tenant administrators',
            'errors.roleSettings.usersControlRestrictedRole'
          )
        }
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* GET CONFIGURABLE ROLES                                            */
  /* ---------------------------------------------------------------- */

  getConfigurableRoles(): string[] {
    return [...CONFIGURABLE_ROLES]
  }

  /* ---------------------------------------------------------------- */
  /* GET PERMISSION MATRIX                                             */
  /* ---------------------------------------------------------------- */

  async getPermissionMatrix(tenantId: string): Promise<Record<string, string[]>> {
    await this.ensureTenantDefaultPermissionsInitialized(tenantId)
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
    actorUserId: string,
    actorRole: string
  ): Promise<Record<string, string[]>> {
    const currentMatrix = await this.getPermissionMatrix(tenantId)
    await this.assertProtectedRoleSettingsPermissionsUnchanged(tenantId, matrix, actorRole)
    this.assertUsersControlPermissionsRestrictedToAllowedRoles(matrix)

    // Escalation prevention: non-GLOBAL_ADMIN users can only grant permissions they themselves have
    if (actorRole !== UserRoleEnum.GLOBAL_ADMIN) {
      const actorPermissions = await this.getUserPermissions(tenantId, actorRole)
      const actorPermissionSet = new Set(actorPermissions)

      const matrixEntries = Object.entries(matrix)
      for (const [, permissions] of matrixEntries) {
        for (const permission of permissions) {
          if (!actorPermissionSet.has(permission)) {
            throw new BusinessException(
              403,
              'Cannot grant a permission you do not have',
              'errors.roleSettings.escalationPrevented'
            )
          }
        }
      }
    }

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
    await this.emitRoleMatrixPermissionChanges(
      tenantId,
      this.getImpactedRoles(currentMatrix, matrix)
    )

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
    actorUserId: string,
    actorRole: string
  ): Promise<Record<string, string[]>> {
    this.assertResetAllowed(actorRole)
    await this.repository.deleteAllByTenant(tenantId)
    await this.seedDefaultsForTenant(tenantId)
    this.cache.invalidate(tenantId)
    await this.emitRoleMatrixPermissionChanges(tenantId, CONFIGURABLE_ROLES as UserRole[])

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
      await this.ensureTenantDefaultPermissionsInitialized(tenantId)
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
    tenantId: string,
    actorRole?: string
  ): Promise<Array<{ key: string; module: string; labelKey: string; sortOrder: number }>> {
    await this.ensurePermissionDefinitionsInitialized()
    const definitions = await this.repository.findPermissionDefinitions(tenantId)

    if (actorRole === UserRoleEnum.TENANT_ADMIN) {
      return definitions.filter(definition => definition.module !== ROLE_SETTINGS_MODULE)
    }

    return definitions
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
