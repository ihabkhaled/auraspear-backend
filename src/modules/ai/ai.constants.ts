import { ConnectorType } from '../../common/enums'

export const AI_DEFAULT_MODEL = 'anthropic.claude-3-sonnet'
export const AI_FALLBACK_MODEL = 'rule-based'
export const AI_BEDROCK_MAX_TOKENS = 2048
export const AI_LLM_APIS_MAX_TOKENS = 2048
export const AI_OPENCLAW_MAX_TOKENS = 2048
export const AI_EXPLAIN_LATENCY_OFFSET_MS = 900
/** Cost per 1 000 input tokens (USD) — Bedrock Claude 3 Sonnet pricing. */
export const AI_COST_PER_1K_INPUT_TOKENS = 0.003
/** Cost per 1 000 output tokens (USD) — Bedrock Claude 3 Sonnet pricing. */
export const AI_COST_PER_1K_OUTPUT_TOKENS = 0.015

/** Priority order for AI connector resolution. */
export const AI_CONNECTOR_PRIORITY: ConnectorType[] = [
  ConnectorType.BEDROCK,
  ConnectorType.LLM_APIS,
  ConnectorType.OPENCLAW_GATEWAY,
]

export const AI_EXPLAIN_REASONING = [
  'Parsing the security concept or finding to explain',
  'Breaking down technical details into analyst-friendly language',
  'Mapping to MITRE ATT&CK tactics, techniques, and procedures',
  'Providing contextual examples relevant to the environment',
  'Including remediation guidance and best practices',
] as const
