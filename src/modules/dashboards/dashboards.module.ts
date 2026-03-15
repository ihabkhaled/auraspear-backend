import { Module } from '@nestjs/common'
import { DashboardsController } from './dashboards.controller'
import { DashboardsRepository } from './dashboards.repository'
import { DashboardsService } from './dashboards.service'
import { AppLogsModule } from '../app-logs/app-logs.module'
import { ConnectorsModule } from '../connectors/connectors.module'

@Module({
  imports: [ConnectorsModule, AppLogsModule],
  controllers: [DashboardsController],
  providers: [DashboardsService, DashboardsRepository],
})
export class DashboardsModule {}
