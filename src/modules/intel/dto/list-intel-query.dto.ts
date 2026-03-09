import { z } from 'zod'

export const ListEventsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z
    .enum(['date', 'organization', 'threatLevel', 'attributeCount', 'published'])
    .default('date'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
})

export type ListEventsQueryDto = z.infer<typeof ListEventsQuerySchema>

export const SearchIOCsQuerySchema = z.object({
  value: z.string().min(1).max(500),
  type: z
    .enum(['ip-src', 'ip-dst', 'domain', 'hostname', 'md5', 'sha1', 'sha256', 'url'])
    .optional(),
  source: z.string().max(255).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z
    .enum(['lastSeen', 'firstSeen', 'hitCount', 'severity', 'iocType', 'iocValue', 'source'])
    .default('lastSeen'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
})

export type SearchIOCsQueryDto = z.infer<typeof SearchIOCsQuerySchema>
