import { z } from 'zod'
import { SoarTriggerTypeEnum } from './create-playbook.dto'

export const SoarPlaybookStatusEnum = z.enum(['active', 'inactive', 'draft'])

export const UpdatePlaybookSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  description: z.string().max(4096).optional(),
  triggerType: SoarTriggerTypeEnum.optional(),
  triggerConditions: z.record(z.unknown()).optional(),
  steps: z.array(z.record(z.unknown())).min(1).max(100).optional(),
  status: SoarPlaybookStatusEnum.optional(),
})

export type UpdatePlaybookDto = z.infer<typeof UpdatePlaybookSchema>
