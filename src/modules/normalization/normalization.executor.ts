import { Injectable, Logger } from '@nestjs/common'

export interface NormalizationStep {
  type: 'rename' | 'map' | 'extract' | 'drop' | 'default'
  sourceField: string
  targetField?: string
  mapping?: Record<string, string>
  pattern?: string
  defaultValue?: unknown
}

export interface NormalizationResult {
  pipelineId: string
  status: 'success' | 'partial' | 'error'
  inputCount: number
  outputCount: number
  droppedCount: number
  durationMs: number
  errors: string[]
}

interface NormalizationPipelineInput {
  id: string
  name: string
  steps: NormalizationStep[]
}

export interface NormalizationOutput {
  result: NormalizationResult
  normalizedEvents: Record<string, unknown>[]
}

@Injectable()
export class NormalizationExecutor {
  private readonly logger = new Logger(NormalizationExecutor.name)

  /**
   * Applies a normalization pipeline to a batch of events.
   */
  async executePipeline(
    pipeline: NormalizationPipelineInput,
    events: Record<string, unknown>[]
  ): Promise<NormalizationOutput> {
    const startTime = Date.now()
    const normalizedEvents: Record<string, unknown>[] = []
    const errors: string[] = []
    let droppedCount = 0

    for (const event of events) {
      try {
        const normalized = this.applySteps(event, pipeline.steps)
        if (normalized === null) {
          droppedCount++
        } else {
          normalizedEvents.push(normalized)
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        errors.push(message)
      }
    }

    const durationMs = Date.now() - startTime
    this.logger.log(
      `Pipeline ${pipeline.id} processed ${String(events.length)} events: ${String(normalizedEvents.length)} normalized, ${String(droppedCount)} dropped in ${String(durationMs)}ms`
    )

    return {
      result: {
        pipelineId: pipeline.id,
        status: errors.length > 0 ? 'partial' : 'success',
        inputCount: events.length,
        outputCount: normalizedEvents.length,
        droppedCount,
        durationMs,
        errors,
      },
      normalizedEvents,
    }
  }

  private applySteps(
    event: Record<string, unknown>,
    steps: NormalizationStep[]
  ): Record<string, unknown> | null {
    let result = { ...event }

    for (const step of steps) {
      const applied = this.applyStep(result, step)
      if (applied === null) {
        return null
      }
      result = applied
    }

    return result
  }

  private applyStep(
    result: Record<string, unknown>,
    step: NormalizationStep
  ): Record<string, unknown> | null {
    switch (step.type) {
      case 'rename':
        return this.applyRename(result, step)
      case 'map':
        return this.applyMap(result, step)
      case 'extract':
        return this.applyExtract(result, step)
      case 'drop':
        return this.applyDrop(result, step)
      case 'default':
        return this.applyDefault(result, step)
      default:
        return result
    }
  }

  private applyRename(
    result: Record<string, unknown>,
    step: NormalizationStep
  ): Record<string, unknown> {
    if (step.targetField && result[step.sourceField] !== undefined) {
      result[step.targetField] = result[step.sourceField]
      const { [step.sourceField]: _, ...rest } = result
      return rest as Record<string, unknown>
    }
    return result
  }

  private applyMap(
    result: Record<string, unknown>,
    step: NormalizationStep
  ): Record<string, unknown> {
    if (step.mapping && typeof result[step.sourceField] === 'string' && step.targetField) {
      const sourceValue = result[step.sourceField] as string
      const mappedValue = step.mapping[sourceValue]
      if (mappedValue !== undefined) {
        result[step.targetField] = mappedValue
      }
    }
    return result
  }

  private applyExtract(
    result: Record<string, unknown>,
    step: NormalizationStep
  ): Record<string, unknown> {
    if (step.pattern && typeof result[step.sourceField] === 'string' && step.targetField) {
      if (step.pattern.length > 1000) {
        throw new Error('Regex pattern exceeds maximum allowed length of 1000 characters')
      }
      let regex: RegExp
      try {
        regex = new RegExp(step.pattern)
      } catch {
        throw new Error(`Invalid regex pattern: ${step.pattern}`)
      }
      const match = regex.exec(result[step.sourceField] as string)
      if (match?.[1]) {
        result[step.targetField] = match[1]
      }
    }
    return result
  }

  private applyDrop(
    result: Record<string, unknown>,
    step: NormalizationStep
  ): Record<string, unknown> | null {
    if (result[step.sourceField] !== undefined) {
      return null // Drop the entire event
    }
    return result
  }

  private applyDefault(
    result: Record<string, unknown>,
    step: NormalizationStep
  ): Record<string, unknown> {
    if (result[step.sourceField] === undefined) {
      const targetKey = step.targetField ?? step.sourceField
      result[targetKey] = step.defaultValue
    }
    return result
  }
}
