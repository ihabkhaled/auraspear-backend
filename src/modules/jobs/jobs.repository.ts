import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { Prisma, Job } from '@prisma/client'

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

  async updateStatus(id: string, data: Prisma.JobUncheckedUpdateInput): Promise<Job> {
    return this.prisma.job.update({
      where: { id },
      data,
    })
  }

  async findPendingJobs(limit: number = 10): Promise<Job[]> {
    return this.prisma.job.findMany({
      where: {
        status: { in: ['pending', 'retrying'] },
        OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }],
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    })
  }

  async listByTenant(
    tenantId: string,
    options?: { type?: string; status?: string; page?: number; limit?: number }
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
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.job.count({ where }),
    ])

    return { data, total, page, limit }
  }

  async cancelJob(id: string, tenantId: string): Promise<Prisma.BatchPayload> {
    return this.prisma.job.updateMany({
      where: {
        id,
        tenantId,
        status: { in: ['pending', 'retrying'] },
      },
      data: { status: 'cancelled' },
    })
  }
}
