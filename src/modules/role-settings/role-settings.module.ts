import { Global, Module } from '@nestjs/common'
import { PermissionCacheService } from './permission-cache.service'
import { RoleSettingsController } from './role-settings.controller'
import { RoleSettingsRepository } from './role-settings.repository'
import { RoleSettingsService } from './role-settings.service'
import { AppLogsModule } from '../app-logs/app-logs.module'

@Global()
@Module({
  imports: [AppLogsModule],
  controllers: [RoleSettingsController],
  providers: [RoleSettingsRepository, RoleSettingsService, PermissionCacheService],
  exports: [RoleSettingsService, PermissionCacheService],
})
export class RoleSettingsModule {}
