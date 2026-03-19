import { z } from 'zod'
import { JobStatus, JobType } from '../enums/job.enums'

export const ListJobsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.nativeEnum(JobType).optional(),
  status: z.nativeEnum(JobStatus).optional(),
})

export type ListJobsQueryDto = z.infer<typeof ListJobsQuerySchema>
