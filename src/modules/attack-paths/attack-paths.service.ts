import { Injectable, Logger } from '@nestjs/common'
import { AttackPathsRepository } from './attack-paths.repository'
import {
  buildAttackPathListWhere,
  buildAttackPathOrderBy,
  buildAttackPathUpdateData,
} from './attack-paths.utilities'
import {
  AppLogFeature,
  AppLogOutcome,
  AppLogSourceType,
  AttackPathStatus,
} from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import type { AttackPathRecord, AttackPathStats, PaginatedAttackPaths } from './attack-paths.types'
import type { CreateAttackPathDto } from './dto/create-attack-path.dto'
import type { UpdateAttackPathDto } from './dto/update-attack-path.dto'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'
import type { Prisma } from '@prisma/client'

@Injectable()
export class AttackPathsService {
  private readonly logger = new Logger(AttackPathsService.name)

  constructor(
    private readonly repository: AttackPathsRepository,
    private readonly appLogger: AppLoggerService
  ) {}

  /* ---------------------------------------------------------------- */
  /* LIST (paginated, tenant-scoped)                                   */
  /* ---------------------------------------------------------------- */

  async listPaths(
    tenantId: string,
    page = 1,
    limit = 20,
    sortBy?: string,
    sortOrder?: string,
    severity?: string,
    status?: string,
    query?: string
  ): Promise<PaginatedAttackPaths> {
    const where = buildAttackPathListWhere(tenantId, severity, status, query)

    const [paths, total] = await Promise.all([
      this.repository.findManyWithTenant({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: buildAttackPathOrderBy(sortBy, sortOrder),
      }),
      this.repository.count(where),
    ])

    const data = paths.map(p => ({
      ...p,
      tenantName: p.tenant.name,
    }))

    return {
      data,
      pagination: buildPaginationMeta(page, limit, total),
    }
  }

  /* ---------------------------------------------------------------- */
  /* GET BY ID                                                         */
  /* ---------------------------------------------------------------- */

  async getPathById(id: string, tenantId: string): Promise<AttackPathRecord> {
    const path = await this.repository.findFirstWithTenant({ id, tenantId })

    if (!path) {
      this.appLogger.warn('Attack path not found', {
        feature: AppLogFeature.ATTACK_PATHS,
        action: 'getPathById',
        className: 'AttackPathsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { attackPathId: id, tenantId },
      })
      throw new BusinessException(404, `Attack path ${id} not found`, 'errors.attackPaths.notFound')
    }

    return {
      ...path,
      tenantName: path.tenant.name,
    }
  }

  /* ---------------------------------------------------------------- */
  /* CREATE                                                            */
  /* ---------------------------------------------------------------- */

  async createPath(dto: CreateAttackPathDto, user: JwtPayload): Promise<AttackPathRecord> {
    const result = await this.repository.createWithNumber({
      tenantId: user.tenantId,
      data: {
        title: dto.title,
        description: dto.description ?? null,
        severity: dto.severity,
        status: AttackPathStatus.ACTIVE,
        stages: dto.stages as Prisma.InputJsonValue,
        affectedAssets: dto.affectedAssets,
        killChainCoverage: dto.killChainCoverage,
        mitreTactics: dto.mitreTactics ?? [],
        mitreTechniques: dto.mitreTechniques ?? [],
      },
    })

    this.appLogger.info('Attack path created', {
      feature: AppLogFeature.ATTACK_PATHS,
      action: 'createPath',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'AttackPath',
      targetResourceId: result.id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AttackPathsService',
      functionName: 'createPath',
      metadata: { pathNumber: result.pathNumber, severity: result.severity },
    })

    return {
      ...result,
      tenantName: result.tenant.name,
    }
  }

  /* ---------------------------------------------------------------- */
  /* UPDATE                                                            */
  /* ---------------------------------------------------------------- */

  async updatePath(
    id: string,
    dto: UpdateAttackPathDto,
    user: JwtPayload
  ): Promise<AttackPathRecord> {
    await this.getPathById(id, user.tenantId)

    const updated = await this.repository.updateMany({
      where: { id, tenantId: user.tenantId },
      data: buildAttackPathUpdateData(dto),
    })

    if (updated.count === 0) {
      this.appLogger.warn('Attack path not found during update', {
        feature: AppLogFeature.ATTACK_PATHS,
        action: 'updatePath',
        className: 'AttackPathsService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        tenantId: user.tenantId,
        metadata: { attackPathId: id },
      })
      throw new BusinessException(404, `Attack path ${id} not found`, 'errors.attackPaths.notFound')
    }

    this.appLogger.info('Attack path updated', {
      feature: AppLogFeature.ATTACK_PATHS,
      action: 'updatePath',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'AttackPath',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AttackPathsService',
      functionName: 'updatePath',
    })

    return this.getPathById(id, user.tenantId)
  }

  /* ---------------------------------------------------------------- */
  /* DELETE                                                            */
  /* ---------------------------------------------------------------- */

  async deletePath(id: string, tenantId: string, actor: string): Promise<{ deleted: boolean }> {
    const existing = await this.getPathById(id, tenantId)

    await this.repository.deleteMany({ id, tenantId })

    this.appLogger.info(`Attack path ${existing.pathNumber} deleted`, {
      feature: AppLogFeature.ATTACK_PATHS,
      action: 'deletePath',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      actorEmail: actor,
      targetResource: 'AttackPath',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AttackPathsService',
      functionName: 'deletePath',
      metadata: { pathNumber: existing.pathNumber },
    })

    return { deleted: true }
  }

  /* ---------------------------------------------------------------- */
  /* STATS                                                             */
  /* ---------------------------------------------------------------- */

  async getAttackPathStats(tenantId: string): Promise<AttackPathStats> {
    const [activePaths, assetsResult, coverageResult] = await Promise.all([
      this.repository.count({ tenantId, status: AttackPathStatus.ACTIVE }),
      this.repository.aggregateSum(
        { tenantId, status: AttackPathStatus.ACTIVE },
        { affectedAssets: true }
      ),
      this.repository.aggregateAvg({ tenantId }, { killChainCoverage: true }),
    ])

    return {
      activePaths,
      assetsAtRisk: assetsResult._sum?.affectedAssets ?? 0,
      avgKillChainCoverage: Math.round((coverageResult._avg?.killChainCoverage ?? 0) * 100) / 100,
    }
  }
}
