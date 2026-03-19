import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { JobStatus } from './enums/job.enums'
import { SortOrder } from '../../common/enums'
import { PrismaService } from '../../prisma/prisma.service'
import type { JobTypeCount, ListJobsOptions } from './jobs.types'
import type { Job } from '@prisma/client'

@Injectable()
export class JobRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.JobUncheckedCreateInput): Promise<Job> {
    return this.prisma.job.create({ data })
  }

  async findById(id: string, tenantId: string): Promise<Job | null> {
    return this.prisma.job.findFirst({
      where: { id, tenantId },
    })
  }

  async findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<Job | null> {
    return this.prisma.job.findUnique({
      where: {
        tenantId_idempotencyKey: { tenantId, idempotencyKey },
      },
    })
  }

  async updateStatus(
    id: string,
    tenantId: string,
    data: Prisma.JobUncheckedUpdateInput
  ): Promise<Job> {
    await this.prisma.job.updateMany({
      where: { id, tenantId },
      data,
    })

    return this.prisma.job.findFirstOrThrow({
      where: { id, tenantId },
    })
  }

  async updateMany(params: {
    where: Prisma.JobWhereInput
    data: Prisma.JobUncheckedUpdateManyInput
  }): Promise<Prisma.BatchPayload> {
    return this.prisma.job.updateMany(params)
  }

  async findPendingJobs(limit: number = 10): Promise<Job[]> {
    return this.prisma.job.findMany({
      where: {
        status: { in: [JobStatus.PENDING, JobStatus.RETRYING] },
        OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }],
      },
      orderBy: { createdAt: SortOrder.ASC },
      take: limit,
    })
  }

  async listByTenant(
    tenantId: string,
    options?: ListJobsOptions
  ): Promise<{ data: Job[]; total: number; page: number; limit: number }> {
    const page = options?.page ?? 1
    const limit = options?.limit ?? 20

    const where: Prisma.JobWhereInput = { tenantId }
    if (options?.type) {
      where.type = options.type as Prisma.EnumJobTypeFilter['equals']
    }
    if (options?.status) {
      where.status = options.status as Prisma.EnumJobStatusFilter['equals']
    }

    const [data, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        orderBy: { createdAt: SortOrder.DESC },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.job.count({ where }),
    ])

    return { data, total, page, limit }
  }

  async countByTenantAndStatus(tenantId: string, status: JobStatus): Promise<number> {
    return this.prisma.job.count({
      where: { tenantId, status },
    })
  }

  async countScheduled(tenantId: string, scheduledAfter: Date): Promise<number> {
    return this.prisma.job.count({
      where: {
        tenantId,
        status: { in: [JobStatus.PENDING, JobStatus.RETRYING] },
        scheduledAt: { gt: scheduledAfter },
      },
    })
  }

  async countStaleRunning(tenantId: string, startedBefore: Date): Promise<number> {
    return this.prisma.job.count({
      where: {
        tenantId,
        status: JobStatus.RUNNING,
        startedAt: { lt: startedBefore },
      },
    })
  }

  async groupTypeCounts(tenantId: string): Promise<JobTypeCount[]> {
    const results = await this.prisma.job.groupBy({
      by: ['type'],
      where: { tenantId },
      _count: { _all: true },
    })

    return results.map(result => ({
      type: result.type,
      count: result._count._all,
    }))
  }

  async cancelJob(id: string, tenantId: string): Promise<Prisma.BatchPayload> {
    return this.prisma.job.updateMany({
      where: {
        id,
        tenantId,
        status: { in: [JobStatus.PENDING, JobStatus.RETRYING] },
      },
      data: { status: JobStatus.CANCELLED },
    })
  }

  async retryJob(id: string, tenantId: string, scheduledAt: Date): Promise<Prisma.BatchPayload> {
    return this.prisma.job.updateMany({
      where: {
        id,
        tenantId,
        status: { in: [JobStatus.FAILED, JobStatus.CANCELLED] },
      },
      data: {
        status: JobStatus.PENDING,
        attempts: 0,
        error: null,
        result: Prisma.DbNull,
        startedAt: null,
        completedAt: null,
        scheduledAt,
      },
    })
  }
}
