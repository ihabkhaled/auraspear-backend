import { Module } from '@nestjs/common'
import { AiAgentsController } from './ai-agents.controller'
import { AiAgentsRepository } from './ai-agents.repository'
import { AiAgentsService } from './ai-agents.service'
import { AppLogsModule } from '../app-logs/app-logs.module'

@Module({
  imports: [AppLogsModule],
  controllers: [AiAgentsController],
  providers: [AiAgentsRepository, AiAgentsService],
  exports: [AiAgentsService],
})
export class AiAgentsModule {}
