import { z } from 'zod'
import { ReportTypeEnum, ReportFormatEnum } from './create-report.dto'

export const UpdateReportStatusEnum = z.enum(['generating', 'completed', 'failed'])

export const UpdateReportSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  description: z.string().max(4096).optional(),
  type: ReportTypeEnum.optional(),
  format: ReportFormatEnum.optional(),
  status: UpdateReportStatusEnum.optional(),
  parameters: z
    .record(z.unknown())
    .refine(value => JSON.stringify(value).length <= 65536, {
      message: 'Parameters too large (max 64KB)',
    })
    .optional(),
})

export type UpdateReportDto = z.infer<typeof UpdateReportSchema>
