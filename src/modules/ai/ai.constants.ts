export const AI_DEFAULT_MODEL = 'anthropic.claude-3-sonnet'
export const AI_FALLBACK_MODEL = 'rule-based'
export const AI_BEDROCK_MAX_TOKENS = 2048
export const AI_EXPLAIN_LATENCY_OFFSET_MS = 900
export const AI_EXPLAIN_REASONING = [
  'Parsing the security concept or finding to explain',
  'Breaking down technical details into analyst-friendly language',
  'Mapping to MITRE ATT&CK tactics, techniques, and procedures',
  'Providing contextual examples relevant to the environment',
  'Including remediation guidance and best practices',
] as const
