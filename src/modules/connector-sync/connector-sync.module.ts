import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { ConnectorSyncController } from './connector-sync.controller'
import { ConnectorSyncService } from './connector-sync.service'
import { AlertsModule } from '../alerts/alerts.module'
import { AppLogsModule } from '../app-logs/app-logs.module'
import { ConnectorsModule } from '../connectors/connectors.module'
import { IntelModule } from '../intel/intel.module'

@Module({
  imports: [ScheduleModule.forRoot(), ConnectorsModule, AlertsModule, IntelModule, AppLogsModule],
  controllers: [ConnectorSyncController],
  providers: [ConnectorSyncService],
  exports: [ConnectorSyncService],
})
export class ConnectorSyncModule {}
