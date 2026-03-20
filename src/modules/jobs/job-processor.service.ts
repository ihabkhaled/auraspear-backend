import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Interval } from '@nestjs/schedule'
import Redis from 'ioredis'
import { JobStatus, JobType } from './enums/job.enums'
import {
  JOB_LOCK_PREFIX,
  JOB_LOCK_TTL_SECONDS,
  STALE_RUNNING_WINDOW_MS,
  POLL_INTERVAL_MS,
  STALE_RECOVERY_INTERVAL_MS,
} from './jobs.constants'
import { JobRepository } from './jobs.repository'
import { JobService } from './jobs.service'
import { placeholderJobHandler } from './jobs.utilities'
import { AppLogFeature, AppLogOutcome, AppLogSourceType, RedisResponse } from '../../common/enums'
import { AppLoggerService } from '../../common/services/app-logger.service'
import type { JobHandler } from './jobs.types'
import type { Job } from '@prisma/client'

@Injectable()
export class JobProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobProcessorService.name)
  private readonly redis: Redis
  private readonly handlers = new Map<JobType, JobHandler>()
  private readonly concurrency: number
  private activeJobs = 0
  private shuttingDown = false
  private redisConnected = false

  constructor(
    private readonly configService: ConfigService,
    private readonly jobService: JobService,
    private readonly jobRepository: JobRepository,
    private readonly appLogger: AppLoggerService
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

    this.redis.on('connect', () => {
      this.redisConnected = true
      this.appLogger.info('Redis connected for job processor', {
        feature: AppLogFeature.JOBS,
        action: 'redisConnect',
        outcome: AppLogOutcome.SUCCESS,
        sourceType: AppLogSourceType.JOB,
        className: 'JobProcessorService',
        functionName: 'constructor',
        metadata: { host, port },
      })
    })

    this.redis.on('error', (error: Error) => {
      this.redisConnected = false
      this.appLogger.error(`Redis connection error in JobProcessor: ${error.message}`, {
        feature: AppLogFeature.JOBS,
        action: 'redisError',
        outcome: AppLogOutcome.FAILURE,
        sourceType: AppLogSourceType.JOB,
        className: 'JobProcessorService',
        functionName: 'constructor',
        metadata: { error: error.message, host, port },
      })
    })

    this.redis.on('close', () => {
      if (!this.shuttingDown) {
        this.redisConnected = false
        this.appLogger.warn('Redis connection closed unexpectedly', {
          feature: AppLogFeature.JOBS,
          action: 'redisClose',
          outcome: AppLogOutcome.WARNING,
          sourceType: AppLogSourceType.JOB,
          className: 'JobProcessorService',
          functionName: 'constructor',
        })
      }
    })

    this.concurrency = this.configService.get<number>('JOB_PROCESSOR_CONCURRENCY', 5)

    this.registerDefaultHandlers()
  }

  onModuleInit(): void {
    this.appLogger.info('Job processor service initialized', {
      feature: AppLogFeature.JOBS,
      action: 'init',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.JOB,
      className: 'JobProcessorService',
      functionName: 'onModuleInit',
      metadata: {
        concurrency: this.concurrency,
        pollIntervalMs: POLL_INTERVAL_MS,
        staleRecoveryIntervalMs: STALE_RECOVERY_INTERVAL_MS,
        registeredHandlers: [...this.handlers.keys()],
      },
    })
  }

  /**
   * Register a job handler for a specific job type.
   */
  registerHandler(type: JobType, handler: JobHandler): void {
    this.handlers.set(type, handler)
    this.appLogger.info(`Handler registered for job type: ${type}`, {
      feature: AppLogFeature.JOBS,
      action: 'registerHandler',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.JOB,
      className: 'JobProcessorService',
      functionName: 'registerHandler',
      metadata: { jobType: type },
    })
  }

  /**
   * Poll for pending jobs every 10 seconds and process them.
   */
  @Interval(POLL_INTERVAL_MS)
  async pollAndProcess(): Promise<void> {
    if (this.shuttingDown) return
    if (this.activeJobs >= this.concurrency) {
      this.appLogger.debug('Poll skipped — concurrency limit reached', {
        feature: AppLogFeature.JOBS,
        action: 'poll',
        outcome: AppLogOutcome.SKIPPED,
        sourceType: AppLogSourceType.JOB,
        className: 'JobProcessorService',
        functionName: 'pollAndProcess',
        metadata: { activeJobs: this.activeJobs, concurrency: this.concurrency },
      })
      return
    }

    if (!this.redisConnected) {
      this.appLogger.warn('Poll skipped — Redis not connected, jobs cannot acquire locks', {
        feature: AppLogFeature.JOBS,
        action: 'poll',
        outcome: AppLogOutcome.SKIPPED,
        sourceType: AppLogSourceType.JOB,
        className: 'JobProcessorService',
        functionName: 'pollAndProcess',
        metadata: { reason: 'redis_disconnected' },
      })
      return
    }

    try {
      const availableSlots = this.concurrency - this.activeJobs
      const pendingJobs = await this.jobRepository.findPendingJobs(availableSlots)

      if (pendingJobs.length > 0) {
        this.appLogger.info(`Poll found ${String(pendingJobs.length)} pending job(s)`, {
          feature: AppLogFeature.JOBS,
          action: 'poll',
          outcome: AppLogOutcome.SUCCESS,
          sourceType: AppLogSourceType.JOB,
          className: 'JobProcessorService',
          functionName: 'pollAndProcess',
          metadata: {
            pendingCount: pendingJobs.length,
            availableSlots,
            activeJobs: this.activeJobs,
            jobIds: pendingJobs.map(pending => pending.id),
            jobTypes: pendingJobs.map(pending => pending.type),
          },
        })
      }

      const lockResults = await Promise.all(
        pendingJobs.map(async job => ({
          job,
          acquired: await this.acquireLock(job.id),
        }))
      )

      let lockedCount = 0
      let skippedCount = 0

      for (const { job, acquired } of lockResults) {
        if (this.activeJobs >= this.concurrency) break
        if (this.shuttingDown) break

        if (!acquired) {
          skippedCount += 1
          this.appLogger.debug(
            `Lock not acquired for job ${job.id} — already locked by another instance`,
            {
              feature: AppLogFeature.JOBS,
              action: 'acquireLock',
              outcome: AppLogOutcome.SKIPPED,
              sourceType: AppLogSourceType.JOB,
              className: 'JobProcessorService',
              functionName: 'pollAndProcess',
              tenantId: job.tenantId,
              targetResource: 'Job',
              targetResourceId: job.id,
              metadata: { jobType: job.type },
            }
          )
          continue
        }

        lockedCount += 1
        this.activeJobs += 1
        void this.processJob(job).finally(() => {
          this.activeJobs -= 1
          void this.releaseLock(job.id)
        })
      }

      if (lockedCount > 0 || skippedCount > 0) {
        this.appLogger.info(
          `Poll dispatched ${String(lockedCount)} job(s), skipped ${String(skippedCount)} (locked)`,
          {
            feature: AppLogFeature.JOBS,
            action: 'poll',
            outcome: AppLogOutcome.SUCCESS,
            sourceType: AppLogSourceType.JOB,
            className: 'JobProcessorService',
            functionName: 'pollAndProcess',
            metadata: { lockedCount, skippedCount, activeJobs: this.activeJobs },
          }
        )
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      this.appLogger.error(`Job poll failed: ${errorMessage}`, {
        feature: AppLogFeature.JOBS,
        action: 'poll',
        outcome: AppLogOutcome.FAILURE,
        sourceType: AppLogSourceType.JOB,
        className: 'JobProcessorService',
        functionName: 'pollAndProcess',
        stackTrace: error instanceof Error ? error.stack : undefined,
        metadata: { error: errorMessage },
      })
    }
  }

  /**
   * Recover stale jobs that have been RUNNING for longer than the stale window.
   * Runs every 5 minutes.
   */
  @Interval(STALE_RECOVERY_INTERVAL_MS)
  async recoverStaleJobs(): Promise<void> {
    if (this.shuttingDown) return

    try {
      const staleThreshold = new Date(Date.now() - STALE_RUNNING_WINDOW_MS)

      const result = await this.jobRepository.updateMany({
        where: {
          status: JobStatus.RUNNING,
          startedAt: { lt: staleThreshold },
        },
        data: {
          status: JobStatus.PENDING,
          error: 'Recovered from stale RUNNING state — job exceeded maximum execution window',
          startedAt: null,
          scheduledAt: null,
        },
      })

      if (result.count > 0) {
        this.appLogger.warn(
          `Recovered ${String(result.count)} stale job(s) from RUNNING to PENDING`,
          {
            feature: AppLogFeature.JOBS,
            action: 'recoverStaleJobs',
            outcome: AppLogOutcome.WARNING,
            sourceType: AppLogSourceType.CRON,
            className: 'JobProcessorService',
            functionName: 'recoverStaleJobs',
            metadata: {
              recoveredCount: result.count,
              staleThresholdMs: STALE_RUNNING_WINDOW_MS,
              staleThresholdDate: staleThreshold.toISOString(),
            },
          }
        )
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      this.appLogger.error(`Stale job recovery failed: ${errorMessage}`, {
        feature: AppLogFeature.JOBS,
        action: 'recoverStaleJobs',
        outcome: AppLogOutcome.FAILURE,
        sourceType: AppLogSourceType.CRON,
        className: 'JobProcessorService',
        functionName: 'recoverStaleJobs',
        stackTrace: error instanceof Error ? error.stack : undefined,
        metadata: { error: errorMessage },
      })
    }
  }

  /**
   * Process a single job: mark running, execute handler, mark completed/failed.
   */
  private async processJob(job: Job): Promise<void> {
    const startTime = Date.now()
    const handler = this.handlers.get(job.type as JobType)

    if (!handler) {
      const errorMessage = `No handler registered for job type: ${job.type}`
      this.appLogger.error(errorMessage, {
        feature: AppLogFeature.JOBS,
        action: 'execute',
        outcome: AppLogOutcome.FAILURE,
        sourceType: AppLogSourceType.JOB,
        className: 'JobProcessorService',
        functionName: 'processJob',
        tenantId: job.tenantId,
        targetResource: 'Job',
        targetResourceId: job.id,
        metadata: { jobType: job.type, reason: 'no_handler' },
      })
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

      this.appLogger.info(`Job started: ${job.type}`, {
        feature: AppLogFeature.JOBS,
        action: 'execute',
        sourceType: AppLogSourceType.JOB,
        className: 'JobProcessorService',
        functionName: 'processJob',
        tenantId: job.tenantId,
        targetResource: 'Job',
        targetResourceId: job.id,
        metadata: {
          jobType: job.type,
          attempt: job.attempts + 1,
          maxAttempts: job.maxAttempts,
          payload: job.payload ?? null,
          createdBy: job.createdBy ?? null,
        },
      })

      const result = await handler(job)
      const durationMs = Date.now() - startTime

      await this.jobService.markCompleted(job.id, job.tenantId, result)

      this.appLogger.info(`Job completed: ${job.type}`, {
        feature: AppLogFeature.JOBS,
        action: 'execute',
        outcome: AppLogOutcome.SUCCESS,
        sourceType: AppLogSourceType.JOB,
        className: 'JobProcessorService',
        functionName: 'processJob',
        tenantId: job.tenantId,
        targetResource: 'Job',
        targetResourceId: job.id,
        metadata: {
          jobType: job.type,
          durationMs,
          attempt: job.attempts + 1,
          result,
        },
      })
    } catch (error) {
      const durationMs = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      await this.jobService.markFailed(
        job.id,
        job.tenantId,
        errorMessage,
        job.attempts,
        job.maxAttempts
      )

      const willRetry = job.attempts + 1 < job.maxAttempts
      const logLevel = willRetry ? 'warn' : 'error'
      const outcomeValue = willRetry ? AppLogOutcome.WARNING : AppLogOutcome.FAILURE

      const logContext = {
        feature: AppLogFeature.JOBS,
        action: 'execute',
        outcome: outcomeValue,
        sourceType: AppLogSourceType.JOB as string,
        className: 'JobProcessorService',
        functionName: 'processJob',
        tenantId: job.tenantId,
        targetResource: 'Job',
        targetResourceId: job.id,
        stackTrace: error instanceof Error ? error.stack : undefined,
        metadata: {
          jobType: job.type,
          durationMs,
          attempt: job.attempts + 1,
          maxAttempts: job.maxAttempts,
          willRetry,
          error: errorMessage,
        },
      }

      if (logLevel === 'warn') {
        this.appLogger.warn(`Job failed (will retry): ${job.type}`, logContext)
      } else {
        this.appLogger.error(`Job failed permanently: ${job.type}`, logContext)
      }
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
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      this.appLogger.warn(`Failed to acquire Redis lock for job ${jobId}: ${errorMessage}`, {
        feature: AppLogFeature.JOBS,
        action: 'acquireLock',
        outcome: AppLogOutcome.FAILURE,
        sourceType: AppLogSourceType.JOB,
        className: 'JobProcessorService',
        functionName: 'acquireLock',
        targetResource: 'Job',
        targetResourceId: jobId,
        metadata: { error: errorMessage, reason: 'redis_error' },
      })
      return false
    }
  }

  private async releaseLock(jobId: string): Promise<void> {
    try {
      const key = `${JOB_LOCK_PREFIX}${jobId}`
      await this.redis.del(key)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      this.appLogger.warn(`Failed to release Redis lock for job ${jobId}: ${errorMessage}`, {
        feature: AppLogFeature.JOBS,
        action: 'releaseLock',
        outcome: AppLogOutcome.WARNING,
        sourceType: AppLogSourceType.JOB,
        className: 'JobProcessorService',
        functionName: 'releaseLock',
        targetResource: 'Job',
        targetResourceId: jobId,
        metadata: { error: errorMessage },
      })
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
    this.appLogger.info('Job processor service shutting down', {
      feature: AppLogFeature.JOBS,
      action: 'shutdown',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.JOB,
      className: 'JobProcessorService',
      functionName: 'onModuleDestroy',
      metadata: { activeJobs: this.activeJobs },
    })
  }
}
