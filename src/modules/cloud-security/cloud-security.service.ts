import { Injectable, Logger } from '@nestjs/common'
import { CloudSecurityRepository } from './cloud-security.repository'
import {
  buildAccountListWhere,
  buildAccountOrderBy,
  buildFindingListWhere,
  buildFindingOrderBy,
  buildAccountUpdateData,
  buildAccountRecord,
  buildFindingRecord,
} from './cloud-security.utils'
import {
  AppLogFeature,
  AppLogOutcome,
  AppLogSourceType,
  CloudAccountStatus,
  CloudFindingSeverity,
  CloudFindingStatus,
} from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { buildPaginationMeta } from '../../common/interfaces/pagination.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import type {
  CloudAccountRecord,
  CloudSecurityStats,
  PaginatedAccounts,
  PaginatedFindings,
} from './cloud-security.types'
import type { CreateAccountDto } from './dto/create-account.dto'
import type { UpdateAccountDto } from './dto/update-account.dto'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'

@Injectable()
export class CloudSecurityService {
  private readonly logger = new Logger(CloudSecurityService.name)

  constructor(
    private readonly repository: CloudSecurityRepository,
    private readonly appLogger: AppLoggerService
  ) {}

  /* ---------------------------------------------------------------- */
  /* LIST ACCOUNTS (paginated, tenant-scoped)                          */
  /* ---------------------------------------------------------------- */

  async listAccounts(
    tenantId: string,
    page = 1,
    limit = 20,
    sortBy?: string,
    sortOrder?: string,
    provider?: string,
    status?: string
  ): Promise<PaginatedAccounts> {
    const where = buildAccountListWhere(tenantId, provider, status)
    const orderBy = buildAccountOrderBy(sortBy, sortOrder)

    const [accounts, total] = await Promise.all([
      this.repository.findManyAccounts({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
      }),
      this.repository.countAccounts(where),
    ])

    const data = accounts.map(buildAccountRecord)

    return {
      data,
      pagination: buildPaginationMeta(page, limit, total),
    }
  }

  /* ---------------------------------------------------------------- */
  /* GET ACCOUNT BY ID                                                 */
  /* ---------------------------------------------------------------- */

  async getAccountById(id: string, tenantId: string): Promise<CloudAccountRecord> {
    const account = await this.repository.findFirstAccount({ id, tenantId })

    if (!account) {
      this.appLogger.warn('Cloud account not found', {
        feature: AppLogFeature.CLOUD_SECURITY,
        action: 'getAccountById',
        className: 'CloudSecurityService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { accountId: id, tenantId },
      })
      throw new BusinessException(
        404,
        `Cloud account ${id} not found`,
        'errors.cloudSecurity.accountNotFound'
      )
    }

    return buildAccountRecord(account)
  }

  /* ---------------------------------------------------------------- */
  /* CREATE ACCOUNT                                                    */
  /* ---------------------------------------------------------------- */

  async createAccount(dto: CreateAccountDto, user: JwtPayload): Promise<CloudAccountRecord> {
    const account = await this.repository.createAccount({
      tenantId: user.tenantId,
      provider: dto.provider,
      accountId: dto.accountId,
      alias: dto.alias ?? null,
      region: dto.region ?? null,
      status: CloudAccountStatus.DISCONNECTED,
    })

    this.appLogger.info('Cloud account created', {
      feature: AppLogFeature.CLOUD_SECURITY,
      action: 'createAccount',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'CloudAccount',
      targetResourceId: account.id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'CloudSecurityService',
      functionName: 'createAccount',
      metadata: { provider: account.provider, accountId: account.accountId },
    })

    return buildAccountRecord(account)
  }

  /* ---------------------------------------------------------------- */
  /* UPDATE ACCOUNT                                                    */
  /* ---------------------------------------------------------------- */

  async updateAccount(
    id: string,
    dto: UpdateAccountDto,
    user: JwtPayload
  ): Promise<CloudAccountRecord> {
    await this.getAccountById(id, user.tenantId)

    const updated = await this.repository.updateManyAccounts({
      where: { id, tenantId: user.tenantId },
      data: buildAccountUpdateData(dto),
    })

    if (updated.count === 0) {
      throw new BusinessException(
        404,
        `Cloud account ${id} not found`,
        'errors.cloudSecurity.accountNotFound'
      )
    }

    this.appLogger.info('Cloud account updated', {
      feature: AppLogFeature.CLOUD_SECURITY,
      action: 'updateAccount',
      outcome: AppLogOutcome.SUCCESS,
      tenantId: user.tenantId,
      actorEmail: user.email,
      actorUserId: user.sub,
      targetResource: 'CloudAccount',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'CloudSecurityService',
      functionName: 'updateAccount',
    })

    return this.getAccountById(id, user.tenantId)
  }

  /* ---------------------------------------------------------------- */
  /* DELETE ACCOUNT                                                    */
  /* ---------------------------------------------------------------- */

  async deleteAccount(id: string, tenantId: string, actor: string): Promise<{ deleted: boolean }> {
    const existing = await this.getAccountById(id, tenantId)

    await this.repository.deleteManyAccounts({ id, tenantId })

    this.appLogger.info(`Cloud account ${existing.accountId} deleted`, {
      feature: AppLogFeature.CLOUD_SECURITY,
      action: 'deleteAccount',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      actorEmail: actor,
      targetResource: 'CloudAccount',
      targetResourceId: id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'CloudSecurityService',
      functionName: 'deleteAccount',
      metadata: { provider: existing.provider, accountId: existing.accountId },
    })

    return { deleted: true }
  }

  /* ---------------------------------------------------------------- */
  /* LIST FINDINGS (paginated, tenant-scoped)                          */
  /* ---------------------------------------------------------------- */

  async listFindings(
    tenantId: string,
    page = 1,
    limit = 20,
    sortBy?: string,
    sortOrder?: string,
    severity?: string,
    status?: string,
    cloudAccountId?: string
  ): Promise<PaginatedFindings> {
    const where = buildFindingListWhere(tenantId, severity, status, cloudAccountId)
    const orderBy = buildFindingOrderBy(sortBy, sortOrder)

    const [findings, total] = await Promise.all([
      this.repository.findManyFindings({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
      }),
      this.repository.countFindings(where),
    ])

    const data = findings.map(buildFindingRecord)

    return {
      data,
      pagination: buildPaginationMeta(page, limit, total),
    }
  }

  /* ---------------------------------------------------------------- */
  /* STATS                                                             */
  /* ---------------------------------------------------------------- */

  async getCloudSecurityStats(tenantId: string): Promise<CloudSecurityStats> {
    const [
      totalAccounts,
      connectedAccounts,
      disconnectedAccounts,
      errorAccounts,
      totalFindings,
      openFindings,
      resolvedFindings,
      suppressedFindings,
      criticalFindings,
      highFindings,
    ] = await Promise.all([
      this.repository.countAccounts({ tenantId }),
      this.repository.countAccountsByStatus(tenantId, CloudAccountStatus.CONNECTED),
      this.repository.countAccountsByStatus(tenantId, CloudAccountStatus.DISCONNECTED),
      this.repository.countAccountsByStatus(tenantId, CloudAccountStatus.ERROR),
      this.repository.countFindings({ tenantId }),
      this.repository.countFindingsByStatus(tenantId, CloudFindingStatus.OPEN),
      this.repository.countFindingsByStatus(tenantId, CloudFindingStatus.RESOLVED),
      this.repository.countFindingsByStatus(tenantId, CloudFindingStatus.SUPPRESSED),
      this.repository.countFindingsBySeverity(tenantId, CloudFindingSeverity.CRITICAL),
      this.repository.countFindingsBySeverity(tenantId, CloudFindingSeverity.HIGH),
    ])

    return {
      totalAccounts,
      connectedAccounts,
      disconnectedAccounts,
      errorAccounts,
      totalFindings,
      openFindings,
      resolvedFindings,
      suppressedFindings,
      criticalFindings,
      highFindings,
    }
  }
}
