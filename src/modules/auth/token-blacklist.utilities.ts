import { AppLogFeature, type AppLogOutcome, AppLogSourceType } from '../../common/enums'
import type { AppLogContext } from '../../common/services/app-logger.types'

export function buildBlacklistLogContext(
  action: string,
  outcome: AppLogOutcome,
  metadata?: Record<string, unknown>,
  stackTrace?: string
): AppLogContext {
  return {
    feature: AppLogFeature.AUTH,
    action,
    outcome,
    sourceType: AppLogSourceType.SERVICE,
    className: 'TokenBlacklistService',
    functionName: action,
    ...(metadata ? { metadata } : {}),
    ...(stackTrace ? { stackTrace } : {}),
  }
}

export function extractErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

export function extractErrorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined
}
