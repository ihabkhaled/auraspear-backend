import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  PLATFORM_ADMIN_EMAIL,
  PLATFORM_ADMIN_NAME,
} from './auth.constants'
import { PlatformAdminBootstrapRepository } from './platform-admin-bootstrap.repository'
import { resolvePasswordHash } from './platform-admin-bootstrap.utilities'

@Injectable()
export class PlatformAdminBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(PlatformAdminBootstrapService.name)

  constructor(
    private readonly repository: PlatformAdminBootstrapRepository,
    private readonly configService: ConfigService
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensurePlatformAdmin()
  }

  async ensurePlatformAdmin(): Promise<void> {
    const configuredPassword = this.resolveConfiguredPassword()
    if (configuredPassword.length === 0) {
      this.logger.warn(
        'Platform admin bootstrap skipped because PLATFORM_ADMIN_PASSWORD and SEED_DEFAULT_PASSWORD are not set'
      )
      return
    }

    const existingAdmin = await this.repository.findPlatformAdminByEmail(PLATFORM_ADMIN_EMAIL)
    const passwordHash = await resolvePasswordHash(
      configuredPassword,
      existingAdmin?.passwordHash
    )

    const platformAdmin = await this.repository.upsertPlatformAdmin({
      email: PLATFORM_ADMIN_EMAIL,
      name: PLATFORM_ADMIN_NAME,
      passwordHash,
    })

    await this.repository.upsertUserPreference(platformAdmin.id)
    await this.ensureMembershipsForAllTenants(platformAdmin.id)
  }

  private async ensureMembershipsForAllTenants(userId: string): Promise<void> {
    const tenantIds = await this.repository.findAllTenantIds()
    await Promise.all(
      tenantIds.map(tenantId =>
        this.repository.upsertGlobalAdminMembership(userId, tenantId)
      )
    )

    this.logger.log(
      `Platform admin bootstrap ensured for ${tenantIds.length} tenant${tenantIds.length === 1 ? '' : 's'}`
    )
  }

  private resolveConfiguredPassword(): string {
    const configPassword = this.configService.get<string>('PLATFORM_ADMIN_PASSWORD')
    const seedPassword = process.env['SEED_DEFAULT_PASSWORD']

    return (configPassword ?? seedPassword ?? '').trim()
  }
}
