import { forwardRef, Module } from '@nestjs/common'
import { AiReportController } from './ai-report.controller'
import { AiReportService } from './ai-report.service'
import { ReportsGenerationRepository } from './reports-generation.repository'
import { ReportsController } from './reports.controller'
import { ReportsRepository } from './reports.repository'
import { ReportsService } from './reports.service'
import { AiModule } from '../ai/ai.module'
import { AppLogsModule } from '../app-logs/app-logs.module'
import { DashboardsRepository } from '../dashboards/dashboards.repository'
import { JobsModule } from '../jobs/jobs.module'

@Module({
  imports: [AppLogsModule, forwardRef(() => JobsModule), AiModule],
  controllers: [ReportsController, AiReportController],
  providers: [
    ReportsRepository,
    ReportsGenerationRepository,
    ReportsService,
    AiReportService,
    DashboardsRepository,
  ],
  exports: [ReportsRepository, ReportsGenerationRepository, ReportsService],
})
export class ReportsModule {}
