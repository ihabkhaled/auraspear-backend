import { Injectable, Logger } from '@nestjs/common'

export interface DetectionRuleMatch {
  ruleId: string
  ruleName: string
  severity: string
  matchedEvent: Record<string, unknown>
  matchedAt: string
  description: string
}

export interface DetectionExecutionResult {
  ruleId: string
  status: 'matched' | 'no_match' | 'error'
  matchCount: number
  matches: DetectionRuleMatch[]
  executedAt: string
  durationMs: number
  error?: string
}

interface EvaluatableRule {
  id: string
  name: string
  severity: string
  conditions: Record<string, unknown>
}

@Injectable()
export class DetectionRulesExecutor {
  private readonly logger = new Logger(DetectionRulesExecutor.name)

  /**
   * Evaluates a single detection rule against a batch of events.
   * This is a foundation — actual Sigma/YARA-L parsing would plug in here.
   */
  async evaluateRule(
    rule: EvaluatableRule,
    events: Record<string, unknown>[]
  ): Promise<DetectionExecutionResult> {
    const startTime = Date.now()

    try {
      const matches: DetectionRuleMatch[] = []
      const { conditions } = rule

      for (const event of events) {
        if (this.matchesConditions(event, conditions)) {
          matches.push({
            ruleId: rule.id,
            ruleName: rule.name,
            severity: rule.severity,
            matchedEvent: event,
            matchedAt: new Date().toISOString(),
            description: `Rule "${rule.name}" matched event`,
          })
        }
      }

      const durationMs = Date.now() - startTime
      this.logger.log(
        `Rule ${rule.id} evaluated against ${String(events.length)} events: ${String(matches.length)} matches in ${String(durationMs)}ms`
      )

      return {
        ruleId: rule.id,
        status: matches.length > 0 ? 'matched' : 'no_match',
        matchCount: matches.length,
        matches,
        executedAt: new Date().toISOString(),
        durationMs,
      }
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      this.logger.error(`Rule ${rule.id} evaluation failed: ${errorMessage}`)

      return {
        ruleId: rule.id,
        status: 'error',
        matchCount: 0,
        matches: [],
        executedAt: new Date().toISOString(),
        durationMs,
        error: errorMessage,
      }
    }
  }

  /**
   * Simple field-match condition evaluator.
   * Checks if event fields match the rule's conditions.
   * This is intentionally simple — a real implementation would parse
   * Sigma YAML or YARA-L syntax.
   */
  private matchesConditions(
    event: Record<string, unknown>,
    conditions: Record<string, unknown>
  ): boolean {
    const fieldConditions =
      (conditions['fields'] as Record<string, unknown> | undefined) ?? conditions

    for (const [key, expectedValue] of Object.entries(fieldConditions)) {
      const eventValue = event[key]

      if (eventValue === undefined) {
        return false
      }

      if (typeof expectedValue === 'string' && typeof eventValue === 'string') {
        if (!eventValue.toLowerCase().includes(expectedValue.toLowerCase())) {
          return false
        }
      } else if (eventValue !== expectedValue) {
        return false
      }
    }

    return true
  }
}
