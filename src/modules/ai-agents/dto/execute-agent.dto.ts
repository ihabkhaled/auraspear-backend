import { z } from 'zod'

export const ExecuteAgentSchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
})

export type ExecuteAgentDto = z.infer<typeof ExecuteAgentSchema>
