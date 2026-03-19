import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as bcrypt from 'bcryptjs'
import { PlatformAdminBootstrapRepository } from './platform-admin-bootstrap.repository'

const PLATFORM_ADMIN_EMAIL = 'platform-admin@auraspear.io'
const PLATFORM_ADMIN_NAME = 'Platform Administrator'
const BCRYPT_SALT_ROUNDS = 12

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
    const shouldSyncPassword =
      existingAdmin === null ||
      existingAdmin.passwordHash === null ||
      !(await bcrypt.compare(configuredPassword, existingAdmin.passwordHash))

    const passwordHash =
      shouldSyncPassword || existingAdmin === null || existingAdmin.passwordHash === null
        ? await bcrypt.hash(configuredPassword, BCRYPT_SALT_ROUNDS)
        : existingAdmin.passwordHash

    const platformAdmin = await this.repository.upsertPlatformAdmin({
      email: PLATFORM_ADMIN_EMAIL,
      name: PLATFORM_ADMIN_NAME,
      passwordHash,
    })

    await this.repository.upsertUserPreference(platformAdmin.id)

    const tenantIds = await this.repository.findAllTenantIds()
    await Promise.all(
      tenantIds.map(tenantId =>
        this.repository.upsertGlobalAdminMembership(platformAdmin.id, tenantId)
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
