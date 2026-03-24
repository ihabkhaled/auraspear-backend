import { z } from 'zod'
import { AiFindingStatus, AiFindingType, SortOrder } from '../../../../common/enums'

export const ListFindingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z
    .enum(['createdAt', 'findingType', 'severity', 'confidenceScore', 'status', 'agentId'])
    .default('createdAt'),
  sortOrder: z.nativeEnum(SortOrder).default(SortOrder.DESC),
  sourceModule: z.string().max(50).optional(),
  agentId: z.string().max(50).optional(),
  status: z.nativeEnum(AiFindingStatus).optional(),
  findingType: z.nativeEnum(AiFindingType).optional(),
  sourceEntityId: z.string().max(255).optional(),
  query: z.string().max(500).optional(),
})

export type ListFindingsQueryDto = z.infer<typeof ListFindingsQuerySchema>
