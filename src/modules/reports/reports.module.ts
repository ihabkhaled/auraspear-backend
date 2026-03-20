import { forwardRef, Module } from '@nestjs/common'
import { ReportsGenerationRepository } from './reports-generation.repository'
import { ReportsController } from './reports.controller'
import { ReportsRepository } from './reports.repository'
import { ReportsService } from './reports.service'
import { AppLogsModule } from '../app-logs/app-logs.module'
import { JobsModule } from '../jobs/jobs.module'

@Module({
  imports: [AppLogsModule, forwardRef(() => JobsModule)],
  controllers: [ReportsController],
  providers: [ReportsRepository, ReportsGenerationRepository, ReportsService],
  exports: [ReportsRepository, ReportsGenerationRepository, ReportsService],
})
export class ReportsModule {}
