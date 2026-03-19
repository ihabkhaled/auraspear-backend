import { JobStatus } from './enums/job.enums'

const BASE_RETRY_DELAY_MS = 30_000
const MAX_RETRY_DELAY_MS = 15 * 60_000
const STALE_RUNNING_WINDOW_MS = 30 * 60_000

export interface JobRuntimeStats {
  total: number
  pending: number
  running: number
  retrying: number
  failed: number
  completed: number
  cancelled: number
  delayed: number
  staleRunning: number
  typeBreakdown: Array<{ type: string; count: number }>
}

export function computeRetryScheduledAt(nextAttempt: number): Date {
  const exponent = Math.max(nextAttempt - 1, 0)
  const delayMs = Math.min(BASE_RETRY_DELAY_MS * 2 ** exponent, MAX_RETRY_DELAY_MS)
  return new Date(Date.now() + delayMs)
}

export function shouldRetryJob(nextAttempt: number, maxAttempts: number): boolean {
  return nextAttempt < maxAttempts
}

export function getStaleRunningThreshold(): Date {
  return new Date(Date.now() - STALE_RUNNING_WINDOW_MS)
}

export function buildJobStats(params: {
  pending: number
  running: number
  retrying: number
  failed: number
  completed: number
  cancelled: number
  delayed: number
  staleRunning: number
  typeBreakdown: Array<{ type: string; count: number }>
}): JobRuntimeStats {
  const total =
    params.pending +
    params.running +
    params.retrying +
    params.failed +
    params.completed +
    params.cancelled

  return {
    total,
    pending: params.pending,
    running: params.running,
    retrying: params.retrying,
    failed: params.failed,
    completed: params.completed,
    cancelled: params.cancelled,
    delayed: params.delayed,
    staleRunning: params.staleRunning,
    typeBreakdown: params.typeBreakdown,
  }
}

export function isJobTerminal(status: JobStatus): boolean {
  return [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED].includes(status)
}
