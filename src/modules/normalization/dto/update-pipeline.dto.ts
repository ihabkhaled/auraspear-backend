import { z } from 'zod'
import { NormalizationSourceTypeEnum } from './create-pipeline.dto'

export const NormalizationPipelineStatusEnum = z.enum(['active', 'inactive', 'error'])

export const UpdatePipelineSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2048).optional(),
  sourceType: NormalizationSourceTypeEnum.optional(),
  status: NormalizationPipelineStatusEnum.optional(),
  parserConfig: z.record(z.unknown()).optional(),
  fieldMappings: z.record(z.unknown()).optional(),
})

export type UpdatePipelineDto = z.infer<typeof UpdatePipelineSchema>
