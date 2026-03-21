import { Module } from '@nestjs/common'
import { AiController } from './ai.controller'
import { AiRepository } from './ai.repository'
import { AiService } from './ai.service'
import { AppLogsModule } from '../app-logs/app-logs.module'
import { ConnectorsModule } from '../connectors/connectors.module'
import { LlmConnectorsModule } from '../connectors/llm-connectors/llm-connectors.module'

@Module({
  imports: [AppLogsModule, ConnectorsModule, LlmConnectorsModule],
  controllers: [AiController],
  providers: [AiRepository, AiService],
  exports: [AiService],
})
export class AiModule {}
