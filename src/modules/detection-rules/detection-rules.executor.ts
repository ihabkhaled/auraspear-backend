import { Injectable, Logger } from '@nestjs/common'
import { DetectionExecutionEngine } from './detection-rules.constants'
import {
  buildDetectionMatchDescription,
  compileDetectionConditions,
  evaluateDetectionProgram,
} from './detection-rules.utilities'
import type {
  DetectionExecutionResult,
  DetectionRuleMatch,
  EvaluatableDetectionRule,
} from './detection-rules.types'

@Injectable()
export class DetectionRulesExecutor {
  private readonly logger = new Logger(DetectionRulesExecutor.name)

  async evaluateRule(
    rule: EvaluatableDetectionRule,
    events: Record<string, unknown>[]
  ): Promise<DetectionExecutionResult> {
    const startTime = Date.now()

    try {
      const matches: DetectionRuleMatch[] = []
      const detectionProgram = compileDetectionConditions(rule.conditions)

      for (const event of events) {
        if (evaluateDetectionProgram(detectionProgram, event)) {
          matches.push({
            ruleId: rule.id,
            ruleName: rule.name,
            severity: rule.severity,
            matchedEvent: event,
            matchedAt: new Date().toISOString(),
            description: buildDetectionMatchDescription(rule.name, detectionProgram.engine),
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
        engine: detectionProgram.engine,
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
        engine: DetectionExecutionEngine.UNKNOWN,
        error: errorMessage,
      }
    }
  }
}
