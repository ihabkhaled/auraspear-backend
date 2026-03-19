import { Module } from '@nestjs/common'
import { ReportsController } from './reports.controller'
import { ReportsRepository } from './reports.repository'
import { ReportsService } from './reports.service'
import { AppLogsModule } from '../app-logs/app-logs.module'

@Module({
  imports: [AppLogsModule],
  controllers: [ReportsController],
  providers: [ReportsRepository, ReportsService],
  exports: [ReportsRepository, ReportsService],
})
export class ReportsModule {}
