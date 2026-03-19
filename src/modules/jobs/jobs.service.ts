import { Injectable, Logger } from '@nestjs/common'
import { JobStatus } from './enums/job.enums'
import { JobRepository } from './jobs.repository'
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

  async listJobs(
    tenantId: string,
    options?: { type?: string; status?: string; page?: number; limit?: number }
  ): Promise<{ data: Job[]; total: number; page: number; limit: number }> {
    return this.jobRepository.listByTenant(tenantId, options)
  }

  async markRunning(jobId: string): Promise<Job> {
    return this.jobRepository.updateStatus(jobId, {
      status: JobStatus.RUNNING,
      startedAt: new Date(),
    })
  }

  async markCompleted(jobId: string, result?: Record<string, unknown>): Promise<Job> {
    return this.jobRepository.updateStatus(jobId, {
      status: JobStatus.COMPLETED,
      result: (result as Prisma.InputJsonValue) ?? undefined,
      completedAt: new Date(),
    })
  }

  async markFailed(
    jobId: string,
    error: string,
    currentAttempts: number,
    maxAttempts: number
  ): Promise<{ retrying: boolean }> {
    const shouldRetry = currentAttempts < maxAttempts
    const newStatus = shouldRetry ? JobStatus.RETRYING : JobStatus.FAILED

    await this.jobRepository.updateStatus(jobId, {
      status: newStatus,
      error,
      attempts: currentAttempts + 1,
      completedAt: shouldRetry ? undefined : new Date(),
    })

    if (shouldRetry) {
      this.logger.warn(
        `Job ${jobId} failed (attempt ${currentAttempts + 1}/${maxAttempts}), will retry`
      )
    } else {
      this.logger.error(`Job ${jobId} failed permanently after ${maxAttempts} attempts: ${error}`)
    }

    return { retrying: shouldRetry }
  }

  async cancelJob(id: string, tenantId: string): Promise<boolean> {
    const result = await this.jobRepository.cancelJob(id, tenantId)
    if (result.count > 0) {
      this.logger.log(`Job ${id} cancelled`)
    }
    return result.count > 0
  }
}
