import { z } from 'zod'
import { DetectionRuleSeverityEnum, DetectionRuleTypeEnum } from './create-detection-rule.dto'

export const DetectionRuleStatusEnum = z.enum(['active', 'testing', 'disabled'])

export const UpdateDetectionRuleSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  description: z.string().max(4096).optional(),
  ruleType: DetectionRuleTypeEnum.optional(),
  severity: DetectionRuleSeverityEnum.optional(),
  status: DetectionRuleStatusEnum.optional(),
  conditions: z.record(z.unknown()).optional(),
  actions: z.record(z.unknown()).optional(),
})

export type UpdateDetectionRuleDto = z.infer<typeof UpdateDetectionRuleSchema>
