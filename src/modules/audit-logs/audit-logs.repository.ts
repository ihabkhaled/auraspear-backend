import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { Prisma } from '@prisma/client'

@Injectable()
export class AuditLogsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(params: {
    where: Prisma.AuditLogWhereInput
    orderBy: Prisma.AuditLogOrderByWithRelationInput
    skip: number
    take: number
  }) {
    return this.prisma.auditLog.findMany(params)
  }

  async count(where: Prisma.AuditLogWhereInput) {
    return this.prisma.auditLog.count({ where })
  }

  async findManyAndCount(params: {
    where: Prisma.AuditLogWhereInput
    orderBy: Prisma.AuditLogOrderByWithRelationInput
    skip: number
    take: number
  }) {
    return Promise.all([
      this.prisma.auditLog.findMany(params),
      this.prisma.auditLog.count({ where: params.where }),
    ])
  }

  async create(data: Prisma.AuditLogUncheckedCreateInput) {
    return this.prisma.auditLog.create({ data })
  }
}
