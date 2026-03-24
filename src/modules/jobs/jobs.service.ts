import { Injectable, Logger } from '@nestjs/common'
import { JobStatus } from './enums/job.enums'
import { JobRepository } from './jobs.repository'
import {
  buildJobStats,
  computeRetryScheduledAt,
  getStaleRunningThreshold,
  shouldRetryJob,
} from './jobs.utilities'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { AppLoggerService } from '../../common/services/app-logger.service'
import type { EnqueueParameters, JobRuntimeStats, ListJobsOptions } from './jobs.types'
import type { AppLogContext } from '../../common/services/app-logger.types'
import type { Job, Prisma } from '@prisma/client'

@Injectable()
export class JobService {
  private readonly logger = new Logger(JobService.name)

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly appLogger: AppLoggerService
  ) {}

  async enqueue(params: EnqueueParameters): Promise<Job> {
    const existing = await this.checkIdempotency(params)
    if (existing) return existing

    const job = await this.jobRepository.create({
      tenantId: params.tenantId,
      type: params.type,
      payload: (params.payload ?? {}) as Prisma.InputJsonValue,
      maxAttempts: params.maxAttempts ?? 3,
      idempotencyKey: params.idempotencyKey,
      scheduledAt: params.scheduledAt,
      createdBy: params.createdBy,
    })

    this.logEnqueued(params, job)
    return job
  }

  async getJob(id: string, tenantId: string): Promise<Job | null> {
    return this.jobRepository.findById(id, tenantId)
  }

  async getJobOrThrow(id: string, tenantId: string): Promise<Job> {
    const job = await this.jobRepository.findById(id, tenantId)

    if (!job) {
      throw new BusinessException(404, `Job ${id} not found`, 'errors.jobs.notFound')
    }

    return job
  }

  async listJobs(
    tenantId: string,
    options?: ListJobsOptions
  ): Promise<{ data: Job[]; total: number; page: number; limit: number }> {
    return this.jobRepository.listByTenant(tenantId, options)
  }

  async markRunning(jobId: string, tenantId: string): Promise<Job> {
    return this.jobRepository.updateStatus(jobId, tenantId, {
      status: JobStatus.RUNNING,
      error: null,
      scheduledAt: null,
      startedAt: new Date(),
    })
  }

  async markCompleted(
    jobId: string,
    tenantId: string,
    result?: Record<string, unknown>
  ): Promise<Job> {
    return this.jobRepository.updateStatus(jobId, tenantId, {
      status: JobStatus.COMPLETED,
      result: (result as Prisma.InputJsonValue) ?? undefined,
      error: null,
      scheduledAt: null,
      completedAt: new Date(),
    })
  }

  async markFailed(
    jobId: string,
    tenantId: string,
    error: string,
    currentAttempts: number,
    maxAttempts: number
  ): Promise<{ retrying: boolean }> {
    const nextAttempt = currentAttempts + 1
    const retrying = shouldRetryJob(nextAttempt, maxAttempts)
    const newStatus = retrying ? JobStatus.RETRYING : JobStatus.FAILED

    await this.jobRepository.updateStatus(jobId, tenantId, {
      status: newStatus,
      error,
      attempts: nextAttempt,
      scheduledAt: retrying ? computeRetryScheduledAt(nextAttempt) : null,
      completedAt: retrying ? null : new Date(),
    })

    this.logMarkFailed(jobId, tenantId, error, nextAttempt, maxAttempts, retrying, newStatus)
    return { retrying }
  }

  async markUnrecoverableFailure(
    jobId: string,
    tenantId: string,
    error: string,
    attempts: number
  ): Promise<Job> {
    this.appLogger.error(`Job ${jobId} marked as unrecoverable failure`, {
      feature: AppLogFeature.JOBS,
      action: 'markUnrecoverableFailure',
      outcome: AppLogOutcome.FAILURE,
      sourceType: AppLogSourceType.SERVICE,
      className: 'JobService',
      functionName: 'markUnrecoverableFailure',
      tenantId,
      targetResource: 'Job',
      targetResourceId: jobId,
      metadata: { error, attempts },
    })

    return this.jobRepository.updateStatus(jobId, tenantId, {
      status: JobStatus.FAILED,
      error,
      attempts,
      scheduledAt: null,
      completedAt: new Date(),
    })
  }

  async getStats(tenantId: string): Promise<JobRuntimeStats> {
    const now = new Date()
    const [pending, running, retrying, failed, completed, cancelled, delayed, staleRunning, types] =
      await Promise.all([
        this.jobRepository.countByTenantAndStatus(tenantId, JobStatus.PENDING),
        this.jobRepository.countByTenantAndStatus(tenantId, JobStatus.RUNNING),
        this.jobRepository.countByTenantAndStatus(tenantId, JobStatus.RETRYING),
        this.jobRepository.countByTenantAndStatus(tenantId, JobStatus.FAILED),
        this.jobRepository.countByTenantAndStatus(tenantId, JobStatus.COMPLETED),
        this.jobRepository.countByTenantAndStatus(tenantId, JobStatus.CANCELLED),
        this.jobRepository.countScheduled(tenantId, now),
        this.jobRepository.countStaleRunning(tenantId, getStaleRunningThreshold()),
        this.jobRepository.groupTypeCounts(tenantId),
      ])

    return buildJobStats({
      pending,
      running,
      retrying,
      failed,
      completed,
      cancelled,
      delayed,
      staleRunning,
      typeBreakdown: types,
    })
  }

  async cancelJob(id: string, tenantId: string): Promise<boolean> {
    const job = await this.getJobOrThrow(id, tenantId)

    const result = await this.jobRepository.cancelJob(id, tenantId)
    if (result.count > 0) {
      this.appLogger.info(`Job ${id} cancelled`, {
        feature: AppLogFeature.JOBS,
        action: 'cancelJob',
        outcome: AppLogOutcome.SUCCESS,
        sourceType: AppLogSourceType.SERVICE,
        className: 'JobService',
        functionName: 'cancelJob',
        tenantId,
        targetResource: 'Job',
        targetResourceId: id,
        metadata: { jobType: job.type, previousStatus: job.status },
      })
      return true
    }

    throw new BusinessException(
      409,
      `Job ${id} cannot be cancelled in its current state`,
      'errors.jobs.cannotCancel'
    )
  }

  async cancelAllJobs(tenantId: string): Promise<number> {
    const result = await this.jobRepository.cancelAllPendingJobs(tenantId)

    this.appLogger.info(`Cancelled ${String(result.count)} pending/retrying job(s)`, {
      feature: AppLogFeature.JOBS,
      action: 'cancelAllJobs',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'JobService',
      functionName: 'cancelAllJobs',
      tenantId,
      metadata: { cancelledCount: result.count },
    })

    return result.count
  }

  async retryJob(id: string, tenantId: string): Promise<Job> {
    const job = await this.getJobOrThrow(id, tenantId)

    const retryableStatuses = new Set<string>([JobStatus.FAILED, JobStatus.CANCELLED])

    if (!retryableStatuses.has(job.status)) {
      throw new BusinessException(
        409,
        `Job ${id} cannot be retried in status ${job.status}`,
        'errors.jobs.cannotRetry'
      )
    }

    const result = await this.jobRepository.retryJob(id, tenantId, new Date())
    if (result.count === 0) {
      throw new BusinessException(409, `Job ${id} could not be retried`, 'errors.jobs.cannotRetry')
    }

    this.appLogger.info(`Job ${id} retried`, {
      feature: AppLogFeature.JOBS,
      action: 'retryJob',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'JobService',
      functionName: 'retryJob',
      tenantId,
      targetResource: 'Job',
      targetResourceId: id,
      metadata: { jobType: job.type, previousStatus: job.status },
    })

    return this.getJobOrThrow(id, tenantId)
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Helpers                                                  */
  /* ---------------------------------------------------------------- */

  private async checkIdempotency(params: EnqueueParameters): Promise<Job | null> {
    if (!params.idempotencyKey) return null

    const existing = await this.jobRepository.findByIdempotencyKey(
      params.tenantId,
      params.idempotencyKey
    )

    if (existing) {
      this.appLogger.debug('Job deduplicated by idempotency key', {
        feature: AppLogFeature.JOBS,
        action: 'enqueue',
        outcome: AppLogOutcome.SKIPPED,
        sourceType: AppLogSourceType.SERVICE,
        className: 'JobService',
        functionName: 'enqueue',
        tenantId: params.tenantId,
        targetResource: 'Job',
        targetResourceId: existing.id,
        metadata: {
          jobType: params.type,
          idempotencyKey: params.idempotencyKey,
          existingJobId: existing.id,
          existingStatus: existing.status,
        },
      })
    }

    return existing ?? null
  }

  private logEnqueued(params: EnqueueParameters, job: Job): void {
    this.appLogger.info(`Job enqueued: ${params.type}`, {
      feature: AppLogFeature.JOBS,
      action: 'enqueue',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'JobService',
      functionName: 'enqueue',
      tenantId: params.tenantId,
      targetResource: 'Job',
      targetResourceId: job.id,
      metadata: {
        jobType: params.type,
        maxAttempts: params.maxAttempts ?? 3,
        scheduledAt: params.scheduledAt?.toISOString() ?? null,
        createdBy: params.createdBy ?? null,
        hasPayload: Boolean(params.payload),
      },
    })
  }

  private logMarkFailed(
    jobId: string,
    tenantId: string,
    error: string,
    nextAttempt: number,
    maxAttempts: number,
    retrying: boolean,
    newStatus: string
  ): void {
    const logContext = this.buildMarkFailedContext(
      jobId, tenantId, error, nextAttempt, maxAttempts, retrying, newStatus
    )

    if (retrying) {
      this.appLogger.warn(
        `Job ${jobId} failed, scheduling retry ${String(nextAttempt)}/${String(maxAttempts)}`,
        logContext
      )
    } else {
      this.appLogger.error(
        `Job ${jobId} failed permanently after ${String(maxAttempts)} attempts`,
        logContext
      )
    }
  }

  private buildMarkFailedContext(
    jobId: string,
    tenantId: string,
    error: string,
    nextAttempt: number,
    maxAttempts: number,
    retrying: boolean,
    newStatus: string
  ): AppLogContext {
    return {
      feature: AppLogFeature.JOBS,
      action: 'markFailed',
      outcome: retrying ? AppLogOutcome.WARNING : AppLogOutcome.FAILURE,
      sourceType: AppLogSourceType.SERVICE,
      className: 'JobService',
      functionName: 'markFailed',
      tenantId,
      targetResource: 'Job',
      targetResourceId: jobId,
      metadata: {
        attempt: nextAttempt,
        maxAttempts,
        error,
        newStatus,
        willRetry: retrying,
      },
    }
  }
}
