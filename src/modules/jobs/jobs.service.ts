import { Injectable, Logger } from '@nestjs/common'
import { JobStatus } from './enums/job.enums'
import { JobRepository } from './jobs.repository'
import {
  buildJobStats,
  computeRetryScheduledAt,
  getStaleRunningThreshold,
  shouldRetryJob,
  type JobRuntimeStats,
} from './jobs.utilities'
import { BusinessException } from '../../common/exceptions/business.exception'
import type { Job, Prisma } from '@prisma/client'

interface EnqueueParameters {
  tenantId: string
  type: string
  payload?: Record<string, unknown>
  maxAttempts?: number
  idempotencyKey?: string
  scheduledAt?: Date
  createdBy?: string
}

@Injectable()
export class JobService {
  private readonly logger = new Logger(JobService.name)

  constructor(private readonly jobRepository: JobRepository) {}

  async enqueue(params: EnqueueParameters): Promise<Job> {
    // Idempotency check
    if (params.idempotencyKey) {
      const existing = await this.jobRepository.findByIdempotencyKey(
        params.tenantId,
        params.idempotencyKey
      )
      if (existing) {
        this.logger.log(
          `Job already exists for idempotency key ${params.idempotencyKey}, returning existing job ${existing.id}`
        )
        return existing
      }
    }

    const job = await this.jobRepository.create({
      tenantId: params.tenantId,
      type: params.type as never,
      payload: (params.payload ?? {}) as Prisma.InputJsonValue,
      maxAttempts: params.maxAttempts ?? 3,
      idempotencyKey: params.idempotencyKey,
      scheduledAt: params.scheduledAt,
      createdBy: params.createdBy,
    })

    this.logger.log(`Job ${job.id} enqueued: type=${params.type} tenant=${params.tenantId}`)
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
    options?: { type?: string; status?: string; page?: number; limit?: number }
  ): Promise<{ data: Job[]; total: number; page: number; limit: number }> {
    return this.jobRepository.listByTenant(tenantId, options)
  }

  async markRunning(jobId: string): Promise<Job> {
    return this.jobRepository.updateStatus(jobId, {
      status: JobStatus.RUNNING,
      error: null,
      scheduledAt: null,
      startedAt: new Date(),
    })
  }

  async markCompleted(jobId: string, result?: Record<string, unknown>): Promise<Job> {
    return this.jobRepository.updateStatus(jobId, {
      status: JobStatus.COMPLETED,
      result: (result as Prisma.InputJsonValue) ?? undefined,
      error: null,
      scheduledAt: null,
      completedAt: new Date(),
    })
  }

  async markFailed(
    jobId: string,
    error: string,
    currentAttempts: number,
    maxAttempts: number
  ): Promise<{ retrying: boolean }> {
    const nextAttempt = currentAttempts + 1
    const retrying = shouldRetryJob(nextAttempt, maxAttempts)
    const newStatus = retrying ? JobStatus.RETRYING : JobStatus.FAILED

    await this.jobRepository.updateStatus(jobId, {
      status: newStatus,
      error,
      attempts: nextAttempt,
      scheduledAt: retrying ? computeRetryScheduledAt(nextAttempt) : null,
      completedAt: retrying ? null : new Date(),
    })

    if (retrying) {
      this.logger.warn(`Job ${jobId} failed (attempt ${nextAttempt}/${maxAttempts}), will retry`)
    } else {
      this.logger.error(`Job ${jobId} failed permanently after ${maxAttempts} attempts: ${error}`)
    }

    return { retrying }
  }

  async markUnrecoverableFailure(jobId: string, error: string, attempts: number): Promise<Job> {
    return this.jobRepository.updateStatus(jobId, {
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
    await this.getJobOrThrow(id, tenantId)

    const result = await this.jobRepository.cancelJob(id, tenantId)
    if (result.count > 0) {
      this.logger.log(`Job ${id} cancelled`)
      return true
    }

    throw new BusinessException(
      409,
      `Job ${id} cannot be cancelled in its current state`,
      'errors.jobs.cannotCancel'
    )
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

    this.logger.log(`Job ${id} retried`)
    return this.getJobOrThrow(id, tenantId)
  }
}
