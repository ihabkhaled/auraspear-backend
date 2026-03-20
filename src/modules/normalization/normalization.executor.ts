import { Injectable, Logger } from '@nestjs/common'
import type {
  NormalizationOutput,
  NormalizationPipelineInput,
  NormalizationStep,
} from './normalization.types'

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
    const sourceValue = Reflect.get(result, step.sourceField)

    if (step.targetField && sourceValue !== undefined) {
      Reflect.set(result, step.targetField, sourceValue)
      return Object.fromEntries(
        Object.entries(result).filter(([key]) => key !== step.sourceField)
      ) as Record<string, unknown>
    }

    return result
  }

  private applyMap(
    result: Record<string, unknown>,
    step: NormalizationStep
  ): Record<string, unknown> {
    const sourceValue = Reflect.get(result, step.sourceField)

    if (step.mapping && typeof sourceValue === 'string' && step.targetField) {
      const mappedValue = Reflect.get(step.mapping, sourceValue)
      if (mappedValue !== undefined) {
        Reflect.set(result, step.targetField, mappedValue)
      }
    }

    return result
  }

  private applyExtract(
    result: Record<string, unknown>,
    step: NormalizationStep
  ): Record<string, unknown> {
    const sourceValue = Reflect.get(result, step.sourceField)

    if (step.pattern && typeof sourceValue === 'string' && step.targetField) {
      if (step.pattern.length > 1000) {
        throw new Error('Regex pattern exceeds maximum allowed length of 1000 characters')
      }

      let regex: RegExp
      try {
        regex = new RegExp(step.pattern)
      } catch {
        throw new Error(`Invalid regex pattern: ${step.pattern}`)
      }

      const match = regex.exec(sourceValue)
      if (match?.[1]) {
        Reflect.set(result, step.targetField, match[1])
      }
    }

    return result
  }

  private applyDrop(
    result: Record<string, unknown>,
    step: NormalizationStep
  ): Record<string, unknown> | null {
    if (Reflect.get(result, step.sourceField) !== undefined) {
      return null // Drop the entire event
    }

    return result
  }

  private applyDefault(
    result: Record<string, unknown>,
    step: NormalizationStep
  ): Record<string, unknown> {
    if (Reflect.get(result, step.sourceField) === undefined) {
      const targetKey = step.targetField ?? step.sourceField
      Reflect.set(result, targetKey, step.defaultValue)
    }

    return result
  }
}
