import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { UebaEntity, UebaAnomaly, MlModel, Prisma } from '@prisma/client'

type EntityWithAnomalyCount = UebaEntity & { _count: { anomalies: number } }
type AnomalyWithEntity = UebaAnomaly & {
  entity: { entityName: string; entityType: string }
}

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
  }): Promise<EntityWithAnomalyCount[]> {
    return this.prisma.uebaEntity.findMany({
      ...params,
      include: { _count: { select: { anomalies: true } } },
    })
  }

  async countEntities(where: Prisma.UebaEntityWhereInput): Promise<number> {
    return this.prisma.uebaEntity.count({ where })
  }

  async findFirstEntityWithCount(params: {
    where: Prisma.UebaEntityWhereInput
  }): Promise<EntityWithAnomalyCount | null> {
    return this.prisma.uebaEntity.findFirst({
      ...params,
      include: { _count: { select: { anomalies: true } } },
    })
  }

  async createEntity(data: Prisma.UebaEntityCreateInput): Promise<EntityWithAnomalyCount> {
    return this.prisma.uebaEntity.create({
      data,
      include: { _count: { select: { anomalies: true } } },
    })
  }

  async updateEntity(params: {
    where: Prisma.UebaEntityWhereUniqueInput
    data: Prisma.UebaEntityUpdateInput
  }): Promise<EntityWithAnomalyCount> {
    return this.prisma.uebaEntity.update({
      ...params,
      include: { _count: { select: { anomalies: true } } },
    })
  }

  async deleteEntity(where: Prisma.UebaEntityWhereUniqueInput): Promise<UebaEntity> {
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
  }): Promise<AnomalyWithEntity[]> {
    return this.prisma.uebaAnomaly.findMany({
      ...params,
      include: { entity: { select: { entityName: true, entityType: true } } },
    })
  }

  async countAnomalies(where: Prisma.UebaAnomalyWhereInput): Promise<number> {
    return this.prisma.uebaAnomaly.count({ where })
  }

  async findFirstAnomaly(params: {
    where: Prisma.UebaAnomalyWhereInput
  }): Promise<AnomalyWithEntity | null> {
    return this.prisma.uebaAnomaly.findFirst({
      ...params,
      include: { entity: { select: { entityName: true, entityType: true } } },
    })
  }

  async updateAnomaly(params: {
    where: Prisma.UebaAnomalyWhereUniqueInput
    data: Prisma.UebaAnomalyUpdateInput
  }): Promise<AnomalyWithEntity> {
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
  }): Promise<MlModel[]> {
    return this.prisma.mlModel.findMany(params)
  }

  async countModels(where: Prisma.MlModelWhereInput): Promise<number> {
    return this.prisma.mlModel.count({ where })
  }
}
