import { toSortOrder } from '../../common/utils/query.utility'
import type { UpdatePipelineDto } from './dto/update-pipeline.dto'
import type {
  NormalizationPipelineRecord,
  NormalizationStats,
  NormalizationStep,
} from './normalization.types'

/* ---------------------------------------------------------------- */
/* QUERY BUILDING                                                    */
/* ---------------------------------------------------------------- */

export function buildPipelineListWhere(
  tenantId: string,
  sourceType?: string,
  status?: string,
  query?: string
): Record<string, unknown> {
  const where: Record<string, unknown> = { tenantId }

  if (sourceType) {
    where['sourceType'] = sourceType
  }

  if (status) {
    where['status'] = status
  }

  if (query && query.trim().length > 0) {
    where['OR'] = [
      { name: { contains: query, mode: 'insensitive' } },
      { description: { contains: query, mode: 'insensitive' } },
    ]
  }

  return where
}

export function buildPipelineOrderBy(sortBy?: string, sortOrder?: string): Record<string, string> {
  const order = toSortOrder(sortOrder)
  switch (sortBy) {
    case 'name':
      return { name: order }
    case 'sourceType':
      return { sourceType: order }
    case 'status':
      return { status: order }
    case 'processedCount':
      return { processedCount: order }
    case 'errorCount':
      return { errorCount: order }
    case 'updatedAt':
      return { updatedAt: order }
    case 'createdAt':
    default:
      return { createdAt: order }
  }
}

/* ---------------------------------------------------------------- */
/* UPDATE DATA BUILDING                                              */
/* ---------------------------------------------------------------- */

export function buildPipelineUpdateData(dto: UpdatePipelineDto): Record<string, unknown> {
  const data: Record<string, unknown> = {}

  if (dto.name !== undefined) data['name'] = dto.name
  if (dto.description !== undefined) data['description'] = dto.description
  if (dto.sourceType !== undefined) data['sourceType'] = dto.sourceType
  if (dto.status !== undefined) data['status'] = dto.status
  if (dto.parserConfig !== undefined) data['parserConfig'] = dto.parserConfig
  if (dto.fieldMappings !== undefined) data['fieldMappings'] = dto.fieldMappings

  return data
}

/* ---------------------------------------------------------------- */
/* RECORD MAPPING                                                    */
/* ---------------------------------------------------------------- */

interface PipelineEntity {
  id: string
  tenantId: string
  name: string
  description: string | null
  sourceType: string
  status: string
  parserConfig: unknown
  fieldMappings: unknown
  processedCount: bigint | number
  errorCount: number
  lastProcessedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export function buildPipelineRecord(pipeline: PipelineEntity): NormalizationPipelineRecord {
  return {
    id: pipeline.id,
    tenantId: pipeline.tenantId,
    name: pipeline.name,
    description: pipeline.description,
    sourceType: pipeline.sourceType,
    status: pipeline.status,
    parserConfig: pipeline.parserConfig as Record<string, unknown>,
    fieldMappings: pipeline.fieldMappings as Record<string, unknown>,
    processedCount: String(pipeline.processedCount),
    errorCount: pipeline.errorCount,
    lastProcessedAt: pipeline.lastProcessedAt,
    createdAt: pipeline.createdAt,
    updatedAt: pipeline.updatedAt,
  }
}

/* ---------------------------------------------------------------- */
/* PIPELINE STEP EXTRACTION                                          */
/* ---------------------------------------------------------------- */

const VALID_STEP_TYPES = new Set(['rename', 'map', 'extract', 'drop', 'default'])

function isValidStepType(value: unknown): value is NormalizationStep['type'] {
  return typeof value === 'string' && VALID_STEP_TYPES.has(value)
}

/**
 * Extracts normalization steps from parserConfig and fieldMappings.
 * parserConfig.steps holds explicit pipeline steps.
 * fieldMappings entries are converted to 'rename' steps as a fallback.
 */
export function extractPipelineSteps(
  parserConfig: Record<string, unknown>,
  fieldMappings: Record<string, unknown>
): NormalizationStep[] {
  const steps: NormalizationStep[] = []

  // Extract explicit steps from parserConfig
  const rawSteps = Reflect.get(parserConfig, 'steps')
  if (Array.isArray(rawSteps)) {
    for (const raw of rawSteps) {
      if (
        typeof raw === 'object' &&
        raw !== null &&
        isValidStepType(Reflect.get(raw as Record<string, unknown>, 'type')) &&
        typeof Reflect.get(raw as Record<string, unknown>, 'sourceField') === 'string'
      ) {
        const typed = raw as Record<string, unknown>
        steps.push({
          type: Reflect.get(typed, 'type') as NormalizationStep['type'],
          sourceField: Reflect.get(typed, 'sourceField') as string,
          targetField:
            typeof Reflect.get(typed, 'targetField') === 'string'
              ? (Reflect.get(typed, 'targetField') as string)
              : undefined,
          mapping:
            typeof Reflect.get(typed, 'mapping') === 'object' &&
            Reflect.get(typed, 'mapping') !== null
              ? (Reflect.get(typed, 'mapping') as Record<string, string>)
              : undefined,
          pattern:
            typeof Reflect.get(typed, 'pattern') === 'string'
              ? (Reflect.get(typed, 'pattern') as string)
              : undefined,
          defaultValue: Reflect.get(typed, 'defaultValue'),
        })
      }
    }
  }

  // Convert fieldMappings to rename steps as fallback
  for (const [sourceField, targetField] of Object.entries(fieldMappings)) {
    if (typeof targetField === 'string') {
      steps.push({
        type: 'rename',
        sourceField,
        targetField,
      })
    }
  }

  return steps
}

/* ---------------------------------------------------------------- */
/* STATS BUILDING                                                    */
/* ---------------------------------------------------------------- */

export function buildNormalizationStats(
  total: number,
  active: number,
  inactive: number,
  errorPipelines: number,
  aggregates: { _sum: { processedCount: bigint | number | null; errorCount: number | null } }
): NormalizationStats {
  return {
    totalPipelines: total,
    activePipelines: active,
    inactivePipelines: inactive,
    errorPipelines,
    totalEventsProcessed: String(aggregates._sum.processedCount ?? 0),
    totalErrors: aggregates._sum.errorCount ?? 0,
  }
}
