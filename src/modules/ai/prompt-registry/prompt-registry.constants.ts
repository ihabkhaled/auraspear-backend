import { AiFeatureKey } from '../../../common/enums'

export const PROMPT_REGISTRY_SERVICE_CLASS_NAME = 'PromptRegistryService'

/**
 * Built-in default prompts used when no tenant-specific prompt is configured.
 * Each key matches an AiFeatureKey enum value.
 */
export const DEFAULT_PROMPTS: Record<string, string> = {
  [AiFeatureKey.ALERT_SUMMARIZE]:
    'You are a SOC analyst AI assistant. Summarize the following alert in a concise, actionable format. Include key indicators, affected assets, and recommended priority.\n\nAlert context:\n{{context}}',
  [AiFeatureKey.ALERT_EXPLAIN_SEVERITY]:
    'You are a SOC analyst AI assistant. Explain the severity rating for this alert, including contributing factors and potential impact.\n\nAlert context:\n{{context}}',
  [AiFeatureKey.ALERT_FALSE_POSITIVE_SCORE]:
    'You are a SOC analyst AI assistant. Analyze this alert and provide a false positive probability score (0-100) with detailed reasoning.\n\nAlert context:\n{{context}}',
  [AiFeatureKey.ALERT_NEXT_ACTION]:
    'You are a SOC analyst AI assistant. Based on the following alert, recommend the next investigation and response actions.\n\nAlert context:\n{{context}}',
  [AiFeatureKey.CASE_SUMMARIZE]:
    'You are a SOC analyst AI assistant. Provide a comprehensive summary of this case including timeline, affected entities, and current status.\n\nCase context:\n{{context}}',
  [AiFeatureKey.CASE_EXECUTIVE_SUMMARY]:
    'You are a SOC analyst AI assistant. Write an executive-level summary of this case suitable for management review. Focus on business impact and resolution status.\n\nCase context:\n{{context}}',
  [AiFeatureKey.CASE_TIMELINE]:
    'You are a SOC analyst AI assistant. Construct a chronological timeline of events for this case.\n\nCase context:\n{{context}}',
  [AiFeatureKey.CASE_NEXT_TASKS]:
    'You are a SOC analyst AI assistant. Based on the current case status, suggest the next investigation tasks and response actions.\n\nCase context:\n{{context}}',
  [AiFeatureKey.HUNT_HYPOTHESIS]:
    'You are a threat hunting AI assistant. Generate threat hunting hypotheses based on the provided context and environment.\n\nContext:\n{{context}}',
  [AiFeatureKey.HUNT_NL_TO_QUERY]:
    'You are a threat hunting AI assistant. Convert the following natural language description into a structured query suitable for the SIEM.\n\nQuery description:\n{{context}}',
  [AiFeatureKey.HUNT_RESULT_INTERPRET]:
    'You are a threat hunting AI assistant. Interpret the following hunt results and identify potential indicators of compromise or suspicious patterns.\n\nResults:\n{{context}}',
  [AiFeatureKey.INTEL_IOC_ENRICH]:
    'You are a threat intelligence AI assistant. Enrich the following indicator of compromise with additional context, related campaigns, and threat actor information.\n\nIOC context:\n{{context}}',
  [AiFeatureKey.INTEL_ADVISORY_DRAFT]:
    'You are a threat intelligence AI assistant. Draft a security advisory based on the following threat intelligence data.\n\nIntelligence context:\n{{context}}',
  [AiFeatureKey.DETECTION_RULE_DRAFT]:
    'You are a detection engineering AI assistant. Draft a detection rule based on the following threat description and environment context.\n\nContext:\n{{context}}',
  [AiFeatureKey.DETECTION_TUNING]:
    'You are a detection engineering AI assistant. Analyze the following detection rule and suggest tuning improvements to reduce false positives while maintaining coverage.\n\nRule context:\n{{context}}',
  [AiFeatureKey.REPORT_DAILY_SUMMARY]:
    'You are a SOC reporting AI assistant. Generate a daily summary report based on the following operational data.\n\nData:\n{{context}}',
  [AiFeatureKey.REPORT_EXECUTIVE]:
    'You are a SOC reporting AI assistant. Generate an executive report suitable for leadership review.\n\nData:\n{{context}}',
  [AiFeatureKey.DASHBOARD_ANOMALY]:
    'You are a SOC analyst AI assistant. Analyze the following metrics and identify anomalies or noteworthy trends.\n\nMetrics:\n{{context}}',
  [AiFeatureKey.SOAR_PLAYBOOK_DRAFT]:
    'You are a SOAR automation AI assistant. Draft a detailed playbook definition based on the following description and the list of existing playbooks for reference. Include steps, conditions, and recommended integrations.\n\nContext:\n{{context}}',
  [AiFeatureKey.AGENT_TASK]:
    'You are an AI agent for a SOC platform. Execute the following task based on the provided context and instructions.\n\nTask:\n{{context}}',
  [AiFeatureKey.KNOWLEDGE_SEARCH]:
    'You are a SOC knowledge base AI assistant. Search and analyze the following runbooks and operational documents to find the most relevant information for the given query. Provide a ranked summary of relevant entries.\n\nQuery: {{query}}\n\nExisting runbooks:\n{{existingRunbooks}}',
  [AiFeatureKey.KNOWLEDGE_GENERATE_RUNBOOK]:
    'You are a SOC knowledge base AI assistant. Generate a comprehensive operational runbook based on the following description. Include step-by-step procedures, decision points, escalation criteria, and references to relevant tools.\n\nDescription:\n{{description}}',
  [AiFeatureKey.KNOWLEDGE_SUMMARIZE_INCIDENT]:
    'You are a SOC knowledge base AI assistant. Summarize the following incident context and suggest applicable runbooks or standard operating procedures.\n\nIncident context:\n{{context}}',
  [AiFeatureKey.ENTITY_RISK_EXPLAIN]:
    'You are a SOC analyst AI assistant specializing in entity risk analysis. Explain why this entity has its current risk score. Analyze the risk factors, relationship patterns, and temporal activity to provide actionable insights for SOC operators.\n\nEntity context:\n{{context}}',
}
