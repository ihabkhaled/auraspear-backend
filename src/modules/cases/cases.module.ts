import { Module } from '@nestjs/common'
import { CasesController } from './cases.controller'
import { CasesService } from './cases.service'
import { AppLogsModule } from '../app-logs/app-logs.module'
import { NotificationsModule } from '../notifications/notifications.module'

@Module({
  imports: [AppLogsModule, NotificationsModule],
  controllers: [CasesController],
  providers: [CasesService],
  exports: [CasesService],
})
export class CasesModule {}
