export enum Permission {
  // Alerts
  ALERTS_VIEW = 'alerts.view',
  ALERTS_INVESTIGATE = 'alerts.investigate',
  ALERTS_ACKNOWLEDGE = 'alerts.acknowledge',
  ALERTS_CLOSE = 'alerts.close',
  ALERTS_ESCALATE = 'alerts.escalate',

  // Cases
  CASES_VIEW = 'cases.view',
  CASES_CREATE = 'cases.create',
  CASES_UPDATE = 'cases.update',
  CASES_DELETE = 'cases.delete',
  CASES_ASSIGN = 'cases.assign',
  CASES_CHANGE_STATUS = 'cases.changeStatus',
  CASES_ADD_COMMENT = 'cases.addComment',
  CASES_DELETE_COMMENT = 'cases.deleteComment',
  CASES_ADD_TASK = 'cases.addTask',
  CASES_UPDATE_TASK = 'cases.updateTask',
  CASES_DELETE_TASK = 'cases.deleteTask',
  CASES_ADD_ARTIFACT = 'cases.addArtifact',
  CASES_DELETE_ARTIFACT = 'cases.deleteArtifact',

  // Incidents
  INCIDENTS_VIEW = 'incidents.view',
  INCIDENTS_CREATE = 'incidents.create',
  INCIDENTS_UPDATE = 'incidents.update',
  INCIDENTS_DELETE = 'incidents.delete',
  INCIDENTS_ADD_TIMELINE = 'incidents.addTimeline',
  INCIDENTS_CHANGE_STATUS = 'incidents.changeStatus',

  // Connectors
  CONNECTORS_VIEW = 'connectors.view',
  CONNECTORS_CREATE = 'connectors.create',
  CONNECTORS_UPDATE = 'connectors.update',
  CONNECTORS_DELETE = 'connectors.delete',
  CONNECTORS_TEST = 'connectors.test',
  CONNECTORS_SYNC = 'connectors.sync',

  // Correlation Rules
  CORRELATION_VIEW = 'correlation.view',
  CORRELATION_CREATE = 'correlation.create',
  CORRELATION_UPDATE = 'correlation.update',
  CORRELATION_DELETE = 'correlation.delete',
  CORRELATION_TOGGLE = 'correlation.toggle',

  // Detection Rules
  DETECTION_RULES_VIEW = 'detectionRules.view',
  DETECTION_RULES_CREATE = 'detectionRules.create',
  DETECTION_RULES_UPDATE = 'detectionRules.update',
  DETECTION_RULES_DELETE = 'detectionRules.delete',
  DETECTION_RULES_TOGGLE = 'detectionRules.toggle',

  // Hunt
  HUNT_VIEW = 'hunt.view',
  HUNT_CREATE = 'hunt.create',
  HUNT_UPDATE = 'hunt.update',
  HUNT_DELETE = 'hunt.delete',
  HUNT_EXECUTE = 'hunt.execute',

  // Reports
  REPORTS_VIEW = 'reports.view',
  REPORTS_CREATE = 'reports.create',
  REPORTS_UPDATE = 'reports.update',
  REPORTS_DELETE = 'reports.delete',
  REPORTS_EXPORT = 'reports.export',

  // Dashboard
  DASHBOARD_VIEW = 'dashboard.view',

  // Admin - Users
  ADMIN_USERS_VIEW = 'admin.users.view',
  ADMIN_USERS_CREATE = 'admin.users.create',
  ADMIN_USERS_UPDATE = 'admin.users.update',
  ADMIN_USERS_DELETE = 'admin.users.delete',
  ADMIN_USERS_BLOCK = 'admin.users.block',
  ADMIN_USERS_RESTORE = 'admin.users.restore',

  // Admin - Tenants
  ADMIN_TENANTS_VIEW = 'admin.tenants.view',
  ADMIN_TENANTS_CREATE = 'admin.tenants.create',
  ADMIN_TENANTS_UPDATE = 'admin.tenants.update',
  ADMIN_TENANTS_DELETE = 'admin.tenants.delete',

  // Intel
  INTEL_VIEW = 'intel.view',

  // SOAR
  SOAR_VIEW = 'soar.view',
  SOAR_CREATE = 'soar.create',
  SOAR_UPDATE = 'soar.update',
  SOAR_DELETE = 'soar.delete',
  SOAR_EXECUTE = 'soar.execute',

  // AI Agents
  AI_AGENTS_VIEW = 'aiAgents.view',
  AI_AGENTS_CREATE = 'aiAgents.create',
  AI_AGENTS_UPDATE = 'aiAgents.update',
  AI_AGENTS_DELETE = 'aiAgents.delete',

  // Cloud Security
  CLOUD_SECURITY_VIEW = 'cloudSecurity.view',
  CLOUD_SECURITY_CREATE = 'cloudSecurity.create',
  CLOUD_SECURITY_UPDATE = 'cloudSecurity.update',
  CLOUD_SECURITY_DELETE = 'cloudSecurity.delete',

  // Compliance
  COMPLIANCE_VIEW = 'compliance.view',
  COMPLIANCE_CREATE = 'compliance.create',
  COMPLIANCE_UPDATE = 'compliance.update',
  COMPLIANCE_DELETE = 'compliance.delete',

  // Attack Paths
  ATTACK_PATHS_VIEW = 'attackPaths.view',
  ATTACK_PATHS_CREATE = 'attackPaths.create',
  ATTACK_PATHS_UPDATE = 'attackPaths.update',
  ATTACK_PATHS_DELETE = 'attackPaths.delete',

  // UEBA
  UEBA_VIEW = 'ueba.view',
  UEBA_CREATE = 'ueba.create',
  UEBA_UPDATE = 'ueba.update',
  UEBA_DELETE = 'ueba.delete',

  // Normalization
  NORMALIZATION_VIEW = 'normalization.view',
  NORMALIZATION_CREATE = 'normalization.create',
  NORMALIZATION_UPDATE = 'normalization.update',
  NORMALIZATION_DELETE = 'normalization.delete',

  // Vulnerabilities
  VULNERABILITIES_VIEW = 'vulnerabilities.view',
  VULNERABILITIES_CREATE = 'vulnerabilities.create',
  VULNERABILITIES_UPDATE = 'vulnerabilities.update',
  VULNERABILITIES_DELETE = 'vulnerabilities.delete',

  // Explorer / Log Search
  EXPLORER_VIEW = 'explorer.view',
  EXPLORER_QUERY = 'explorer.query',

  // Notifications
  NOTIFICATIONS_VIEW = 'notifications.view',
  NOTIFICATIONS_MANAGE = 'notifications.manage',

  // Profile
  PROFILE_VIEW = 'profile.view',
  PROFILE_UPDATE = 'profile.update',

  // Settings
  SETTINGS_VIEW = 'settings.view',
  SETTINGS_UPDATE = 'settings.update',

  // Role Settings (this module itself)
  ROLE_SETTINGS_VIEW = 'roleSettings.view',
  ROLE_SETTINGS_UPDATE = 'roleSettings.update',
}

/**
 * All permission keys as an array — useful for seeding and validation.
 */
export const ALL_PERMISSIONS: Permission[] = Object.values(Permission)
