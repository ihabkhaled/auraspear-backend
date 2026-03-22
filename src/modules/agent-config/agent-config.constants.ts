import { AiAgentId, AiFeatureKey, AiOutputFormat, AiTriggerMode } from '../../common/enums'
import type { AgentDefaultConfig } from './agent-config.types'

/** The connector key that means "use tenant default / auto-select" */
export const AI_DEFAULT_PROVIDER_KEY = 'default'

export const AI_AGENT_DEFAULTS: Record<AiAgentId, AgentDefaultConfig> = {
  [AiAgentId.ORCHESTRATOR]: {
    displayName: 'Orchestrator',
    description: 'Coordinates multi-agent workflows and routes tasks to specialist agents',
    temperature: 0.3,
    maxTokensPerCall: 4096,
    triggerMode: AiTriggerMode.MANUAL_ONLY,
    outputFormat: AiOutputFormat.STRUCTURED_JSON,
    presentationSkills: ['task_routing', 'workflow_summary'],
  },
  [AiAgentId.L1_ANALYST]: {
    displayName: 'L1 SOC Analyst',
    description: 'Performs initial alert triage, enrichment, and classification',
    temperature: 0.5,
    maxTokensPerCall: 2048,
    triggerMode: AiTriggerMode.AUTO_ON_ALERT,
    outputFormat: AiOutputFormat.RICH_CARDS,
    presentationSkills: ['risk_gauge', 'ioc_table', 'severity_badge'],
  },
  [AiAgentId.L2_ANALYST]: {
    displayName: 'L2 SOC Analyst',
    description: 'Deep investigation, correlation analysis, and incident assessment',
    temperature: 0.5,
    maxTokensPerCall: 4096,
    triggerMode: AiTriggerMode.MANUAL_ONLY,
    outputFormat: AiOutputFormat.RICH_CARDS,
    presentationSkills: ['timeline', 'mitre_map', 'ioc_table', 'risk_gauge'],
  },
  [AiAgentId.THREAT_HUNTER]: {
    displayName: 'Threat Hunter',
    description: 'Proactive threat hunting, hypothesis generation, and hunt query creation',
    temperature: 0.7,
    maxTokensPerCall: 4096,
    triggerMode: AiTriggerMode.MANUAL_ONLY,
    outputFormat: AiOutputFormat.MARKDOWN,
    presentationSkills: ['hunt_query', 'mitre_map', 'ioc_table'],
  },
  [AiAgentId.RULES_ANALYST]: {
    displayName: 'Rules Analyst',
    description: 'Detection rule creation, tuning, and Sigma/YARA analysis',
    temperature: 0.4,
    maxTokensPerCall: 4096,
    triggerMode: AiTriggerMode.MANUAL_ONLY,
    outputFormat: AiOutputFormat.STRUCTURED_JSON,
    presentationSkills: ['rule_preview', 'mitre_map'],
  },
  [AiAgentId.NORM_VERIFIER]: {
    displayName: 'Normalization Verifier',
    description: 'Log normalization pipeline verification and field mapping validation',
    temperature: 0.3,
    maxTokensPerCall: 2048,
    triggerMode: AiTriggerMode.MANUAL_ONLY,
    outputFormat: AiOutputFormat.STRUCTURED_JSON,
    presentationSkills: ['field_mapping_table', 'validation_report'],
  },
  [AiAgentId.DASHBOARD_BUILDER]: {
    displayName: 'Dashboard Builder',
    description:
      'KPI suggestions, visualization recommendations, and dashboard layout optimization',
    temperature: 0.6,
    maxTokensPerCall: 2048,
    triggerMode: AiTriggerMode.MANUAL_ONLY,
    outputFormat: AiOutputFormat.RICH_CARDS,
    presentationSkills: ['chart_preview', 'kpi_card'],
  },
}

export const AGENT_DEFAULTS_MAP = new Map<string, AgentDefaultConfig>(
  Object.entries(AI_AGENT_DEFAULTS)
)

/**
 * Maps each AI feature to the agent responsible for handling it.
 * Used by AiService.executeAiTask() to load per-agent configuration
 * (temperature, maxTokens, systemPrompt, quota, etc.) at execution time.
 */
export const FEATURE_TO_AGENT_MAP: Record<AiFeatureKey, AiAgentId> = {
  [AiFeatureKey.ALERT_SUMMARIZE]: AiAgentId.L1_ANALYST,
  [AiFeatureKey.ALERT_EXPLAIN_SEVERITY]: AiAgentId.L1_ANALYST,
  [AiFeatureKey.ALERT_FALSE_POSITIVE_SCORE]: AiAgentId.L1_ANALYST,
  [AiFeatureKey.ALERT_NEXT_ACTION]: AiAgentId.L1_ANALYST,
  [AiFeatureKey.CASE_SUMMARIZE]: AiAgentId.L2_ANALYST,
  [AiFeatureKey.CASE_EXECUTIVE_SUMMARY]: AiAgentId.L2_ANALYST,
  [AiFeatureKey.CASE_TIMELINE]: AiAgentId.L2_ANALYST,
  [AiFeatureKey.CASE_NEXT_TASKS]: AiAgentId.L2_ANALYST,
  [AiFeatureKey.HUNT_HYPOTHESIS]: AiAgentId.THREAT_HUNTER,
  [AiFeatureKey.HUNT_NL_TO_QUERY]: AiAgentId.THREAT_HUNTER,
  [AiFeatureKey.HUNT_RESULT_INTERPRET]: AiAgentId.THREAT_HUNTER,
  [AiFeatureKey.INTEL_IOC_ENRICH]: AiAgentId.L2_ANALYST,
  [AiFeatureKey.INTEL_ADVISORY_DRAFT]: AiAgentId.L2_ANALYST,
  [AiFeatureKey.DETECTION_RULE_DRAFT]: AiAgentId.RULES_ANALYST,
  [AiFeatureKey.DETECTION_TUNING]: AiAgentId.RULES_ANALYST,
  [AiFeatureKey.REPORT_DAILY_SUMMARY]: AiAgentId.DASHBOARD_BUILDER,
  [AiFeatureKey.REPORT_EXECUTIVE]: AiAgentId.DASHBOARD_BUILDER,
  [AiFeatureKey.DASHBOARD_ANOMALY]: AiAgentId.DASHBOARD_BUILDER,
  [AiFeatureKey.SOAR_PLAYBOOK_DRAFT]: AiAgentId.ORCHESTRATOR,
  [AiFeatureKey.AGENT_TASK]: AiAgentId.ORCHESTRATOR,
  [AiFeatureKey.KNOWLEDGE_SEARCH]: AiAgentId.L1_ANALYST,
  [AiFeatureKey.KNOWLEDGE_GENERATE_RUNBOOK]: AiAgentId.L2_ANALYST,
  [AiFeatureKey.KNOWLEDGE_SUMMARIZE_INCIDENT]: AiAgentId.L2_ANALYST,
  [AiFeatureKey.ENTITY_RISK_EXPLAIN]: AiAgentId.L2_ANALYST,
  [AiFeatureKey.NORMALIZATION_VERIFY]: AiAgentId.NORM_VERIFIER,
}
