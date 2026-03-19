import { Module, type OnModuleInit } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { JobType } from './enums/job.enums'
import { ConnectorSyncHandler } from './handlers/connector-sync.handler'
import { DetectionExecutionHandler } from './handlers/detection-execution.handler'
import { ReportGenerationHandler } from './handlers/report-generation.handler'
import { SoarPlaybookHandler } from './handlers/soar-playbook.handler'
import { JobProcessorService } from './job-processor.service'
import { JobRepository } from './jobs.repository'
import { JobService } from './jobs.service'

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [
    JobRepository,
    JobService,
    JobProcessorService,
    ConnectorSyncHandler,
    DetectionExecutionHandler,
    ReportGenerationHandler,
    SoarPlaybookHandler,
  ],
  exports: [JobService],
})
export class JobsModule implements OnModuleInit {
  constructor(
    private readonly processor: JobProcessorService,
    private readonly connectorSyncHandler: ConnectorSyncHandler,
    private readonly detectionHandler: DetectionExecutionHandler,
    private readonly reportHandler: ReportGenerationHandler,
    private readonly soarHandler: SoarPlaybookHandler
  ) {}

  onModuleInit(): void {
    this.processor.registerHandler(JobType.CONNECTOR_SYNC, job =>
      this.connectorSyncHandler.handle(job)
    )
    this.processor.registerHandler(JobType.DETECTION_RULE_EXECUTION, job =>
      this.detectionHandler.handle(job)
    )
    this.processor.registerHandler(JobType.CORRELATION_RULE_EXECUTION, job =>
      this.detectionHandler.handle(job)
    )
    this.processor.registerHandler(JobType.REPORT_GENERATION, job => this.reportHandler.handle(job))
    this.processor.registerHandler(JobType.SOAR_PLAYBOOK, job => this.soarHandler.handle(job))
  }
}
