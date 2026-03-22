import { Module } from '@nestjs/common'
import { AgentConfigController } from './agent-config.controller'
import { AgentConfigRepository } from './agent-config.repository'
import { AgentConfigService } from './agent-config.service'
import { AppLogsModule } from '../app-logs/app-logs.module'

@Module({
  imports: [AppLogsModule],
  controllers: [AgentConfigController],
  providers: [AgentConfigRepository, AgentConfigService],
  exports: [AgentConfigService, AgentConfigRepository],
})
export class AgentConfigModule {}
