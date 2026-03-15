import { z } from 'zod'

export const NormalizationSourceTypeEnum = z.enum([
  'syslog',
  'json',
  'csv',
  'cef',
  'leef',
  'custom',
])

export const CreatePipelineSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2048).optional(),
  sourceType: NormalizationSourceTypeEnum,
  parserConfig: z.record(z.unknown()).default({}),
  fieldMappings: z.record(z.unknown()).default({}),
})

export type CreatePipelineDto = z.infer<typeof CreatePipelineSchema>
