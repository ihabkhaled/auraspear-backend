import type { UpdatePreferencesDto } from './dto/update-preferences.dto'
import type { Tenant, User, UserPreference } from '@prisma/client'

/* ---------------------------------------------------------------- */
/* DEFAULT PREFERENCES                                               */
/* ---------------------------------------------------------------- */

export const DEFAULT_PREFERENCES = {
  theme: 'system',
  language: 'en',
  notificationsEmail: true,
  notificationsInApp: true,
  notifyCriticalAlerts: true,
  notifyHighAlerts: true,
  notifyCaseAssignments: true,
  notifyIncidentUpdates: true,
  notifyComplianceAlerts: true,
  notifyCaseUpdates: true,
  notifyCaseComments: true,
  notifyCaseActivity: true,
  notifyUserManagement: true,
  retentionAlerts: '90',
  retentionLogs: '90',
  retentionIncidents: '365',
  retentionAuditLogs: '365',
}

/* ---------------------------------------------------------------- */
/* PROFILE MAPPING                                                   */
/* ---------------------------------------------------------------- */

export type UserProfile = Omit<User, 'passwordHash'> & {
  tenant: Tenant | null
  preference: UserPreference | null
}

interface UserWithMemberships extends User {
  memberships: Array<{ tenant: Tenant }>
  preference: UserPreference | null
}

export function mapUserToProfile(user: UserWithMemberships): UserProfile {
  const { passwordHash: _passwordHash, memberships, ...rest } = user
  const firstMembership = memberships[0]
  return {
    ...rest,
    tenant: firstMembership?.tenant ?? null,
    preference: user.preference,
  }
}

/* ---------------------------------------------------------------- */
/* PREFERENCE UPDATE/CREATE DATA                                     */
/* ---------------------------------------------------------------- */

export function buildPreferenceUpdateData(dto: UpdatePreferencesDto): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  if (dto.theme !== undefined) data['theme'] = dto.theme
  if (dto.language !== undefined) data['language'] = dto.language
  if (dto.notificationsEmail !== undefined) data['notificationsEmail'] = dto.notificationsEmail
  if (dto.notificationsInApp !== undefined) data['notificationsInApp'] = dto.notificationsInApp
  if (dto.notifyCriticalAlerts !== undefined) {
    data['notifyCriticalAlerts'] = dto.notifyCriticalAlerts
  }
  if (dto.notifyHighAlerts !== undefined) data['notifyHighAlerts'] = dto.notifyHighAlerts
  if (dto.notifyCaseAssignments !== undefined) {
    data['notifyCaseAssignments'] = dto.notifyCaseAssignments
  }
  if (dto.notifyIncidentUpdates !== undefined) {
    data['notifyIncidentUpdates'] = dto.notifyIncidentUpdates
  }
  if (dto.notifyComplianceAlerts !== undefined) {
    data['notifyComplianceAlerts'] = dto.notifyComplianceAlerts
  }
  if (dto.notifyCaseUpdates !== undefined) data['notifyCaseUpdates'] = dto.notifyCaseUpdates
  if (dto.notifyCaseComments !== undefined) data['notifyCaseComments'] = dto.notifyCaseComments
  if (dto.notifyCaseActivity !== undefined) data['notifyCaseActivity'] = dto.notifyCaseActivity
  if (dto.notifyUserManagement !== undefined) {
    data['notifyUserManagement'] = dto.notifyUserManagement
  }
  if (dto.retentionAlerts !== undefined) data['retentionAlerts'] = dto.retentionAlerts
  if (dto.retentionLogs !== undefined) data['retentionLogs'] = dto.retentionLogs
  if (dto.retentionIncidents !== undefined) data['retentionIncidents'] = dto.retentionIncidents
  if (dto.retentionAuditLogs !== undefined) data['retentionAuditLogs'] = dto.retentionAuditLogs
  return data
}

export function buildPreferenceCreateData(dto: UpdatePreferencesDto): typeof DEFAULT_PREFERENCES {
  return {
    theme: dto.theme ?? DEFAULT_PREFERENCES.theme,
    language: dto.language ?? DEFAULT_PREFERENCES.language,
    notificationsEmail: dto.notificationsEmail ?? DEFAULT_PREFERENCES.notificationsEmail,
    notificationsInApp: dto.notificationsInApp ?? DEFAULT_PREFERENCES.notificationsInApp,
    notifyCriticalAlerts: dto.notifyCriticalAlerts ?? DEFAULT_PREFERENCES.notifyCriticalAlerts,
    notifyHighAlerts: dto.notifyHighAlerts ?? DEFAULT_PREFERENCES.notifyHighAlerts,
    notifyCaseAssignments: dto.notifyCaseAssignments ?? DEFAULT_PREFERENCES.notifyCaseAssignments,
    notifyIncidentUpdates: dto.notifyIncidentUpdates ?? DEFAULT_PREFERENCES.notifyIncidentUpdates,
    notifyComplianceAlerts:
      dto.notifyComplianceAlerts ?? DEFAULT_PREFERENCES.notifyComplianceAlerts,
    notifyCaseUpdates: dto.notifyCaseUpdates ?? DEFAULT_PREFERENCES.notifyCaseUpdates,
    notifyCaseComments: dto.notifyCaseComments ?? DEFAULT_PREFERENCES.notifyCaseComments,
    notifyCaseActivity: dto.notifyCaseActivity ?? DEFAULT_PREFERENCES.notifyCaseActivity,
    notifyUserManagement: dto.notifyUserManagement ?? DEFAULT_PREFERENCES.notifyUserManagement,
    retentionAlerts: dto.retentionAlerts ?? DEFAULT_PREFERENCES.retentionAlerts,
    retentionLogs: dto.retentionLogs ?? DEFAULT_PREFERENCES.retentionLogs,
    retentionIncidents: dto.retentionIncidents ?? DEFAULT_PREFERENCES.retentionIncidents,
    retentionAuditLogs: dto.retentionAuditLogs ?? DEFAULT_PREFERENCES.retentionAuditLogs,
  }
}
