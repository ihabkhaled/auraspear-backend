import { Injectable, Logger } from '@nestjs/common'

export interface CorrelationEvent {
  type: string
  timestamp: string
  data: Record<string, unknown>
}

export interface CorrelationResult {
  ruleId: string
  status: 'triggered' | 'not_triggered' | 'error'
  eventsCorrelated: number
  triggeredAt?: string
  description?: string
  durationMs: number
  error?: string
}

interface CorrelationRuleInput {
  id: string
  name: string
  eventTypes: string[]
  threshold: number
  timeWindowMinutes: number
  groupBy?: string
}

@Injectable()
export class CorrelationExecutor {
  private readonly logger = new Logger(CorrelationExecutor.name)

  /**
   * Evaluates a correlation rule against a window of events.
   * Foundation for threshold-based and sequence-based correlation.
   */
  async evaluateRule(
    rule: CorrelationRuleInput,
    events: CorrelationEvent[]
  ): Promise<CorrelationResult> {
    const startTime = Date.now()

    try {
      const windowEnd = new Date()
      const windowStart = new Date(windowEnd.getTime() - rule.timeWindowMinutes * 60 * 1000)

      // Filter events by type and time window
      const relevantEvents = events.filter(event => {
        const eventTime = new Date(event.timestamp)
        return (
          rule.eventTypes.includes(event.type) && eventTime >= windowStart && eventTime <= windowEnd
        )
      })

      // Group by field if specified
      if (rule.groupBy) {
        return this.evaluateWithGroupBy(rule, relevantEvents, startTime)
      }

      if (relevantEvents.length >= rule.threshold) {
        const durationMs = Date.now() - startTime
        return {
          ruleId: rule.id,
          status: 'triggered',
          eventsCorrelated: relevantEvents.length,
          triggeredAt: new Date().toISOString(),
          description: `${String(relevantEvents.length)} matching events within ${String(rule.timeWindowMinutes)}min (threshold: ${String(rule.threshold)})`,
          durationMs,
        }
      }

      return {
        ruleId: rule.id,
        status: 'not_triggered',
        eventsCorrelated: relevantEvents.length,
        durationMs: Date.now() - startTime,
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      this.logger.error(`Correlation rule ${rule.id} evaluation failed: ${errorMessage}`)
      return {
        ruleId: rule.id,
        status: 'error',
        eventsCorrelated: 0,
        durationMs: Date.now() - startTime,
        error: errorMessage,
      }
    }
  }

  private evaluateWithGroupBy(
    rule: CorrelationRuleInput,
    relevantEvents: CorrelationEvent[],
    startTime: number
  ): CorrelationResult {
    const groupByField = rule.groupBy
    if (!groupByField) {
      return {
        ruleId: rule.id,
        status: 'not_triggered',
        eventsCorrelated: 0,
        durationMs: Date.now() - startTime,
      }
    }

    const groups = new Map<string, number>()
    for (const event of relevantEvents) {
      const groupValue = String(event.data[groupByField] ?? 'unknown')
      groups.set(groupValue, (groups.get(groupValue) ?? 0) + 1)
    }

    // Check if any group exceeds threshold
    for (const [groupValue, count] of groups) {
      if (count >= rule.threshold) {
        const durationMs = Date.now() - startTime
        this.logger.warn(
          `Correlation rule ${rule.id} triggered: ${String(count)} events for ${groupByField}=${groupValue}`
        )
        return {
          ruleId: rule.id,
          status: 'triggered',
          eventsCorrelated: count,
          triggeredAt: new Date().toISOString(),
          description: `${String(count)} events for ${groupByField}=${groupValue} within ${String(rule.timeWindowMinutes)}min (threshold: ${String(rule.threshold)})`,
          durationMs,
        }
      }
    }

    return {
      ruleId: rule.id,
      status: 'not_triggered',
      eventsCorrelated: relevantEvents.length,
      durationMs: Date.now() - startTime,
    }
  }
}
