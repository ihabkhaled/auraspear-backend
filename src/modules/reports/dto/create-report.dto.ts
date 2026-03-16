import { z } from 'zod'

export const ReportTypeEnum = z.enum(['executive', 'compliance', 'incident', 'threat', 'custom'])
export const ReportFormatEnum = z.enum(['pdf', 'csv', 'html'])

export const CreateReportSchema = z.object({
  name: z.string().min(1).max(500),
  description: z.string().max(4096).optional(),
  type: ReportTypeEnum,
  format: ReportFormatEnum,
  parameters: z
    .record(z.unknown())
    .refine(value => JSON.stringify(value).length <= 65536, {
      message: 'Parameters too large (max 64KB)',
    })
    .optional(),
})

export type CreateReportDto = z.infer<typeof CreateReportSchema>
