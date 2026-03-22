export enum AiAgentId {
  ORCHESTRATOR = 'orchestrator',
  L1_ANALYST = 'l1_analyst',
  L2_ANALYST = 'l2_analyst',
  THREAT_HUNTER = 'threat_hunter',
  RULES_ANALYST = 'rules_analyst',
  NORM_VERIFIER = 'norm_verifier',
  DASHBOARD_BUILDER = 'dashboard_builder',
}

export enum AiTriggerMode {
  MANUAL_ONLY = 'manual_only',
  AUTO_ON_ALERT = 'auto_on_alert',
  AUTO_BY_AGENT = 'auto_by_agent',
  SCHEDULED = 'scheduled',
}

export enum AiOutputFormat {
  STRUCTURED_JSON = 'structured_json',
  MARKDOWN = 'markdown',
  RICH_CARDS = 'rich_cards',
}

export enum OsintSourceType {
  VIRUSTOTAL = 'virustotal',
  SHODAN = 'shodan',
  ABUSEIPDB = 'abuseipdb',
  NVD_NIST = 'nvd_nist',
  ALIENVAULT_OTX = 'alienvault_otx',
  GREYNOISE = 'greynoise',
  URLSCAN = 'urlscan',
  CENSYS = 'censys',
  MALWARE_BAZAAR = 'malware_bazaar',
  THREATFOX = 'threatfox',
  PULSEDIVE = 'pulsedive',
  WEB_SEARCH = 'web_search',
  CUSTOM = 'custom',
}

export enum OsintAuthType {
  NONE = 'none',
  API_KEY_HEADER = 'api_key_header',
  API_KEY_QUERY = 'api_key_query',
  BEARER = 'bearer',
  BASIC = 'basic',
}

export enum ApprovalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
}

export enum ApprovalRiskLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum TokenResetPeriod {
  HOUR = 'hour',
  DAY = 'day',
  MONTH = 'month',
}
