import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { Prisma } from '@prisma/client'

@Injectable()
export class UebaRepository {
  constructor(private readonly prisma: PrismaService) {}

  /* ---------------------------------------------------------------- */
  /* UEBA ENTITY QUERIES                                                */
  /* ---------------------------------------------------------------- */

  async findManyEntitiesWithCount(params: {
    where: Prisma.UebaEntityWhereInput
    orderBy: Prisma.UebaEntityOrderByWithRelationInput
    skip: number
    take: number
  }) {
    return this.prisma.uebaEntity.findMany({
      ...params,
      include: { _count: { select: { anomalies: true } } },
    })
  }

  async countEntities(where: Prisma.UebaEntityWhereInput) {
    return this.prisma.uebaEntity.count({ where })
  }

  async findFirstEntityWithCount(params: { where: Prisma.UebaEntityWhereInput }) {
    return this.prisma.uebaEntity.findFirst({
      ...params,
      include: { _count: { select: { anomalies: true } } },
    })
  }

  async createEntity(data: Prisma.UebaEntityCreateInput) {
    return this.prisma.uebaEntity.create({
      data,
      include: { _count: { select: { anomalies: true } } },
    })
  }

  async updateEntity(params: {
    where: Prisma.UebaEntityWhereUniqueInput
    data: Prisma.UebaEntityUpdateInput
  }) {
    return this.prisma.uebaEntity.update({
      ...params,
      include: { _count: { select: { anomalies: true } } },
    })
  }

  async deleteEntity(where: Prisma.UebaEntityWhereUniqueInput) {
    return this.prisma.uebaEntity.delete({ where })
  }

  /* ---------------------------------------------------------------- */
  /* UEBA ANOMALY QUERIES                                               */
  /* ---------------------------------------------------------------- */

  async findManyAnomaliesWithEntity(params: {
    where: Prisma.UebaAnomalyWhereInput
    orderBy: Prisma.UebaAnomalyOrderByWithRelationInput
    skip: number
    take: number
  }) {
    return this.prisma.uebaAnomaly.findMany({
      ...params,
      include: { entity: { select: { entityName: true, entityType: true } } },
    })
  }

  async countAnomalies(where: Prisma.UebaAnomalyWhereInput) {
    return this.prisma.uebaAnomaly.count({ where })
  }

  async findFirstAnomaly(params: { where: Prisma.UebaAnomalyWhereInput }) {
    return this.prisma.uebaAnomaly.findFirst({
      ...params,
      include: { entity: { select: { entityName: true, entityType: true } } },
    })
  }

  async updateAnomaly(params: {
    where: Prisma.UebaAnomalyWhereUniqueInput
    data: Prisma.UebaAnomalyUpdateInput
  }) {
    return this.prisma.uebaAnomaly.update({
      ...params,
      include: { entity: { select: { entityName: true, entityType: true } } },
    })
  }

  /* ---------------------------------------------------------------- */
  /* ML MODEL QUERIES                                                   */
  /* ---------------------------------------------------------------- */

  async findManyModels(params: {
    where: Prisma.MlModelWhereInput
    orderBy: Prisma.MlModelOrderByWithRelationInput
    skip: number
    take: number
  }) {
    return this.prisma.mlModel.findMany(params)
  }

  async countModels(where: Prisma.MlModelWhereInput) {
    return this.prisma.mlModel.count({ where })
  }
}
