import { Permission } from '../../../common/enums'

export const ROLE_SETTINGS_MODULE = 'roleSettings'
export const TENANT_ADMIN_PROTECTED_PERMISSIONS = new Set<string>([
  Permission.ROLE_SETTINGS_VIEW,
  Permission.ROLE_SETTINGS_UPDATE,
])
