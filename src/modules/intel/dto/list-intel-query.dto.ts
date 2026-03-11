import { z } from 'zod'
import {
  IntelEventSortField,
  IntelIocSortField,
  MispIocType,
  SortOrder,
} from '../../../common/enums'

export const ListEventsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.nativeEnum(IntelEventSortField).default(IntelEventSortField.DATE),
  sortOrder: z.nativeEnum(SortOrder).default(SortOrder.DESC),
})

export type ListEventsQueryDto = z.infer<typeof ListEventsQuerySchema>

export const SearchIOCsQuerySchema = z.object({
  value: z.string().min(1).max(500),
  type: z.nativeEnum(MispIocType).optional(),
  source: z.string().max(255).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.nativeEnum(IntelIocSortField).default(IntelIocSortField.LAST_SEEN),
  sortOrder: z.nativeEnum(SortOrder).default(SortOrder.DESC),
})

export type SearchIOCsQueryDto = z.infer<typeof SearchIOCsQuerySchema>
