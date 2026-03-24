import { AiFindingType } from '../../../common/enums'

export const AI_SUMMARY_MAX_LENGTH = 10000
export const AI_NOTIFICATION_MESSAGE_MAX_LENGTH = 500
export const SEVERITY_PATTERN = /\b(critical|high|medium|low|info)\b/i

export const ACTION_TYPE_TO_FINDING_TYPE = new Map<string, AiFindingType>([
  ['triage', AiFindingType.TRIAGE],
  ['summarize', AiFindingType.SUMMARY],
  ['severity_recommendation', AiFindingType.SEVERITY_RECOMMENDATION],
  ['escalation_recommendation', AiFindingType.ESCALATION_RECOMMENDATION],
  ['investigate', AiFindingType.INVESTIGATION_STEP],
  ['entity_risk', AiFindingType.ENTITY_RISK_SIGNAL],
  ['correlate', AiFindingType.CORRELATION_CANDIDATE],
  ['vulnerability_priority', AiFindingType.VULNERABILITY_PRIORITY],
  ['cloud_posture', AiFindingType.CLOUD_POSTURE_FINDING],
  ['rule_recommendation', AiFindingType.RULE_RECOMMENDATION],
  ['report_insight', AiFindingType.REPORT_INSIGHT],
])
