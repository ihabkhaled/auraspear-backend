import { Module } from '@nestjs/common'
import { DashboardsController } from './dashboards.controller'
import { DashboardsService } from './dashboards.service'
import { ConnectorsModule } from '../connectors/connectors.module'

@Module({
  imports: [ConnectorsModule],
  controllers: [DashboardsController],
  providers: [DashboardsService],
})
export class DashboardsModule {}
