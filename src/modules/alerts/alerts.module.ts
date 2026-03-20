import { Module } from '@nestjs/common'
import { AlertsController } from './alerts.controller'
import { AlertsRepository } from './alerts.repository'
import { AlertsService } from './alerts.service'
import { AppLogsModule } from '../app-logs/app-logs.module'
import { ConnectorsModule } from '../connectors/connectors.module'

@Module({
  imports: [ConnectorsModule, AppLogsModule],
  controllers: [AlertsController],
  providers: [AlertsRepository, AlertsService],
  exports: [AlertsService, AlertsRepository],
})
export class AlertsModule {}
