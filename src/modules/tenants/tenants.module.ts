import { Module, forwardRef } from '@nestjs/common'
import { TenantsController } from './tenants.controller'
import { TenantsService } from './tenants.service'
import { AppLogsModule } from '../app-logs/app-logs.module'
import { NotificationsModule } from '../notifications/notifications.module'

@Module({
  imports: [AppLogsModule, forwardRef(() => NotificationsModule)],
  controllers: [TenantsController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
