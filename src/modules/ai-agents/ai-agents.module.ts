import { Module, type OnModuleInit } from '@nestjs/common'
import { AiAgentTaskHandler } from './ai-agent-task.handler'
import { AiAgentsController } from './ai-agents.controller'
import { AiAgentsRepository } from './ai-agents.repository'
import { AiAgentsService } from './ai-agents.service'
import { AiModule } from '../ai/ai.module'
import { AppLogsModule } from '../app-logs/app-logs.module'
import { JobType } from '../jobs/enums/job.enums'
import { JobProcessorService } from '../jobs/job-processor.service'
import { JobsModule } from '../jobs/jobs.module'

@Module({
  imports: [AppLogsModule, AiModule, JobsModule],
  controllers: [AiAgentsController],
  providers: [AiAgentsRepository, AiAgentsService, AiAgentTaskHandler],
  exports: [AiAgentsService, AiAgentsRepository],
})
export class AiAgentsModule implements OnModuleInit {
  constructor(
    private readonly processor: JobProcessorService,
    private readonly agentTaskHandler: AiAgentTaskHandler
  ) {}

  onModuleInit(): void {
    this.processor.registerHandler(JobType.AI_AGENT_TASK, job => this.agentTaskHandler.handle(job))
  }
}
