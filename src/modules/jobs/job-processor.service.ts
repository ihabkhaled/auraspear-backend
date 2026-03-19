import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Interval } from '@nestjs/schedule'
import Redis from 'ioredis'
import { JobType } from './enums/job.enums'
import { JOB_LOCK_PREFIX, JOB_LOCK_TTL_SECONDS } from './jobs.constants'
import { JobRepository } from './jobs.repository'
import { JobService } from './jobs.service'
import { placeholderJobHandler } from './jobs.utilities'
import { RedisResponse } from '../../common/enums'
import type { JobHandler } from './jobs.types'
import type { Job } from '@prisma/client'

@Injectable()
export class JobProcessorService implements OnModuleDestroy {
  private readonly logger = new Logger(JobProcessorService.name)
  private readonly redis: Redis
  private readonly handlers = new Map<JobType, JobHandler>()
  private readonly concurrency: number
  private activeJobs = 0
  private shuttingDown = false

  constructor(
    private readonly configService: ConfigService,
    private readonly jobService: JobService,
    private readonly jobRepository: JobRepository
  ) {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost')
    const port = this.configService.get<number>('REDIS_PORT', 6379)
    const password = this.configService.get<string>('REDIS_PASSWORD', '')

    this.redis = new Redis({
      host,
      port,
      password: password || undefined,
      connectTimeout: 5000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    })

    this.redis.on('error', (error: Error) => {
      this.logger.warn(`Redis connection error in JobProcessor: ${error.message}`)
    })

    this.concurrency = this.configService.get<number>('JOB_PROCESSOR_CONCURRENCY', 5)

    this.registerDefaultHandlers()
  }

  /**
   * Register a job handler for a specific job type.
   */
  registerHandler(type: JobType, handler: JobHandler): void {
    this.handlers.set(type, handler)
    this.logger.log(`Registered handler for job type: ${type}`)
  }

  /**
   * Poll for pending jobs every 10 seconds and process them.
   */
  @Interval(10_000)
  async pollAndProcess(): Promise<void> {
    if (this.shuttingDown) return
    if (this.activeJobs >= this.concurrency) return

    try {
      const availableSlots = this.concurrency - this.activeJobs
      const pendingJobs = await this.jobRepository.findPendingJobs(availableSlots)
      const lockResults = await Promise.all(
        pendingJobs.map(async job => ({
          job,
          acquired: await this.acquireLock(job.id),
        }))
      )

      for (const { job, acquired } of lockResults) {
        if (this.activeJobs >= this.concurrency) break
        if (this.shuttingDown) break
        if (!acquired) continue

        this.activeJobs += 1
        void this.processJob(job).finally(() => {
          this.activeJobs -= 1
          void this.releaseLock(job.id)
        })
      }
    } catch (error) {
      this.logger.error(
        `Job poll failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Process a single job: mark running, execute handler, mark completed/failed.
   */
  private async processJob(job: Job): Promise<void> {
    const handler = this.handlers.get(job.type as JobType)
    if (!handler) {
      const errorMessage = `No handler registered for job type: ${job.type}`
      this.logger.error(`${errorMessage}. Marking job ${job.id} as failed`)
      await this.jobService.markUnrecoverableFailure(
        job.id,
        job.tenantId,
        errorMessage,
        job.attempts + 1
      )
      return
    }

    try {
      await this.jobService.markRunning(job.id, job.tenantId)
      this.logger.log(`Processing job ${job.id} (type=${job.type}, tenant=${job.tenantId})`)

      const result = await handler(job)
      await this.jobService.markCompleted(job.id, job.tenantId, result)

      this.logger.log(`Job ${job.id} completed successfully`)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      this.logger.error(`Job ${job.id} failed: ${errorMessage}`)

      await this.jobService.markFailed(
        job.id,
        job.tenantId,
        errorMessage,
        job.attempts,
        job.maxAttempts
      )
    }
  }

  /**
   * Distributed lock via Redis SET NX EX to prevent duplicate processing.
   */
  private async acquireLock(jobId: string): Promise<boolean> {
    try {
      const key = `${JOB_LOCK_PREFIX}${jobId}`
      const result = await this.redis.set(key, '1', 'EX', JOB_LOCK_TTL_SECONDS, 'NX')
      return result === RedisResponse.OK
    } catch {
      return false
    }
  }

  private async releaseLock(jobId: string): Promise<void> {
    try {
      const key = `${JOB_LOCK_PREFIX}${jobId}`
      await this.redis.del(key)
    } catch {
      // Lock will expire via TTL
    }
  }

  /**
   * Register placeholder handlers for all known job types.
   * Real implementations will override these via registerHandler().
   */
  private registerDefaultHandlers(): void {
    const jobTypes = Object.values(JobType)
    for (const type of jobTypes) {
      this.handlers.set(type, placeholderJobHandler)
    }
  }

  onModuleDestroy(): void {
    this.shuttingDown = true
    this.redis.disconnect()
    this.logger.log('JobProcessorService shutting down')
  }
}
